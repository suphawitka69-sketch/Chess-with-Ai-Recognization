/**
 * MoveLogRepository.ts
 * ---------------------------------------------------------------------------
 * ชั้นเข้าถึงตาราง `moveLogs` — ทุก field ตรงกับ MoveLogRecord (Schema 1,
 * Phase 0 §3.1) เป๊ะ ไม่มี transformation ใดๆ ที่นี่ เก็บ/อ่านตรงตัว
 * ---------------------------------------------------------------------------
 */

import { db } from '../db';
import type { MoveLogRecord } from '../../shared/types/schema';

export class MoveLogRepositoryError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'MoveLogRepositoryError';
  }
}

export class MoveLogRepository {
  /** บันทึก/อัปเดต 1 ตา — ใช้ `put` (ไม่ใช่ `add`) เพราะ Phase 3 GameAnalyzer ต้องเขียนทับ record เดิมเพื่อเติม engine.* ทีหลังได้ */
  public async saveMoveLog(log: MoveLogRecord): Promise<void> {
    try {
      await db.moveLogs.put(log);
    } catch (err) {
      throw new MoveLogRepositoryError(`Failed to save move log "${log.moveId}"`, err);
    }
  }

  /**
   * บันทึกหลายตาในธุรกรรมเดียว — ใช้ตอน backfill ผล engine.* ของทั้งเกมหลัง
   * batch analysis เสร็จ (Phase 3) เพื่อไม่ให้ข้อมูลครึ่งๆ กลางๆ ถ้า error
   * กลางทาง (transaction ของ Dexie จะ rollback ทั้งก้อนให้อัตโนมัติ)
   */
  public async saveBatch(logs: readonly MoveLogRecord[]): Promise<void> {
    if (logs.length === 0) return;
    try {
      await db.transaction('rw', db.moveLogs, async () => {
        await db.moveLogs.bulkPut(logs as MoveLogRecord[]);
      });
    } catch (err) {
      throw new MoveLogRepositoryError(`Failed to save batch of ${logs.length} move log(s)`, err);
    }
  }

  /** ดึงทุกตาของเกมหนึ่ง เรียงตาม ply จากน้อยไปมาก — ใช้ทำ replay/AnalysisScreen */
  public async getByGameId(gameId: string): Promise<MoveLogRecord[]> {
    try {
      return await db.moveLogs.where('gameId').equals(gameId).sortBy('ply');
    } catch (err) {
      throw new MoveLogRepositoryError(`Failed to load move logs for game "${gameId}"`, err);
    }
  }

  /** ดึงตาเดียวตรงๆ ผ่าน compound index [gameId+ply] — เร็วกว่า getByGameId แล้วมากรองเองตอนต้องการแค่ 1 ตา เช่น sandbox time-travel */
  public async getByGameIdAndPly(gameId: string, ply: number): Promise<MoveLogRecord | undefined> {
    try {
      return await db.moveLogs.where('[gameId+ply]').equals([gameId, ply]).first();
    } catch (err) {
      throw new MoveLogRepositoryError(`Failed to load move log for game "${gameId}" ply ${ply}`, err);
    }
  }

  /** ลบ move log ทั้งหมดของเกมหนึ่ง — เรียกคู่กับการลบเกมออกจาก GameRepository เสมอ ไม่งั้นจะมี moveLogs กำพร้าค้างในฐานข้อมูล */
  public async deleteByGameId(gameId: string): Promise<void> {
    try {
      await db.moveLogs.where('gameId').equals(gameId).delete();
    } catch (err) {
      throw new MoveLogRepositoryError(`Failed to delete move logs for game "${gameId}"`, err);
    }
  }
}

/** Singleton — ใช้ instance เดียวกันทั้งแอป เช่นเดียวกับ db เอง */
export const moveLogRepository = new MoveLogRepository();
