import { describe, expect, it } from 'vitest';
import { LichessMastersApiClient, MastersApiError, parseLichessMastersResponse } from '../../src/data/api/LichessMastersApiClient';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';

const BODY = {
  white: 60, draws: 30, black: 10,
  moves: [
    { uci: 'e2e4', san: 'e4', white: 30, draws: 15, black: 5, averageRating: 2500 },
    { uci: 'd2d4', san: 'd4', white: 20, draws: 10, black: 3 },
  ],
  topGames: [],
  opening: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function reasonOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof MastersApiError ? error.reason : 'other';
  }
}

describe('parseLichessMastersResponse', () => {
  it('แปลง white/draws/black เป็น totalGames ต่อตำแหน่งและต่อตาเดิน', () => {
    const parsed = parseLichessMastersResponse(BODY);
    expect(parsed.totalGames).toBe(100);
    expect(parsed.moves[0]).toEqual({ uci: 'e2e4', san: 'e4', whiteWins: 30, draws: 15, blackWins: 5, totalGames: 50 });
  });

  it('รูปแบบผิด -> MastersApiError(invalid_response)', () => {
    expect(() => parseLichessMastersResponse({ moves: [] })).toThrow(MastersApiError);
  });
});

describe('LichessMastersApiClient', () => {
  it('ส่ง fen/moves/topGames และแนบ Bearer token เมื่อกำหนด', async () => {
    let seenUrl = '';
    let seenAuth: string | null = null;
    const client = new LichessMastersApiClient({
      baseUrl: 'https://proxy.example.test',
      authToken: 'lip_test',
      minRequestIntervalMs: 0,
      fetchImpl: async (input, init) => {
        seenUrl = String(input);
        seenAuth = new Headers(init?.headers).get('Authorization');
        return jsonResponse(BODY);
      },
    });
    const result = await client.fetchMasterStats(FEN);
    expect(result.totalGames).toBe(100);
    const url = new URL(seenUrl);
    expect(url.pathname).toBe('/masters');
    expect(url.searchParams.get('fen')).toBe(FEN);
    expect(url.searchParams.get('topGames')).toBe('0');
    expect(seenAuth).toBe('Bearer lip_test');
  });

  it('429: โยน rate_limited แล้วไม่ยิง network ซ้ำในช่วง backoff', async () => {
    let calls = 0;
    let now = 0;
    const client = new LichessMastersApiClient({
      minRequestIntervalMs: 0,
      backoffMs: 60_000,
      nowMs: () => now,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({}, 429);
      },
    });
    expect(await reasonOf(client.fetchMasterStats(FEN))).toBe('rate_limited');
    expect(await reasonOf(client.fetchMasterStats(FEN))).toBe('rate_limited');
    expect(calls).toBe(1);
    now = 61_000; // พ้น backoff แล้วลองใหม่ได้
    await reasonOf(client.fetchMasterStats(FEN));
    expect(calls).toBe(2);
  });

  it('401/403 -> unauthorized, network ล่ม -> network, timeout -> timeout', async () => {
    const unauthorized = new LichessMastersApiClient({ minRequestIntervalMs: 0, fetchImpl: async () => jsonResponse({}, 401) });
    expect(await reasonOf(unauthorized.fetchMasterStats(FEN))).toBe('unauthorized');

    const offline = new LichessMastersApiClient({
      minRequestIntervalMs: 0,
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(await reasonOf(offline.fetchMasterStats(FEN))).toBe('network');

    const slow = new LichessMastersApiClient({
      minRequestIntervalMs: 0,
      timeoutMs: 20,
      fetchImpl: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    });
    expect(await reasonOf(slow.fetchMasterStats(FEN))).toBe('timeout');
  });

  it('เข้าคิวทีละ request และเว้นระยะขั้นต่ำ', async () => {
    const sleeps: number[] = [];
    let now = 0;
    const client = new LichessMastersApiClient({
      minRequestIntervalMs: 1000,
      nowMs: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      fetchImpl: async () => jsonResponse(BODY),
    });
    await Promise.all([client.fetchMasterStats(FEN), client.fetchMasterStats(FEN)]);
    expect(sleeps).toEqual([1000]); // request แรกไม่ต้องรอ, ตัวที่สองรอ 1000 ms
  });
});
