/**
 * MasterStats.ts
 * ---------------------------------------------------------------------------
 * ชั้น "สถิติมืออาชีพ" ของ Opening Book — Pure TypeScript (ไม่รู้จัก Dexie/fetch)
 * ทุกอย่างที่แตะ I/O ถูก inject ผ่าน interface (Ports):
 *   - `BookCacheStore`  : ที่เก็บแคช (implement ด้วย Dexie ที่ src/data/repositories)
 *   - `MastersApiClient`: ตัวยิง Lichess Masters API (src/data/api)
 *
 * นโยบาย (ตามข้อควรระวัง §1.3):
 *   1. เช็คแคชก่อนเสมอ — เจอ fenKey แล้วใช้ทันที ไม่ยิงซ้ำ
 *   2. ไม่เจอ -> ยิง API -> บันทึกแคชพร้อม fetchedAt
 *   3. Offline / โดน rate limit / ไม่มี token / แคชพัง => คืน `stats: null`
 *      ไม่ throw — ผู้เรียกใช้ข้อมูล ECO ในเครื่องต่อได้
 *   4. คำขอที่ fenKey เดียวกันพร้อมกันจะถูกรวมเป็น request เดียว
 *
 * ห้ามเรียก provider นี้ระหว่างเล่นสด — ใช้เฉพาะ Post-Game / Lazy Fetch
 * ---------------------------------------------------------------------------
 */

import type { BookCacheRecord } from '../../shared/types/schema';
import {
  normalizeFenForLookup,
  type MasterMoveStat,
  type MasterStatsResult,
  type MastersApiClient,
} from './OpeningBook';

// ============================================================================
// Master frequency
// ============================================================================

export interface PlayedMoveRef {
  readonly uci: string;
  /**
   * SAN ใช้เป็น fallback เมื่อ UCI ไม่ตรง — จำเป็นสำหรับการเข้าป้อม เพราะ Lichess
   * Explorer ส่ง UCI แบบ king-takes-rook ("e1h1") แต่ chess.js ให้ "e1g1"
   */
  readonly san?: string | undefined;
}

/**
 * สัดส่วนเกมมืออาชีพที่เดินตานี้ ในตำแหน่งที่ให้สถิติมา (0..1)
 *  - null  : ไม่มีเกมมืออาชีพผ่านตำแหน่งนี้เลย (ไม่มีข้อมูลให้เทียบ)
 *  - 0     : ตำแหน่งมีข้อมูล แต่ไม่มีมืออาชีพเล่นตานี้ในรายการที่ API ส่งมา
 *            (รวมตาที่นอกเหนือ top-N ที่ขอไว้ ซึ่งความถี่ต่ำมากอยู่แล้ว)
 */
export function computeMasterFrequency(stats: MasterStatsResult, move: PlayedMoveRef): number | null {
  if (stats.totalGames <= 0) {
    return null;
  }
  const byUci = stats.moves.find((candidate) => candidate.uci === move.uci);
  const wantedSan = move.san === undefined ? null : stripCheckSuffix(move.san);
  const bySan =
    wantedSan === null
      ? undefined
      : stats.moves.find((candidate) => stripCheckSuffix(candidate.san) === wantedSan);
  const match = byUci ?? bySan;
  if (match === undefined) {
    return 0;
  }
  return Math.min(1, match.totalGames / stats.totalGames);
}

function stripCheckSuffix(san: string): string {
  return san.replace(/[+#]+$/, '');
}

// ============================================================================
// Runtime validation (ข้อมูลจาก IndexedDB เป็น unknown — ห้าม cast)
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseMoveStat(raw: unknown): MasterMoveStat | null {
  if (!isRecord(raw)) {
    return null;
  }
  const { uci, san, whiteWins, draws, blackWins, totalGames } = raw;
  if (
    typeof uci !== 'string' ||
    typeof san !== 'string' ||
    !isCount(whiteWins) ||
    !isCount(draws) ||
    !isCount(blackWins) ||
    !isCount(totalGames)
  ) {
    return null;
  }
  return { uci, san, whiteWins, draws, blackWins, totalGames };
}

/** แปลง `unknown` (เช่น BookCacheRecord.raw) เป็น MasterStatsResult — null ถ้ารูปแบบไม่ถูกต้อง */
export function parseMasterStatsResult(raw: unknown): MasterStatsResult | null {
  if (!isRecord(raw)) {
    return null;
  }
  const { totalGames, moves, openingName, eco } = raw;
  if (!isCount(totalGames) || !Array.isArray(moves)) {
    return null;
  }
  const parsedMoves: MasterMoveStat[] = [];
  for (const item of moves) {
    const parsed = parseMoveStat(item);
    if (parsed === null) {
      return null;
    }
    parsedMoves.push(parsed);
  }
  return {
    totalGames,
    moves: parsedMoves,
    ...(typeof openingName === 'string' ? { openingName } : {}),
    ...(typeof eco === 'string' ? { eco } : {}),
  };
}

// ============================================================================
// Ports
// ============================================================================

/** Contract ของแคช — `DexieBookCacheStore` (src/data/repositories) implement ให้ */
export interface BookCacheStore {
  get(fenKey: string): Promise<BookCacheRecord | undefined>;
  put(record: BookCacheRecord): Promise<void>;
}

export type MasterStatsSource = 'cache' | 'network' | 'unavailable';

export interface MasterStatsLookup {
  /** null = ไม่มีข้อมูลสถิติ (offline / ไม่ได้ตั้งค่า client / ถูกจำกัด) — ให้ใช้ ECO ในเครื่องต่อ */
  readonly stats: MasterStatsResult | null;
  readonly source: MasterStatsSource;
}

export type MasterStatsErrorStage = 'cache-read' | 'cache-write' | 'network';

export interface MasterStatsProviderOptions {
  /** inject เวลาเพื่อให้ทดสอบได้ (ค่าเริ่มต้น: new Date()) */
  readonly now?: () => Date;
  /** อายุแคชสูงสุด (ms) — ไม่กำหนด = ไม่หมดอายุ (ตามสเปก: เจอแล้วใช้ทันที) */
  readonly maxCacheAgeMs?: number;
  /** hook สำหรับ log ข้อผิดพลาดที่ถูกกลืนไว้ (core ไม่ใช้ console) */
  readonly onError?: (stage: MasterStatsErrorStage, error: unknown) => void;
}

// ============================================================================
// Provider
// ============================================================================

export class MasterStatsProvider {
  private readonly cache: BookCacheStore | null;
  private readonly client: MastersApiClient | null;
  private readonly options: MasterStatsProviderOptions;
  private readonly inFlight = new Map<string, Promise<MasterStatsLookup>>();

  constructor(
    cache: BookCacheStore | null,
    client: MastersApiClient | null,
    options: MasterStatsProviderOptions = {},
  ) {
    this.cache = cache;
    this.client = client;
    this.options = options;
  }

  /** cache-first; ไม่ throw เมื่อ offline / API ล้มเหลว (throw เฉพาะ FEN ที่รูปแบบผิด) */
  public getStats(fen: string): Promise<MasterStatsLookup> {
    const fenKey = normalizeFenForLookup(fen);
    const pending = this.inFlight.get(fenKey);
    if (pending !== undefined) {
      return pending;
    }
    const task = this.resolve(fenKey).finally(() => {
      this.inFlight.delete(fenKey);
    });
    this.inFlight.set(fenKey, task);
    return task;
  }

  private async resolve(fenKey: string): Promise<MasterStatsLookup> {
    const cached = await this.readCache(fenKey);
    if (cached !== null) {
      return { stats: cached, source: 'cache' };
    }
    if (this.client === null) {
      return { stats: null, source: 'unavailable' };
    }

    let fetched: MasterStatsResult;
    try {
      fetched = await this.client.fetchMasterStats(fenKey);
    } catch (error) {
      this.options.onError?.('network', error);
      return { stats: null, source: 'unavailable' };
    }

    await this.writeCache(fenKey, fetched);
    return { stats: fetched, source: 'network' };
  }

  private async readCache(fenKey: string): Promise<MasterStatsResult | null> {
    if (this.cache === null) {
      return null;
    }
    let record: BookCacheRecord | undefined;
    try {
      record = await this.cache.get(fenKey);
    } catch (error) {
      this.options.onError?.('cache-read', error);
      return null;
    }
    if (record === undefined || this.isExpired(record)) {
      return null;
    }
    // raw ที่พัง/คนละเวอร์ชัน = ถือว่าไม่มีแคช (จะถูกเขียนทับหลังยิงใหม่)
    return parseMasterStatsResult(record.raw);
  }

  private async writeCache(fenKey: string, stats: MasterStatsResult): Promise<void> {
    if (this.cache === null) {
      return;
    }
    const now = this.options.now ?? (() => new Date());
    const record: BookCacheRecord = {
      fenKey,
      fetchedAt: now().toISOString(),
      ecoCode: stats.eco ?? null,
      openingName: stats.openingName ?? null,
      // schema เก็บ 1 ตัวเลขต่อตำแหน่ง แต่ความถี่เป็นของ "ตาเดิน" ไม่ใช่ตำแหน่ง
      // จึงเก็บ null และคำนวณต่อตาจาก raw ตอนอ่าน (computeMasterFrequency)
      masterFrequency: null,
      raw: stats,
    };
    try {
      await this.cache.put(record);
    } catch (error) {
      this.options.onError?.('cache-write', error);
    }
  }

  private isExpired(record: BookCacheRecord): boolean {
    const { maxCacheAgeMs } = this.options;
    if (maxCacheAgeMs === undefined) {
      return false;
    }
    const fetchedAtMs = Date.parse(record.fetchedAt);
    if (Number.isNaN(fetchedAtMs)) {
      return true;
    }
    const nowMs = (this.options.now ?? (() => new Date()))().getTime();
    return nowMs - fetchedAtMs > maxCacheAgeMs;
  }
}
