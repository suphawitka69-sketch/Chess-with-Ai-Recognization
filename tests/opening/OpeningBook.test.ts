import { describe, expect, it } from 'vitest';
import type { BookCacheRecord } from '../../src/shared/types/schema';
import { computeMasterFrequency, MasterStatsProvider, parseMasterStatsResult, type BookCacheStore } from '../../src/core/pedagogy/MasterStats';
import {
  buildLiveMoveContext,
  classifyDeviationQuality,
  normalizeFenForLookup,
  OpeningBook,
  OpeningBookError,
  type MasterMoveStat,
  type MasterStatsResult,
  type MastersApiClient,
} from '../../src/core/pedagogy/OpeningBook';
import { enrichGameOpening, type GamePlyInput } from '../../src/core/pedagogy/OpeningEnrichment';

// ---- ข้อมูลทดสอบ: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 ---------------------------------
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const F1 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'; // ep แบบ "ใส่ทุกครั้ง"
const F2 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2';
const F3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
const F4 = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
const F5 = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
const F6 = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

// ECO จำลอง: จงใจไม่มี F4 (ช่องว่าง 1 ply) และไม่มี F6
const ECO = [
  { fen: F1, eco: 'B00', name: "King's Pawn Opening" },
  { fen: F2, eco: 'C20', name: "King's Pawn Game" },
  { fen: F3, eco: 'C40', name: "King's Knight Opening" },
  { fen: F5.replace(' 3 3', ' 0 1'), eco: 'C50', name: 'Italian Game' }, // ตัวนับต่างจากตอน lookup
];

const GAME: readonly GamePlyInput[] = [
  { ply: 1, fenBefore: START, fenAfter: F1, uci: 'e2e4', san: 'e4' },
  { ply: 2, fenBefore: F1, fenAfter: F2, uci: 'e7e5', san: 'e5' },
  { ply: 3, fenBefore: F2, fenAfter: F3, uci: 'g1f3', san: 'Nf3' },
  { ply: 4, fenBefore: F3, fenAfter: F4, uci: 'b8c6', san: 'Nc6' },
  { ply: 5, fenBefore: F4, fenAfter: F5, uci: 'f1c4', san: 'Bc4' },
  { ply: 6, fenBefore: F5, fenAfter: F6, uci: 'g8f6', san: 'Nf6' },
];

function move(uci: string, san: string, totalGames: number): MasterMoveStat {
  return { uci, san, whiteWins: totalGames, draws: 0, blackWins: 0, totalGames };
}

class MemoryCache implements BookCacheStore {
  public readonly records = new Map<string, BookCacheRecord>();
  public async get(fenKey: string): Promise<BookCacheRecord | undefined> {
    return this.records.get(fenKey);
  }
  public async put(record: BookCacheRecord): Promise<void> {
    this.records.set(record.fenKey, record);
  }
}

/** client จำลอง: มีสถิติแค่ START (1000 เกม) และ F1 (600 เกม) ที่เหลือ 0 เกม */
class FakeClient implements MastersApiClient {
  public calls: string[] = [];
  public async fetchMasterStats(normalizedFen: string): Promise<MasterStatsResult> {
    this.calls.push(normalizedFen);
    if (normalizedFen === normalizeFenForLookup(START)) {
      return { totalGames: 1000, moves: [move('e2e4', 'e4', 500), move('d2d4', 'd4', 400)], eco: 'A00' };
    }
    if (normalizedFen === normalizeFenForLookup(F1)) {
      return { totalGames: 600, moves: [move('e7e5', 'e5', 300), move('c7c5', 'c5', 250)] };
    }
    return { totalGames: 0, moves: [] };
  }
}

class OfflineClient implements MastersApiClient {
  public calls = 0;
  public async fetchMasterStats(): Promise<MasterStatsResult> {
    this.calls += 1;
    throw new Error('offline');
  }
}

describe('normalizeFenForLookup', () => {
  it('ตัด halfmove/fullmove ออก เหลือ 4 field', () => {
    expect(normalizeFenForLookup(START)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
  });

  it('ช่อง ep ที่กินไม่ได้จริงถูกแปลงเป็น "-" (ไม่ว่าไลบรารีจะใส่มาหรือไม่)', () => {
    expect(normalizeFenForLookup(F1)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -');
  });

  it('เก็บช่อง ep ไว้เมื่อกินได้จริง (1.e4 a6 2.e5 d5 -> d6)', () => {
    const fen = 'rnbqkbnr/1pp1pppp/p7/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
    expect(normalizeFenForLookup(fen)).toBe('rnbqkbnr/1pp1pppp/p7/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6');
  });

  it('โยน OpeningBookError เมื่อ FEN มี field ไม่ครบ', () => {
    expect(() => normalizeFenForLookup('8/8/8 w -')).toThrow(OpeningBookError);
  });
});

describe('OpeningBook.lookupOpening / analyzeOpeningLine', () => {
  const book = OpeningBook.fromJson(ECO);

  it('lookup ไม่สนตัวนับ halfmove/fullmove', () => {
    expect(book.lookupOpening(F5)).toEqual({ eco: 'C50', name: 'Italian Game' });
    expect(book.lookupOpening(F6)).toBeNull();
  });

  it('โหมดเข้มงวด: F4 หาไม่เจอ = หลุดตำราที่ ply 4', () => {
    const analysis = book.analyzeOpeningLine(GAME.map((entry) => entry.fenAfter));
    expect(analysis.firstDeviationPly).toBe(4);
    expect(analysis.bookDepthPlies).toBe(3);
    expect(analysis.ecoCode).toBe('C40');
    expect(analysis.plies.map((status) => status.inBook)).toEqual([true, true, true, false, false, false]);
  });

  it('gapTolerancePlies=1: ข้ามช่องว่าง ply 4 ได้ และหลุดจริงที่ ply 6', () => {
    const analysis = book.analyzeOpeningLine(
      GAME.map((entry) => entry.fenAfter),
      { gapTolerancePlies: 1 },
    );
    expect(analysis.firstDeviationPly).toBe(6);
    expect(analysis.bookDepthPlies).toBe(5);
    expect(analysis.ecoCode).toBe('C50');
    expect(analysis.name).toBe('Italian Game');
    // ตาที่หลุดแล้วคง ECO สุดท้ายไว้
    expect(analysis.plies[5]?.ecoCode).toBe('C50');
    expect(analysis.plies[5]?.inBook).toBe(false);
  });

  it('เกมที่จบในตำรา: firstDeviationPly เป็น null', () => {
    const analysis = book.analyzeOpeningLine([F1, F2, F3]);
    expect(analysis.firstDeviationPly).toBeNull();
    expect(analysis.bookDepthPlies).toBe(3);
  });

  it('fromJson โยน error เมื่อรูปแบบข้อมูลผิด', () => {
    expect(() => OpeningBook.fromJson([{ fen: F1, eco: 'B00' }])).toThrow(OpeningBookError);
    expect(() => OpeningBook.fromJson({})).toThrow(OpeningBookError);
  });
});

describe('buildLiveMoveContext (offline, ระหว่างเล่นสด)', () => {
  const book = OpeningBook.fromJson(ECO);

  it('ต่อเนื่องจนหลุดตำรา แล้วคง ECO เดิมและ inBook=false', () => {
    const c1 = buildLiveMoveContext(book, { fenAfter: F1, previous: null, opponentPrevMoveUci: null });
    expect(c1.inBook).toBe(true);
    expect(c1.ecoCode).toBe('B00');
    expect(c1.masterFrequency).toBeNull();

    const c2 = buildLiveMoveContext(book, { fenAfter: F4, previous: c1, opponentPrevMoveUci: 'e2e4' });
    expect(c2.inBook).toBe(false);
    expect(c2.ecoCode).toBe('B00');
    expect(c2.opponentPrevMoveUci).toBe('e2e4');

    // แม้ตำแหน่งถัดไป transpose กลับเข้า book ก็ยังเป็น false
    const c3 = buildLiveMoveContext(book, { fenAfter: F5, previous: c2, opponentPrevMoveUci: 'b8c6' });
    expect(c3.inBook).toBe(false);
  });
});

describe('classifyDeviationQuality', () => {
  it('จัดระดับตามความถี่ของมืออาชีพก่อน แล้วค่อยดู engine', () => {
    expect(classifyDeviationQuality({ masterFrequency: 0.2, evalLossCp: 400 })).toBe('master_alternative');
    expect(classifyDeviationQuality({ masterFrequency: 0, evalLossCp: 30 })).toBe('sound');
    expect(classifyDeviationQuality({ masterFrequency: null, evalLossCp: 90 })).toBe('inaccuracy');
    expect(classifyDeviationQuality({ masterFrequency: null, evalLossCp: 120 })).toBe('mistake');
    expect(classifyDeviationQuality({ masterFrequency: null, evalLossCp: 900 })).toBe('blunder');
    expect(classifyDeviationQuality({ masterFrequency: null, evalLossCp: null })).toBeNull();
  });
});

describe('computeMasterFrequency / parseMasterStatsResult', () => {
  const stats: MasterStatsResult = {
    totalGames: 1000,
    moves: [move('e1h1', 'O-O', 300), move('g1f3', 'Nf3', 200)],
  };

  it('คำนวณสัดส่วน, ไม่เจอ = 0, ไม่มีเกม = null', () => {
    expect(computeMasterFrequency(stats, { uci: 'g1f3' })).toBe(0.2);
    expect(computeMasterFrequency(stats, { uci: 'a2a3' })).toBe(0);
    expect(computeMasterFrequency({ totalGames: 0, moves: [] }, { uci: 'e2e4' })).toBeNull();
  });

  it('เข้าป้อม: UCI ของ Lichess (e1h1) ต่างจาก chess.js (e1g1) — จับคู่ด้วย SAN', () => {
    expect(computeMasterFrequency(stats, { uci: 'e1g1', san: 'O-O' })).toBe(0.3);
    expect(computeMasterFrequency(stats, { uci: 'g1f3', san: 'Nf3+' })).toBe(0.2);
  });

  it('parseMasterStatsResult ปฏิเสธข้อมูลที่รูปแบบพัง', () => {
    expect(parseMasterStatsResult(stats)).toEqual(stats);
    expect(parseMasterStatsResult({ totalGames: 5, moves: [{ uci: 'x' }] })).toBeNull();
    expect(parseMasterStatsResult('garbage')).toBeNull();
  });
});

describe('MasterStatsProvider (cache-first)', () => {
  it('ยิง API ครั้งเดียวต่อ fenKey — ครั้งที่สองมาจาก IndexedDB cache', async () => {
    const cache = new MemoryCache();
    const client = new FakeClient();
    const now = new Date('2026-09-22T00:00:00.000Z');
    const provider = new MasterStatsProvider(cache, client, { now: () => now });

    const first = await provider.getStats(START);
    const second = await provider.getStats(START.replace(' 0 1', ' 12 34')); // ตัวนับต่างกัน = fenKey เดียวกัน
    expect(first.source).toBe('network');
    expect(second.source).toBe('cache');
    expect(client.calls.length).toBe(1);

    const record = cache.records.get(normalizeFenForLookup(START));
    expect(record?.fetchedAt).toBe('2026-09-22T00:00:00.000Z');
    expect(record?.ecoCode).toBe('A00');
  });

  it('รวมคำขอที่ซ้ำกันพร้อมกันเป็น request เดียว', async () => {
    const client = new FakeClient();
    const provider = new MasterStatsProvider(new MemoryCache(), client);
    await Promise.all([provider.getStats(START), provider.getStats(START)]);
    expect(client.calls.length).toBe(1);
  });

  it('แคชที่ raw พัง = ถือว่า miss แล้วยิงใหม่ทับ', async () => {
    const cache = new MemoryCache();
    const key = normalizeFenForLookup(START);
    cache.records.set(key, { fenKey: key, fetchedAt: '2026-01-01T00:00:00.000Z', ecoCode: null, openingName: null, masterFrequency: null, raw: { bad: true } });
    const client = new FakeClient();
    const result = await new MasterStatsProvider(cache, client).getStats(START);
    expect(result.source).toBe('network');
    expect(client.calls.length).toBe(1);
  });

  it('maxCacheAgeMs: แคชหมดอายุ -> ยิงใหม่', async () => {
    const cache = new MemoryCache();
    const client = new FakeClient();
    let nowMs = Date.parse('2026-09-22T00:00:00.000Z');
    const provider = new MasterStatsProvider(cache, client, { now: () => new Date(nowMs), maxCacheAgeMs: 1000 });
    await provider.getStats(START);
    nowMs += 5000;
    const again = await provider.getStats(START);
    expect(again.source).toBe('network');
    expect(client.calls.length).toBe(2);
  });

  it('offline: ไม่ throw คืน stats=null และรายงานผ่าน onError', async () => {
    const stages: string[] = [];
    const provider = new MasterStatsProvider(new MemoryCache(), new OfflineClient(), {
      onError: (stage) => stages.push(stage),
    });
    const result = await provider.getStats(START);
    expect(result.stats).toBeNull();
    expect(result.source).toBe('unavailable');
    expect(stages).toEqual(['network']);
  });
});

describe('enrichGameOpening', () => {
  const book = OpeningBook.fromJson(ECO);

  it('เติม context + summary และหยุดขอสถิติเมื่อพ้นทฤษฎีมืออาชีพ', async () => {
    const client = new FakeClient();
    const provider = new MasterStatsProvider(new MemoryCache(), client);
    const evalLoss = new Map<number, number>([[4, 120]]);
    const result = await enrichGameOpening(book, provider, GAME, { evalLossCpByPly: evalLoss });

    expect(result.masterDataAvailable).toBe(true);
    expect(result.moveContexts.map((c) => c.masterFrequency)).toEqual([0.5, 0.5, null, null, null, null]);
    expect(result.moveContexts[0]?.opponentPrevMoveUci).toBeNull();
    expect(result.moveContexts[3]?.opponentPrevMoveUci).toBe('g1f3');
    // ขอสถิติ 3 ตำแหน่ง (START, F1, F2) แล้วหยุดเพราะ F2 มี 0 เกม
    expect(client.calls.length).toBe(3);
    expect(result.summary).toEqual({
      ecoCode: 'C40',
      name: "King's Knight Opening",
      bookDepthPlies: 3,
      firstDeviationPly: 4,
      deviationQuality: 'mistake',
    });
  });

  it('รันซ้ำ: ใช้แคชทั้งหมด ไม่ยิง API เพิ่ม', async () => {
    const cache = new MemoryCache();
    const client = new FakeClient();
    const provider = new MasterStatsProvider(cache, client);
    await enrichGameOpening(book, provider, GAME);
    const callsAfterFirst = client.calls.length;
    await enrichGameOpening(book, provider, GAME);
    expect(client.calls.length).toBe(callsAfterFirst);
  });

  it('offline: ได้ข้อมูล ECO ครบ masterFrequency=null และยิงแค่ครั้งเดียวแล้วหยุด', async () => {
    const client = new OfflineClient();
    const provider = new MasterStatsProvider(new MemoryCache(), client);
    const result = await enrichGameOpening(book, provider, GAME, { gapTolerancePlies: 1 });
    expect(client.calls).toBe(1);
    expect(result.masterDataAvailable).toBe(false);
    expect(result.moveContexts.every((c) => c.masterFrequency === null)).toBe(true);
    expect(result.summary.ecoCode).toBe('C50');
    expect(result.summary.firstDeviationPly).toBe(6);
    expect(result.summary.deviationQuality).toBeNull();
  });

  it('provider เป็น null: ทำงานด้วย ECO ในเครื่องล้วน ๆ', async () => {
    const result = await enrichGameOpening(book, null, GAME);
    expect(result.summary.bookDepthPlies).toBe(3);
  });

  it('ply ไม่ต่อเนื่อง -> OpeningBookError', async () => {
    const broken: GamePlyInput[] = [{ ply: 2, fenBefore: START, fenAfter: F1, uci: 'e2e4' }];
    let caught: unknown = null;
    try {
      await enrichGameOpening(book, null, broken);
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof OpeningBookError).toBe(true);
  });
});
