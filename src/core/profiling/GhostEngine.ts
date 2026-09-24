/**
 * GhostEngine.ts
 * ---------------------------------------------------------------------------
 * จำลองการเดินหมากของ "ผู้เล่นในอดีต" ตาม Phase 0 §4.5 — ทุกตา เช็คก่อนว่า
 * ตรงกับ habit pattern ที่เคยขุดพบหรือไม่ ถ้าตรง สุ่มเดินตามสถิติเดิม
 * (frequency/occurrences) ถ้าไม่ตรง fallback ไปใช้ engine จริงที่ตั้งความแรง
 * เทียบเท่า Elo ในอดีต แล้วจำลองเวลาคิดประกอบ
 *
 * ⚠️ 3 จุดที่ต้องแก้จากที่ระบุไว้ในโจทย์ (อธิบายละเอียดเพราะกระทบสถาปัตยกรรม):
 *
 * 1. [แก้แล้ว] Import path ผิด — เดิม `../../shared/types/schema` ชี้ไปที่
 *    `src/shared/types/schema.ts` ซึ่งไม่มีจริง ไฟล์นี้อยู่ที่
 *    `src/core/profiling/GhostEngine.ts` ดังนั้น `../../` จาก path นี้จะไปถึง
 *    `src/` เท่านั้น (ไม่ใช่ `src/data/`) ตามเอกสารติดตามงาน ไฟล์ schema.ts จริง
 *    อยู่ที่ `src/data/shared/types/schema.ts` — path ที่ถูกต้องจาก
 *    `src/core/profiling/` คือ `../../data/shared/types/schema` แก้เฉพาะ
 *    บรรทัด import นี้บรรทัดเดียว ไม่แตะโครงสร้างอื่น
 *
 * 2. `Square` ไม่ได้ถูก export จาก `../chess/GameEngine` จริง (import มาจาก
 *    chess.js ใช้ภายในเท่านั้น) — ไฟล์นี้จึง import `Square` ตรงจาก `chess.js`
 *
 * 3. ปัญหาที่ร้ายแรงกว่า: `HabitPattern.trigger`/`playerResponse` (ทั้งจาก
 *    HabitMiner.ts และตามตัวอย่าง JSON ใน Phase 0 §3.2) เป็น**ข้อความภาษาไทย
 *    สำหรับมนุษย์อ่าน** (เช่น "คู่ต่อสู้เดินม้าไปช่อง g5") ไม่ใช่ข้อมูลที่ machine
 *    parse ไปหาตา UCI ได้ตรงๆ — การพยายาม regex ข้อความไทยเพื่อแยกหาตาเดินจะ
 *    เปราะบางมากและเข้าข่าย "เดาสูตรมั่วแล้วนำเสนอเป็นข้อเท็จจริง" ที่กฎเหล็ก
 *    ของโปรเจกต์ห้ามไว้ ไฟล์นี้จึงรับ `GhostHabitSignal[]` (ประกาศเองด้านล่าง)
 *    ที่มี `triggerMoveKey`/`responseMoveKey` แบบ machine-readable ("n->g5")
 *    แยกต่างหากจาก `HabitPattern` ที่ใช้แสดงผล UI — **ต้องเพิ่ม field นี้ใน
 *    HabitMiner.ts (และ schema.ts ถ้าจะ persist) ก่อนของจริงจะทำงานได้** เพราะ
 *    ตอนนี้ HabitMiner.ts คำนวณ moveKey ภายในอยู่แล้ว (ฟังก์ชัน describeMoveKey)
 *    แต่ไม่ได้ export ค่าดิบนั้นออกมา มีแต่ข้อความไทยที่แปลงแล้ว
 *
 * 4. โจทย์ไม่ได้ระบุ dependency ไปยัง EnginePool/Stockfish เลย แต่การ "ใช้ค่า
 *    estimatedElo ในอดีตเพื่อกำหนดความแรง" ของฝั่ง fallback จำเป็นต้องเรียก
 *    engine จริงที่ตั้ง Elo แล้ว — ถ้าไม่มี engine จริงมาช่วย การเลือกตาแบบสุ่ม
 *    จาก legalMoves เฉยๆ แล้วอ้างว่า "จำลอง Elo" จะเป็นข้อมูลปลอมที่กฎเหล็กของ
 *    โปรเจกต์ห้ามเช่นกัน ไฟล์นี้จึง inject `EngineMoveProvider` ผ่าน constructor
 *    แทน (ตามธรรมเนียม "inject ผ่าน parameter/constructor เสมอ" ของโปรเจกต์) —
 *    ผู้เรียกจริงจะ implement มันด้วยการเรียก `EnginePool.setPlayStrength()`
 *    เทียบเท่า Elo แล้วตามด้วย `requestPlayMove()` เอง `selectMove()` จึงเป็น
 *    `async` (ต่างจากที่โจทย์ไม่ได้ระบุ แต่จำเป็นเพราะเรียก engine จริงเป็น Promise)
 * ---------------------------------------------------------------------------
 */

import { GameEngine, type LegalMove } from '../chess/GameEngine';
import type { Square } from 'chess.js';
import type { HabitPattern } from '../../data/shared/types/schema';

// ============================================================================
// Types — input
// ============================================================================

/**
 * สัญญาณนิสัยแบบ machine-readable สำหรับ GhostEngine — ดูหมายเหตุข้อ 3 บนหัวไฟล์
 * ว่าทำไมแยกจาก HabitPattern (ซึ่งเป็น text ล้วนสำหรับ UI)
 */
export interface GhostHabitSignal {
  readonly patternId: string;
  /** "piece->square" ของตาคู่ต่อสู้ที่เป็น trigger เช่น "n->g5" (รูปแบบเดียวกับที่ HabitMiner.ts ใช้ภายใน) */
  readonly triggerMoveKey: string;
  /** "piece->square" ของตาตอบสนองที่ผู้เล่นมักเดิน เช่น "p->h6" */
  readonly responseMoveKey: string;
  readonly frequency: number;
  readonly occurrences: number;
  /** อ้างอิงกลับไปยัง HabitPattern ตัวเต็ม (สำหรับแสดงผล/debug) — ไม่จำเป็นต่อการคำนวณของ GhostEngine เอง */
  readonly sourcePattern?: HabitPattern;
}

/**
 * ⚠️ Type นี้เป็น mirror เฉพาะส่วนที่ GhostEngine ใช้จริงของ PlayerProfileRecord
 * (Schema 2B) — ไม่ import ตรงจาก schema.ts เพราะยังไม่เคยเห็นเนื้อไฟล์จริงใน
 * เซสชันนี้ (path ที่โจทย์ให้มาก็ผิดด้วย ดูหมายเหตุข้อ 1 บนหัวไฟล์)
 *
 * ข้อสังเกตสำคัญ: `estimatedEloAtSnapshot` ไม่ควรมาจาก `PlayerProfileRecord.
 * aggregate.estimatedElo` ตรงๆ เพราะ field นั้นคือ Elo ปัจจุบันล่าสุด ไม่ใช่ Elo
 * ณ ช่วงเวลาที่เลือกย้อนหลัง — ผู้เรียกที่สร้าง snapshot นี้ควรดึงจาก entry ที่
 * ตรงกับวันที่ที่เลือกใน `PlayerProfileRecord.progression[].estimatedElo` แทน
 */
export interface GhostEngineProfileSnapshot {
  readonly estimatedEloAtSnapshot: number;
  /** เวลาคิดเฉลี่ย (ms) ของผู้เล่น ณ ช่วงเวลานั้น — undefined ถ้าไม่มีข้อมูลจริง (ห้ามเดาเป็นค่าคงที่แล้วอ้างว่ามาจากสถิติจริง) */
  readonly avgThinkTimeMsAtSnapshot?: number;
  readonly thinkTimeStdDevMsAtSnapshot?: number;
  readonly habitSignals: readonly GhostHabitSignal[];
  /** Profile patterns from schema; reactive pattern IDs are decoded into signals without parsing UI text. */
  readonly habitPatterns?: readonly HabitPattern[];
}

export interface GhostSelectMoveParams {
  readonly profileSnapshot: GhostEngineProfileSnapshot;
  /** ตำแหน่งปัจจุบัน (หลังคู่ต่อสู้เดินเสร็จแล้ว ตาต่อไปเป็นของ ghost) */
  readonly fen: string;
  /** UCI ของตาล่าสุดที่คู่ต่อสู้เพิ่งเดิน — null ถ้าเป็นตาแรกสุดของเกม (ไม่มี trigger ให้จับคู่) */
  readonly opponentLastMoveUci: string | null;
}

/**
 * จุดต่อ (dependency injection) ไปยัง engine จริง — ผู้เรียกจริง implement โดยเรียก
 * `EnginePool.setPlayStrength()`/custom strength ให้เทียบเท่า `estimatedElo` แล้ว
 * ตามด้วย `EnginePool.requestPlayMove()` จริง ไฟล์นี้ไม่ผูกกับ EnginePool ตรงๆ
 * เพื่อให้ทดสอบ GhostEngine ได้ง่ายด้วย mock provider โดยไม่ต้องสร้าง Stockfish
 * worker จริงในเทส
 */
export interface EngineMoveProvider {
  /** คืน UCI ของตาที่ engine เลือก ณ ความแรงเทียบเท่า estimatedElo ที่ระบุ — ต้องคืนตาที่อยู่ใน legalMoveUcis เท่านั้น */
  selectMoveAtStrength(fen: string, legalMoveUcis: readonly string[], estimatedElo: number): Promise<string>;
}

// ============================================================================
// Types — output
// ============================================================================

export type GhostMoveSource = 'habit' | 'engine_fallback';

export interface GhostMoveSelection {
  readonly moveUci: string;
  readonly source: GhostMoveSource;
  readonly matchedPattern?: HabitPattern;
  readonly simulatedThinkTimeMs: number;
}

export class GhostEngineError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'GhostEngineError';
  }
}

// ============================================================================
// Constants
// ============================================================================

const MIN_SIMULATED_THINK_TIME_MS = 300;
/** ใช้เมื่อไม่มีข้อมูล think time จริงของผู้เล่นในช่วงเวลานั้นเลย — ค่ากลางๆ ที่สมเหตุสมผลสำหรับหมากรุกออนไลน์ทั่วไป ไม่ใช่ค่าที่อ้างว่ามาจากสถิติจริง */
const FALLBACK_THINK_TIME_MS_WHEN_NO_DATA = 5_000;
/** สัดส่วนส่วนเบี่ยงเบนมาตรฐานเทียบกับค่าเฉลี่ย เมื่อมีแค่ค่าเฉลี่ยแต่ไม่มี stdDev จริงมาให้ */
const DEFAULT_STD_DEV_RATIO = 0.4;
/**
 * การตอบสนองตามนิสัย (reflexive habit) มักเร็วกว่าการตัดสินใจแบบไตร่ตรอง —
 * ค่าคงที่นี้เป็น heuristic จากหลักจิตวิทยาการเล่นหมากรุกทั่วไป ไม่ใช่ตัวเลขที่
 * วัดจากข้อมูลจริงของผู้เล่นคนนี้โดยเฉพาะ (ระบุไว้ชัดเจนเพื่อไม่ให้เข้าใจผิดว่า
 * เป็นสถิติที่วัดได้จริง)
 */
const HABIT_RESPONSE_SPEED_FACTOR = 0.6;

// ============================================================================
// GhostEngine
// ============================================================================

export class GhostEngine {
  constructor(
    private readonly engineMoveProvider: EngineMoveProvider,
    private readonly random: () => number = Math.random,
  ) {}

  /** เลือกตาเดินของ ghost หนึ่งตา — ดูลำดับการตัดสินใจในหมายเหตุของแต่ละเมธอดภายใน */
  public async selectMove(params: GhostSelectMoveParams): Promise<GhostMoveSelection> {
    const { profileSnapshot, fen, opponentLastMoveUci } = params;

    let gameEngine: GameEngine;
    try {
      gameEngine = new GameEngine(fen);
    } catch (err) {
      throw new GhostEngineError(`FEN ไม่ถูกต้อง: "${fen}"`, err);
    }

    const legalMoves = gameEngine.getLegalMoves();
    if (legalMoves.length === 0) {
      throw new GhostEngineError(
        'ไม่มีตาที่ถูกกฎให้ ghost เดินในตำแหน่งนี้ (เกมควรจบไปแล้ว) — ตรวจสอบ GameEngine.getStatus() ก่อนเรียก selectMove()',
      );
    }

    const habitSignals = profileSnapshot.habitSignals.length > 0
      ? profileSnapshot.habitSignals
      : signalsFromHabitPatterns(profileSnapshot.habitPatterns ?? []);
    const habitSelection = this.tryMatchHabit(profileSnapshot, habitSignals, gameEngine, opponentLastMoveUci, legalMoves);
    if (habitSelection) {
      return habitSelection;
    }

    return this.selectFallbackMove(profileSnapshot, gameEngine, legalMoves);
  }

  // --------------------------------------------------------------------------
  // 1) Habit matching
  // --------------------------------------------------------------------------

  /**
   * เช็คว่าตาล่าสุดของคู่ต่อสู้ตรงกับ trigger ของนิสัยเดิมหรือไม่ — ถ้าตรง สุ่มว่า
   * "ครั้งนี้จะทำตามนิสัยเดิมหรือไม่" ตามสัดส่วนสถิติจริง (frequency/occurrences)
   * ไม่ใช่ทำตามนิสัยเดิม 100% ทุกครั้ง เพราะข้อมูลจริงบอกว่าผู้เล่นก็ไม่ได้ทำตาม
   * นิสัยนี้ทุกครั้งที่เจอ trigger (occurrences > frequency เสมอในกรณีทั่วไป)
   */
  private tryMatchHabit(
    profileSnapshot: GhostEngineProfileSnapshot,
    habitSignals: readonly GhostHabitSignal[],
    gameEngine: GameEngine,
    opponentLastMoveUci: string | null,
    legalMoves: readonly LegalMove[],
  ): GhostMoveSelection | null {
    if (opponentLastMoveUci === null || opponentLastMoveUci.length < 4) {
      return null; // ไม่มีตาก่อนหน้าให้จับคู่ trigger (ตาแรกสุดของเกม) หรือ uci ผิดรูปแบบ
    }

    const opponentDestinationSquare = opponentLastMoveUci.slice(2, 4) as Square;
    const opponentPieceOnBoard = gameEngine.getBoard().find((info) => info.square === opponentDestinationSquare);
    if (!opponentPieceOnBoard) {
      return null; // หาไม่เจอ (เช่นตาที่เพิ่งเดินเป็นตากินแล้วข้อมูลไม่ตรงกัน) — ปล่อยไป fallback
    }

    const triggerMoveKey = `${opponentPieceOnBoard.piece}->${opponentDestinationSquare}`;
    const matchingSignals = habitSignals.filter((signal) => signal.triggerMoveKey === triggerMoveKey);
    if (matchingSignals.length === 0) {
      return null;
    }

    // ถ้า trigger เดียวกันเคยมีหลาย response ต่างกัน (นิสัยไม่คงเส้นคงวา) สุ่มถ่วงน้ำหนักตาม frequency
    const selectedSignal = weightedRandomPick(matchingSignals, (signal) => signal.frequency, this.random);
    if (!selectedSignal) {
      return null;
    }

    const rollProbability = selectedSignal.occurrences > 0 ? selectedSignal.frequency / selectedSignal.occurrences : 0;
    if (this.random() > rollProbability) {
      return null; // ครั้งนี้ "สุ่มไม่ติด" นิสัยเดิม — ปล่อยให้ fallback ไปที่ engine strength จำลองแทน
    }

    const [responsePiece, responseSquare] = selectedSignal.responseMoveKey.split('->');
    const candidateMove = legalMoves.find((move) => move.to === responseSquare && move.piece === responsePiece);
    if (!candidateMove) {
      return null; // นิสัยเดิมไม่ถูกกฎในบริบทปัจจุบัน (ตำแหน่งเปลี่ยนไปจากตอนที่ขุดพบ pattern) — fallback แทน
    }

    return {
      moveUci: candidateMove.uci,
      source: 'habit',
      matchedPattern: selectedSignal.sourcePattern,
      simulatedThinkTimeMs: this.simulateThinkTime(profileSnapshot, 'habit'),
    };
  }

  // --------------------------------------------------------------------------
  // 2) Engine-strength fallback
  // --------------------------------------------------------------------------

  private async selectFallbackMove(
    profileSnapshot: GhostEngineProfileSnapshot,
    gameEngine: GameEngine,
    legalMoves: readonly LegalMove[],
  ): Promise<GhostMoveSelection> {
    const legalMoveUcis = legalMoves.map((move) => move.uci);
    const fen = gameEngine.getFen();

    let moveUci: string;
    try {
      moveUci = await this.engineMoveProvider.selectMoveAtStrength(fen, legalMoveUcis, profileSnapshot.estimatedEloAtSnapshot);
    } catch (err) {
      throw new GhostEngineError('engineMoveProvider.selectMoveAtStrength() ล้มเหลว — ไม่สามารถจำลองตาเดินแบบ fallback ได้', err);
    }

    if (!legalMoveUcis.includes(moveUci)) {
      throw new GhostEngineError(`engineMoveProvider คืนตา "${moveUci}" ที่ไม่ถูกกฎในตำแหน่งปัจจุบัน (FEN: ${fen})`);
    }

    return {
      moveUci,
      source: 'engine_fallback',
      simulatedThinkTimeMs: this.simulateThinkTime(profileSnapshot, 'engine_fallback'),
    };
  }

  // --------------------------------------------------------------------------
  // 3) Think-time simulation
  // --------------------------------------------------------------------------

  private simulateThinkTime(profileSnapshot: GhostEngineProfileSnapshot, source: GhostMoveSource): number {
    const meanMs = profileSnapshot.avgThinkTimeMsAtSnapshot;

    const baseThinkTimeMs =
      meanMs !== undefined
        ? sampleGaussian(this.random, meanMs, profileSnapshot.thinkTimeStdDevMsAtSnapshot ?? meanMs * DEFAULT_STD_DEV_RATIO)
        : FALLBACK_THINK_TIME_MS_WHEN_NO_DATA;

    const sourceFactor = source === 'habit' ? HABIT_RESPONSE_SPEED_FACTOR : 1;

    return Math.round(Math.max(MIN_SIMULATED_THINK_TIME_MS, baseThinkTimeMs * sourceFactor));
  }
}

function signalsFromHabitPatterns(patterns: readonly HabitPattern[]): readonly GhostHabitSignal[] {
  const signals: GhostHabitSignal[] = [];
  for (const pattern of patterns) {
    const prefix = 'reactive_response_';
    if (!pattern.patternId.startsWith(prefix)) continue;
    const encoded = pattern.patternId.slice(prefix.length);
    const separator = encoded.indexOf('|');
    if (separator <= 0 || separator === encoded.length - 1) continue;
    const triggerMoveKey = encoded.slice(0, separator);
    const responseMoveKey = encoded.slice(separator + 1);
    if (!triggerMoveKey.includes('->') || !responseMoveKey.includes('->')) continue;
    signals.push({
      patternId: pattern.patternId,
      triggerMoveKey,
      responseMoveKey,
      frequency: pattern.frequency,
      occurrences: pattern.occurrences,
      sourcePattern: pattern,
    });
  }
  return signals;
}

// ============================================================================
// Helpers
// ============================================================================

/** สุ่มเลือกสมาชิกหนึ่งตัวจากลิสต์ ถ่วงน้ำหนักตามฟังก์ชันที่ระบุ — คืน null ถ้าน้ำหนักรวมเป็น 0 หรือลิสต์ว่าง */
function weightedRandomPick<T>(items: readonly T[], weightOf: (item: T) => number, random: () => number): T | null {
  if (items.length === 0) return null;

  const totalWeight = items.reduce((sum, item) => sum + Math.max(0, weightOf(item)), 0);
  if (totalWeight <= 0) return null;

  let threshold = random() * totalWeight;
  for (const item of items) {
    threshold -= Math.max(0, weightOf(item));
    if (threshold <= 0) return item;
  }
  return items[items.length - 1];
}

/** สุ่มค่าจากการแจกแจงปกติ (Box-Muller transform) — ใช้ this.random ที่ inject ได้ ไม่พึ่ง Math.random ตรงๆ เพื่อให้ unit test กำหนดผลลัพธ์ตายตัวได้ */
function sampleGaussian(random: () => number, mean: number, stdDev: number): number {
  const u1 = Math.max(Number.EPSILON, random());
  const u2 = random();
  const standardNormal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + standardNormal * stdDev;
}