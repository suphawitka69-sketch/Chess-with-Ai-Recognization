/**
 * LichessMastersApiClient.ts
 * ---------------------------------------------------------------------------
 * Implement `MastersApiClient` (src/core/pedagogy/OpeningBook.ts) ด้วย fetch จริง
 * เรียกใช้ผ่าน `MasterStatsProvider` เท่านั้น (ซึ่งเช็ค db.bookCache ก่อนเสมอ)
 *
 * ข้อควรรู้ (ตรวจสอบเมื่อ ก.ย. 2026):
 *  - Lichess Explorer เริ่มบังคับ Personal API Token ทุก request (กลางปี 2026)
 *  - Lichess ห้ามฝัง token ใน bundle/แอปที่แจกผู้ใช้ => โปรดตั้ง `baseUrl` ชี้ไปที่
 *    serverless proxy ของโปรเจกต์ (proxy เป็นคนแนบ Authorization) แล้วปล่อย
 *    `authToken` ว่างไว้ฝั่งเบราว์เซอร์ ใช้ `authToken` ตรง ๆ เฉพาะ dev/Node เท่านั้น
 *  - นโยบายของ Lichess: ยิงทีละ request และถ้าโดน 429 ให้พัก ~60 วินาที
 *    client นี้จึงเข้าคิวทีละ request, เว้นระยะขั้นต่ำ, และหยุดยิงระหว่างช่วง backoff
 *
 * ทุกความล้มเหลวโยน `MastersApiError` (มี reason) — `MasterStatsProvider` จะจับแล้ว
 * ตกกลับไปใช้ ECO ในเครื่อง ผู้ใช้จึงไม่เห็น Runtime Error
 * ---------------------------------------------------------------------------
 */

import type {
  MasterMoveStat,
  MasterStatsResult,
  MastersApiClient,
} from '../../core/pedagogy/OpeningBook';

export type MastersApiFailureReason =
  | 'unauthorized' // 401/403: ไม่มี/ใช้ token ไม่ได้
  | 'rate_limited' // 429 หรืออยู่ในช่วง backoff
  | 'http_error'
  | 'network'
  | 'timeout'
  | 'invalid_response';

export class MastersApiError extends Error {
  public readonly reason: MastersApiFailureReason;
  public readonly status: number | null;

  constructor(message: string, reason: MastersApiFailureReason, status: number | null = null) {
    super(message);
    this.name = 'MastersApiError';
    this.reason = reason;
    this.status = status;
  }
}

export interface LichessMastersApiClientOptions {
  /** ค่าเริ่มต้น https://explorer.lichess.ovh — แนะนำให้ชี้ไปที่ proxy ของโปรเจกต์ */
  readonly baseUrl?: string;
  /** Personal API Token (ไม่ต้องมี scope) — ห้ามใส่ในโค้ดที่ส่งถึงผู้ใช้ */
  readonly authToken?: string;
  readonly fetchImpl?: typeof fetch;
  /** ค่าเริ่มต้น 8000 ms */
  readonly timeoutMs?: number;
  /** เว้นระยะขั้นต่ำระหว่างสอง request (ค่าเริ่มต้น 1000 ms) */
  readonly minRequestIntervalMs?: number;
  /** พักหลังโดน 429 / 401 (ค่าเริ่มต้น 60000 ms) */
  readonly backoffMs?: number;
  /** จำนวนตาเดินยอดนิยมที่ขอ (ค่าเริ่มต้น 20, สูงสุดของ API = 64) */
  readonly maxMoves?: number;
  /** inject สำหรับทดสอบ */
  readonly nowMs?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_BASE_URL = 'https://explorer.lichess.ovh';

export class LichessMastersApiClient implements MastersApiClient {
  private readonly baseUrl: string;
  private readonly authToken: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private readonly backoffMs: number;
  private readonly maxMoves: number;
  private readonly nowMs: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private queue: Promise<void> = Promise.resolve();
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  private blockedUntil = Number.NEGATIVE_INFINITY;
  private blockedReason: MastersApiFailureReason = 'rate_limited';

  constructor(options: LichessMastersApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.authToken = options.authToken;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.minIntervalMs = options.minRequestIntervalMs ?? 1000;
    this.backoffMs = options.backoffMs ?? 60_000;
    this.maxMoves = Math.min(64, Math.max(1, Math.floor(options.maxMoves ?? 20)));
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  public fetchMasterStats(normalizedFen: string): Promise<MasterStatsResult> {
    const run = this.queue.then(() => this.execute(normalizedFen));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async execute(normalizedFen: string): Promise<MasterStatsResult> {
    if (this.nowMs() < this.blockedUntil) {
      throw new MastersApiError('ยังอยู่ในช่วงพักหลังถูกจำกัด (backoff)', this.blockedReason);
    }

    const waitMs = this.lastRequestAt + this.minIntervalMs - this.nowMs();
    if (waitMs > 0) {
      await this.sleep(waitMs);
    }
    this.lastRequestAt = this.nowMs();

    const url = new URL('/masters', this.baseUrl);
    url.searchParams.set('fen', normalizedFen);
    url.searchParams.set('moves', String(this.maxMoves));
    url.searchParams.set('topGames', '0'); // ไม่ต้องการรายการเกมตัวอย่าง ลด payload

    const headers = new Headers({ Accept: 'application/json' });
    if (this.authToken !== undefined && this.authToken.length > 0) {
      headers.set('Authorization', `Bearer ${this.authToken}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), { headers, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new MastersApiError(`Lichess Masters API timeout (${this.timeoutMs} ms)`, 'timeout');
      }
      throw new MastersApiError(`เรียก Lichess Masters API ไม่สำเร็จ: ${describeError(error)}`, 'network');
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429) {
      this.block('rate_limited');
      throw new MastersApiError('Lichess Masters API: 429 Too Many Requests', 'rate_limited', 429);
    }
    if (response.status === 401 || response.status === 403) {
      this.block('unauthorized');
      throw new MastersApiError(
        `Lichess Masters API ปฏิเสธคำขอ (${response.status}) — ตรวจสอบ token/proxy`,
        'unauthorized',
        response.status,
      );
    }
    if (!response.ok) {
      throw new MastersApiError(`Lichess Masters API HTTP ${response.status}`, 'http_error', response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new MastersApiError(`อ่าน JSON ไม่ได้: ${describeError(error)}`, 'invalid_response', response.status);
    }
    return parseLichessMastersResponse(body);
  }

  private block(reason: MastersApiFailureReason): void {
    this.blockedReason = reason;
    this.blockedUntil = this.nowMs() + this.backoffMs;
  }
}

// ============================================================================
// Response parsing (ข้อมูลจาก network เป็น unknown — validate ก่อนใช้ ไม่ cast)
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCount(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function invalid(detail: string): MastersApiError {
  return new MastersApiError(`รูปแบบผลลัพธ์จาก Lichess Masters ไม่ถูกต้อง: ${detail}`, 'invalid_response');
}

/**
 * แปลง JSON ของ `/masters` ({ white, draws, black, moves: [{ uci, san, white, draws, black }],
 * opening: { eco, name } | null }) เป็น `MasterStatsResult`
 */
export function parseLichessMastersResponse(body: unknown): MasterStatsResult {
  if (!isRecord(body)) {
    throw invalid('root ไม่ใช่ object');
  }
  const white = readCount(body, 'white');
  const draws = readCount(body, 'draws');
  const black = readCount(body, 'black');
  const rawMoves = body['moves'];
  if (white === null || draws === null || black === null || !Array.isArray(rawMoves)) {
    throw invalid('ขาด white/draws/black หรือ moves');
  }

  const moves: MasterMoveStat[] = [];
  for (const [index, item] of rawMoves.entries()) {
    if (!isRecord(item)) {
      throw invalid(`moves[${index}] ไม่ใช่ object`);
    }
    const uci = item['uci'];
    const san = item['san'];
    const moveWhite = readCount(item, 'white');
    const moveDraws = readCount(item, 'draws');
    const moveBlack = readCount(item, 'black');
    if (typeof uci !== 'string' || typeof san !== 'string' || moveWhite === null || moveDraws === null || moveBlack === null) {
      throw invalid(`moves[${index}] ขาด field ที่จำเป็น`);
    }
    moves.push({
      uci,
      san,
      whiteWins: moveWhite,
      draws: moveDraws,
      blackWins: moveBlack,
      totalGames: moveWhite + moveDraws + moveBlack,
    });
  }

  const opening = body['opening'];
  const eco = isRecord(opening) ? opening['eco'] : undefined;
  const openingName = isRecord(opening) ? opening['name'] : undefined;

  return {
    totalGames: white + draws + black,
    moves,
    ...(typeof eco === 'string' ? { eco } : {}),
    ...(typeof openingName === 'string' ? { openingName } : {}),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
