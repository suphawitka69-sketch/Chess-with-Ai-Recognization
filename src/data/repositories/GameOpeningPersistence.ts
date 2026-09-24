/**
 * GameOpeningPersistence.ts
 * ---------------------------------------------------------------------------
 * เขียนผลของ `enrichGameOpening` ลง IndexedDB ใน transaction เดียว:
 *   - db.moveLogs[*].context   (MoveLogContext ต่อ ply)
 *   - db.games[gameId].openings (OpeningSummary)
 *
 * สมมติฐานเกี่ยวกับ schema ที่ไม่ได้อยู่ในเอกสารที่ได้รับ (โปรดตรวจ):
 *   MoveLogRecord มี `moveId` (PK), `gameId`, `ply` (number) และ `context: MoveLogContext`
 *   GameSummaryRecord มี `openings: OpeningSummary`
 * ---------------------------------------------------------------------------
 */

import { enrichGameOpening, type GamePlyInput, type OpeningEnrichmentOptions, type OpeningEnrichmentResult } from '../../core/pedagogy/OpeningEnrichment';
import type { MasterStatsProvider } from '../../core/pedagogy/MasterStats';
import type { OpeningBook } from '../../core/pedagogy/OpeningBook';
import { db, type ChessCoachDatabase } from '../db';

export async function persistGameOpening(
  gameId: string,
  result: OpeningEnrichmentResult,
  database: ChessCoachDatabase = db,
): Promise<void> {
  const contextByPly = new Map<number, OpeningEnrichmentResult['moveContexts'][number]>();
  for (const [index, context] of result.moveContexts.entries()) {
    contextByPly.set(index + 1, context);
  }

  await database.transaction('rw', database.moveLogs, database.games, async () => {
    const logs = await database.moveLogs.where('gameId').equals(gameId).toArray();
    for (const log of logs) {
      const context = contextByPly.get(log.ply);
      if (context !== undefined) {
        await database.moveLogs.update(log.moveId, { context });
      }
    }
    await database.games.update(gameId, { openings: result.summary });
  });
}

/**
 * จุดเรียกเดียวสำหรับ Post-Game Analysis / Lazy Fetch ตอนเปิดหน้าวิเคราะห์:
 * วิเคราะห์ (cache-first) แล้วบันทึกลง db.moveLogs + db.games
 */
export async function analyzeAndPersistGameOpening(params: {
  readonly gameId: string;
  readonly plies: readonly GamePlyInput[];
  readonly book: OpeningBook;
  readonly provider: MasterStatsProvider | null;
  readonly options?: OpeningEnrichmentOptions;
  readonly database?: ChessCoachDatabase;
}): Promise<OpeningEnrichmentResult> {
  const result = await enrichGameOpening(params.book, params.provider, params.plies, params.options);
  await persistGameOpening(params.gameId, result, params.database);
  return result;
}
