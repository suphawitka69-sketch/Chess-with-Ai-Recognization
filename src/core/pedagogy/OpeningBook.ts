/**
 * OpeningBook.ts
 * ---------------------------------------------------------------------------
 * ค้นหาชื่อรูปเกม (ECO Code + Opening Name) จาก FEN โดยใช้ ECO book ที่ bundle
 * มากับแอป (offline, ~500KB ตามสเปก Phase 0 §1.2) — ไม่มีการยิง network เลย
 * ในไฟล์นี้ (Pure TypeScript: ไม่ import React / DOM / Zustand / Dexie)
 *
 * หน้าที่ของไฟล์นี้:
 *   1. `normalizeFenForLookup` / `toFenKey` — สร้าง fenKey มาตรฐาน (4 field)
 *   2. `OpeningBook.lookupOpening`          — FEN -> { eco, name } | null
 *   3. `OpeningBook.analyzeOpeningLine`    — ไล่ทั้งเกม -> inBook ต่อ ply,
 *                                            bookDepthPlies, firstDeviationPly
 *   4. `buildLiveMoveContext`              — context ต่อตาแบบ offline ล้วน ๆ
 *                                            สำหรับใช้ระหว่างเล่นสด (§1.3)
 *   5. `classifyDeviationQuality`          — ประเมินคุณภาพตาที่เริ่มหลุดตำรา
 *
 * ส่วนสถิติมืออาชีพ (Lichess Masters) อยู่ที่ `MasterStats.ts`
 * และ network client จริงอยู่ที่ `src/data/api/LichessMastersApiClient.ts`
 * ---------------------------------------------------------------------------
 */

import type { MoveLogContext } from '../../shared/types/schema';

// ============================================================================
// Types
// ============================================================================

/** รูปแบบ record หนึ่งแถวใน eco.json — ตรงกับ `src/data/eco.json` ตามโครงสร้างโปรเจกต์ §2 */
export interface OpeningBookEntry {
  readonly fen: string;
  readonly eco: string;
  readonly name: string;
}

export interface OpeningLookupResult {
  readonly eco: string;
  readonly name: string;
}

/** สถิติของมืออาชีพสำหรับตาเดินหนึ่งตาในตำแหน่งที่ระบุ — รูปแบบย่อของสิ่งที่ Lichess Masters API คืนมา */
export interface MasterMoveStat {
  readonly uci: string;
  readonly san: string;
  readonly whiteWins: number;
  readonly draws: number;
  readonly blackWins: number;
  readonly totalGames: number;
}

export interface MasterStatsResult {
  /** จำนวนเกมมืออาชีพทั้งหมดที่ผ่านตำแหน่งนี้ (ตัวหารของ masterFrequency) */
  readonly totalGames: number;
  readonly moves: readonly MasterMoveStat[];
  readonly openingName?: string;
  readonly eco?: string;
}

/**
 * Contract ของ client ที่ยิง Lichess Masters API จริง (ดู
 * `src/data/api/LichessMastersApiClient.ts`) — ไฟล์ใน core ไม่เรียก fetch เอง
 */
export interface MastersApiClient {
  fetchMasterStats(normalizedFen: string): Promise<MasterStatsResult>;
}

export class OpeningBookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpeningBookError';
  }
}

/** ผลของตาเดินหนึ่งตา (ply เริ่มที่ 1 = ตาแรกของขาว) เทียบกับตำราเปิดหมาก */
export interface PlyBookStatus {
  readonly ply: number;
  /** true = ตำแหน่งหลังเดินตานี้ยังอยู่ในตำรา (และยังไม่เคยหลุดมาก่อน) */
  readonly inBook: boolean;
  /** ECO ล่าสุดที่จับคู่ได้ (ถ้าหลุดตำราแล้วจะคง ECO สุดท้ายที่เจอไว้) */
  readonly ecoCode: string | null;
  readonly openingName: string | null;
}

export interface OpeningLineAnalysis {
  readonly plies: readonly PlyBookStatus[];
  /** ECO / ชื่อ ของตำแหน่งในตำราที่ลึกที่สุดที่จับคู่ได้ในเกมนี้ */
  readonly ecoCode: string | null;
  readonly name: string | null;
  /** จำนวนครึ่งตาที่ยังอยู่ในตำรา (= ply สุดท้ายที่ inBook) */
  readonly bookDepthPlies: number;
  /** ply แรกที่หลุดตำรา (1-based) หรือ null ถ้าจบเกมโดยยังอยู่ในตำรา */
  readonly firstDeviationPly: number | null;
}

export interface OpeningLineOptions {
  /**
   * ECO book ไม่ได้มีทุกตำแหน่งระหว่างทาง (บางบรรทัดข้ามไปยังตำแหน่งที่ตั้งชื่อไว้)
   * ถ้า > 0 จะยอมให้ "ตำแหน่งที่หาไม่เจอติดกันไม่เกิน N ply" ถ้าหลังจากนั้น
   * กลับมาเจอในตำราอีก (ถือว่ายังไม่หลุด) — ค่าเริ่มต้น 0 = เข้มงวด
   */
  readonly gapTolerancePlies?: number;
}

/** ป้ายคุณภาพของตาที่เริ่มหลุดตำรา (เก็บใน OpeningSummary.deviationQuality) */
export type DeviationQuality = 'master_alternative' | 'sound' | 'inaccuracy' | 'mistake' | 'blunder';

export interface DeviationEvidence {
  /** สัดส่วนมืออาชีพที่เล่นตานั้น 0..1 (null = ไม่มีข้อมูล) */
  readonly masterFrequency: number | null;
  /** ค่าเสียเป็น centipawn จากมุมผู้เดิน (>= 0; null = ยังไม่มีผลวิเคราะห์ engine) */
  readonly evalLossCp: number | null;
}

// ============================================================================
// FEN normalization
// ============================================================================

/**
 * ตัด halfmove clock + fullmove number ออกจาก FEN เหลือ 4 field แรก
 * (piece placement, active color, castling rights, en passant target)
 * ใช้เป็น key เดียวกันทั้งสำหรับ ECO lookup และสำหรับ cache ผล Lichess Masters
 *
 * หมายเหตุ en passant: ไลบรารีต่าง ๆ ใส่ช่อง ep ไม่เหมือนกัน — บางตัวใส่ทุกครั้งที่
 * ดัน pawn 2 ช่อง (เช่น "e3" หลัง 1.e4) บางตัวใส่เฉพาะเมื่อมีหมากที่กินได้จริง
 * ถ้าไม่ canonicalize ตำแหน่ง 1.e4 จะจับคู่กับ eco.json ไม่ติด จึงเก็บช่อง ep
 * ไว้เฉพาะเมื่อมี pawn ฝั่งที่ถึงตาเดินอยู่ข้างหน้า pawn ที่เพิ่งดัน (กินได้จริง
 * แบบ pseudo-legal) นอกนั้นแปลงเป็น "-"
 */
export function normalizeFenForLookup(fen: string): string {
  const [placement, activeColor, castling, enPassant] = fen.trim().split(/\s+/);
  if (
    placement === undefined ||
    activeColor === undefined ||
    castling === undefined ||
    enPassant === undefined
  ) {
    throw new OpeningBookError(`FEN ไม่ถูกต้อง (ต้องมีอย่างน้อย 4 field คั่นด้วยช่องว่าง): "${fen}"`);
  }
  return `${placement} ${activeColor} ${castling} ${canonicalizeEnPassant(placement, activeColor, enPassant)}`;
}

/** ชื่อสั้นสำหรับใช้เป็น `BookCacheRecord.fenKey` */
export const toFenKey = normalizeFenForLookup;

function canonicalizeEnPassant(placement: string, activeColor: string, enPassant: string): string {
  if (enPassant === '-') {
    return '-';
  }
  const file = enPassant.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = enPassant.charAt(1);
  const whiteToMove = activeColor === 'w';
  const expectedRank = whiteToMove ? '6' : '3';
  if (enPassant.length !== 2 || file < 0 || file > 7 || rank !== expectedRank) {
    return enPassant; // รูปแบบผิดปกติ: ไม่แตะต้อง ปล่อยให้ผู้เรียกเห็นความผิดปกติเอง
  }

  // pawn ที่จะกินได้ยืนอยู่แถว 5 (ขาว) หรือแถว 4 (ดำ) ในไฟล์ติดกับช่อง ep
  // rows[0] = แถว 8 ดังนั้นแถว 5 = index 3, แถว 4 = index 4
  const rankRow = placement.split('/')[whiteToMove ? 3 : 4];
  if (rankRow === undefined) {
    return enPassant;
  }
  const expanded = expandRank(rankRow);
  const capturer = whiteToMove ? 'P' : 'p';
  const canCapture = expanded.charAt(file - 1) === capturer || expanded.charAt(file + 1) === capturer;
  return canCapture ? enPassant : '-';
}

function expandRank(rank: string): string {
  let expanded = '';
  for (const char of rank) {
    const emptyCount = Number.parseInt(char, 10);
    expanded += Number.isNaN(emptyCount) ? char : '.'.repeat(emptyCount);
  }
  return expanded;
}

// ============================================================================
// OpeningBook
// ============================================================================

export class OpeningBook {
  private readonly resultByNormalizedFen: Map<string, OpeningLookupResult>;
  private readonly mastersApiClient: MastersApiClient | null;

  constructor(entries: readonly OpeningBookEntry[], mastersApiClient: MastersApiClient | null = null) {
    this.resultByNormalizedFen = new Map();

    for (const entry of entries) {
      const key = normalizeFenForLookup(entry.fen);
      // ถ้า eco.json มี entry ชนกันที่ normalized FEN เดียวกัน (เช่นข้อมูลซ้ำจากหลายแหล่ง)
      // ให้ entry ที่มาก่อนในลิสต์ชนะเสมอ — ป้องกันผลลัพธ์ที่ไม่แน่นอน (non-deterministic) ระหว่างรัน
      if (!this.resultByNormalizedFen.has(key)) {
        this.resultByNormalizedFen.set(key, { eco: entry.eco, name: entry.name });
      }
    }

    this.mastersApiClient = mastersApiClient;
  }

  /**
   * สร้าง OpeningBook จากข้อมูล JSON ดิบ (ผลของการ `import ecoData from './eco.json'`
   * หรือ `fetch('/eco.json').then(r => r.json())`) พร้อม validate โครงสร้างขณะรันไทม์
   * เพราะข้อมูลจากไฟล์ static ไม่ได้ผ่านการเช็ค type ตอน compile
   */
  public static fromJson(json: unknown, mastersApiClient: MastersApiClient | null = null): OpeningBook {
    if (!Array.isArray(json)) {
      throw new OpeningBookError('ข้อมูล ECO book ต้องเป็น array ของ { fen, eco, name }');
    }
    const entries = json.map((raw, index) => parseEntry(raw, index));
    return new OpeningBook(entries, mastersApiClient);
  }

  /** จำนวน entry ที่โหลดสำเร็จในหนังสือเปิดเกม (หลังตัดรายการซ้ำที่ normalized FEN เดียวกันออกแล้ว) */
  public get size(): number {
    return this.resultByNormalizedFen.size;
  }

  /** ค้นหาชื่อ opening จาก FEN — คืน null ถ้าตำแหน่งนี้ไม่อยู่ในหนังสือ (ออกนอกทฤษฎีแล้ว) */
  public lookupOpening(fen: string): OpeningLookupResult | null {
    const key = normalizeFenForLookup(fen);
    return this.resultByNormalizedFen.get(key) ?? null;
  }

  /** ตำแหน่งนี้อยู่ในตำราเปิดหมาก (ECO book) หรือไม่ */
  public isInBook(fen: string): boolean {
    return this.lookupOpening(fen) !== null;
  }

  /**
   * วิเคราะห์ทั้งเกมแบบ offline: รับ FEN "หลังเดิน" ของแต่ละ ply เรียงจาก ply 1
   *
   * กติกา:
   *  - ply ใดที่ตำแหน่งหลังเดินอยู่ใน ECO book (และยังไม่เคยหลุด) => inBook = true
   *  - ply แรกที่ไม่อยู่ใน book => firstDeviationPly (หลังจากนั้น inBook = false
   *    ตลอด แม้ตำแหน่งจะกลับมา transpose เข้า book ทีหลัง)
   *  - bookDepthPlies = ply สุดท้ายที่ inBook
   *  - ecoCode/name ของสรุปเกม = ตำแหน่งที่ลึกที่สุดที่จับคู่ได้
   */
  public analyzeOpeningLine(
    fensAfterEachPly: readonly string[],
    options: OpeningLineOptions = {},
  ): OpeningLineAnalysis {
    const gapTolerance = Math.max(0, Math.floor(options.gapTolerancePlies ?? 0));
    const matches = fensAfterEachPly.map((fen) => this.lookupOpening(fen));

    const plies: PlyBookStatus[] = [];
    let lastMatch: OpeningLookupResult | null = null;
    let bookDepthPlies = 0;
    let firstDeviationPly: number | null = null;

    for (const [index, match] of matches.entries()) {
      const ply = index + 1;
      let inBook = false;

      if (firstDeviationPly === null) {
        if (match !== null || hasMatchWithin(matches, index + 1, gapTolerance)) {
          inBook = true;
        } else {
          firstDeviationPly = ply;
        }
      }

      if (inBook) {
        bookDepthPlies = ply;
        if (match !== null) {
          lastMatch = match;
        }
      }

      plies.push({
        ply,
        inBook,
        ecoCode: lastMatch?.eco ?? null,
        openingName: lastMatch?.name ?? null,
      });
    }

    return {
      plies,
      ecoCode: lastMatch?.eco ?? null,
      name: lastMatch?.name ?? null,
      bookDepthPlies,
      firstDeviationPly,
    };
  }

  /**
   * ดึงสถิติมืออาชีพสำหรับ FEN ที่ระบุผ่าน MastersApiClient ที่ inject เข้ามา —
   * คืน null ถ้าไม่มี client ต่อไว้ ผู้เรียกที่ต้องการ cache ผลลง IndexedDB (ตาม §1.3)
   * ให้ใช้ `MasterStatsProvider` (MasterStats.ts) แทนการเรียกเมธอดนี้ตรง ๆ
   */
  public async fetchMasterStats(fen: string): Promise<MasterStatsResult | null> {
    if (!this.mastersApiClient) {
      return null;
    }
    const normalizedFen = normalizeFenForLookup(fen);
    return this.mastersApiClient.fetchMasterStats(normalizedFen);
  }
}

function hasMatchWithin(
  matches: readonly (OpeningLookupResult | null)[],
  fromIndex: number,
  count: number,
): boolean {
  const end = Math.min(matches.length, fromIndex + count);
  for (let index = fromIndex; index < end; index += 1) {
    if (matches[index] !== null) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// Live-play context (offline only — ห้ามยิง API ระหว่างเล่นสด §1.3)
// ============================================================================

export interface LiveMoveContextInput {
  /** FEN หลังเดินตานี้ (ตาที่เพิ่งเดิน) */
  readonly fenAfter: string;
  /** context ของตาก่อนหน้าในเกมเดียวกัน (null = นี่คือ ply 1) */
  readonly previous: MoveLogContext | null;
  /** UCI ของตาก่อนหน้า (ตาของคู่ต่อสู้) — null ถ้าเป็น ply 1 */
  readonly opponentPrevMoveUci: string | null;
}

/**
 * สร้าง MoveLogContext ต่อตาโดยใช้เฉพาะ ECO book ในเครื่อง (O(1) ต่อตา)
 * เหมาะสำหรับเรียกจาก useGameStore ทุกครั้งที่เดิน — masterFrequency เป็น null
 * เสมอ เพราะต้องรอ Post-Game Analysis (ผลจาก enrichGameOpening จะเขียนทับ)
 *
 * กติกา inBook ในโหมดสดเข้มงวด (ไม่มี gap tolerance เพราะมองอนาคตไม่ได้)
 */
export function buildLiveMoveContext(book: OpeningBook, input: LiveMoveContextInput): MoveLogContext {
  const wasInBook = input.previous === null ? true : input.previous.inBook;
  const match = wasInBook ? book.lookupOpening(input.fenAfter) : null;

  if (match !== null) {
    return {
      ecoCode: match.eco,
      openingName: match.name,
      inBook: true,
      masterFrequency: null,
      opponentPrevMoveUci: input.opponentPrevMoveUci,
      opponentIntent: null,
    };
  }

  return {
    ecoCode: input.previous?.ecoCode ?? null,
    openingName: input.previous?.openingName ?? null,
    inBook: false,
    masterFrequency: null,
    opponentPrevMoveUci: input.opponentPrevMoveUci,
    opponentIntent: null,
  };
}

// ============================================================================
// Deviation quality
// ============================================================================

/** เกณฑ์ปรับได้: มืออาชีพเล่นตานี้ >= 5% ถือเป็น "ทางเลือกที่มีในทฤษฎี" */
export const MASTER_ALTERNATIVE_MIN_FREQUENCY = 0.05;
export const SOUND_MAX_LOSS_CP = 50;
export const INACCURACY_MAX_LOSS_CP = 100;
export const MISTAKE_MAX_LOSS_CP = 250;

/**
 * ประเมินคุณภาพของตาที่เริ่มหลุดตำรา
 *  1. มืออาชีพเล่นตานี้พอสมควร => 'master_alternative'
 *  2. มิฉะนั้นใช้ค่าเสีย engine (centipawn loss) จัดระดับ
 *  3. ไม่มีข้อมูลทั้งสองอย่าง => null (ยังประเมินไม่ได้ ไม่เดา)
 */
export function classifyDeviationQuality(evidence: DeviationEvidence): DeviationQuality | null {
  if (evidence.masterFrequency !== null && evidence.masterFrequency >= MASTER_ALTERNATIVE_MIN_FREQUENCY) {
    return 'master_alternative';
  }
  if (evidence.evalLossCp === null) {
    return null;
  }
  if (evidence.evalLossCp <= SOUND_MAX_LOSS_CP) return 'sound';
  if (evidence.evalLossCp <= INACCURACY_MAX_LOSS_CP) return 'inaccuracy';
  if (evidence.evalLossCp <= MISTAKE_MAX_LOSS_CP) return 'mistake';
  return 'blunder';
}

// ============================================================================
// Internal validation helpers
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEntry(raw: unknown, index: number): OpeningBookEntry {
  if (!isRecord(raw)) {
    throw new OpeningBookError(`ECO entry ที่ index ${index} ไม่ใช่ object`);
  }
  const { fen, eco, name } = raw;

  if (typeof fen !== 'string' || fen.length === 0) {
    throw new OpeningBookError(`ECO entry ที่ index ${index} ขาด field "fen" ที่เป็น string`);
  }
  if (typeof eco !== 'string' || eco.length === 0) {
    throw new OpeningBookError(`ECO entry ที่ index ${index} ขาด field "eco" ที่เป็น string`);
  }
  if (typeof name !== 'string' || name.length === 0) {
    throw new OpeningBookError(`ECO entry ที่ index ${index} ขาด field "name" ที่เป็น string`);
  }

  return { fen, eco, name };
}
