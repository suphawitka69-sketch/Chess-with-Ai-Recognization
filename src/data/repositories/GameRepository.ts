/**
 * GameRepository.ts
 * ---------------------------------------------------------------------------
 * ชั้นเข้าถึงตาราง `games` (Schema 2A, Phase 0 §3.2) และรับผิดชอบ
 * export/import ข้อมูลทั้งฐานข้อมูลเป็น JSON ตามที่ roadmap Phase 2 ระบุไว้ว่า
 * "export/import JSON (กัน user เคลียร์ browser)" — ตั้งใจให้ export ครอบคลุม
 * ทุกตาราง (games, moveLogs, lessons, profile, bookCache) ไม่ใช่แค่ games
 * เพราะเป้าหมายคือ "กัน user เคลียร์ browser" แบบทั้งฐานข้อมูล ไม่ใช่แค่
 * ประวัติเกม — ถ้าต้องการ export เฉพาะ games เท่านั้นในอนาคต ควรแยกเป็นเมธอด
 * ใหม่ต่างหาก ไม่ใช้ชื่อ exportAllDataAsJson ซ้ำ
 * ---------------------------------------------------------------------------
 */

import Dexie from 'dexie';
import { db } from '../db';
import { moveLogRepository } from './MoveLogRepository';
import type { BookCacheRecord, GameSummaryRecord, LessonRecord, MoveLogRecord, PlayerProfileRecord } from '../../shared/types/schema';

export class GameRepositoryError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'GameRepositoryError';
  }
}

/** โครง envelope ของไฟล์ export — มี version กำกับไว้ตั้งแต่ต้น เผื่อโครงสร้างตารางเปลี่ยนในอนาคตแล้วต้อง migrate ตอน import ไฟล์เก่า */
export interface DatabaseExportEnvelope {
  readonly exportFormatVersion: 1;
  readonly exportedAt: string; // ISO 8601
  readonly tables: {
    readonly games: readonly GameSummaryRecord[];
    readonly moveLogs: readonly MoveLogRecord[];
    readonly lessons: readonly LessonRecord[];
    readonly profile: readonly PlayerProfileRecord[];
    readonly bookCache: readonly BookCacheRecord[];
  };
}

const EXPORT_FORMAT_VERSION = 1 as const;

export class GameRepository {
  public async saveGame(game: GameSummaryRecord): Promise<void> {
    try {
      await db.games.put(game);
    } catch (err) {
      throw new GameRepositoryError(`Failed to save game "${game.gameId}"`, err);
    }
  }

  public async getGameById(gameId: string): Promise<GameSummaryRecord | undefined> {
    try {
      return await db.games.get(gameId);
    } catch (err) {
      throw new GameRepositoryError(`Failed to load game "${gameId}"`, err);
    }
  }

  /** เกมล่าสุด `limit` เกม เรียงจากใหม่ไปเก่า — ใช้กับหน้า History list */
  public async getRecentGames(limit: number): Promise<GameSummaryRecord[]> {
    if (limit <= 0) return [];
    try {
      return await db.games.orderBy('startedAt').reverse().limit(limit).toArray();
    } catch (err) {
      throw new GameRepositoryError(`Failed to load recent games (limit=${limit})`, err);
    }
  }

  /** เกมทั้งหมดของคู่ต่อสู้ระดับที่ระบุ เรียงตามเวลา — ใช้ผ่าน compound index [setup.opponent.level+startedAt] (ดูหมายเหตุความคลาดเคลื่อนของ path ใน data/db.ts) */
  public async getGamesByOpponentLevel(level: number): Promise<GameSummaryRecord[]> {
    try {
      return await db.games
        .where('[setup.opponent.level+startedAt]')
        .between([level, Dexie.minKey], [level, Dexie.maxKey])
        .toArray();
    } catch (err) {
      throw new GameRepositoryError(`Failed to load games for opponent level ${level}`, err);
    }
  }

  /** ลบเกมพร้อม move logs ที่เกี่ยวข้องทั้งหมดในธุรกรรมเดียว — กันไม่ให้เหลือ moveLogs กำพร้าค้างฐานข้อมูล */
  public async deleteGame(gameId: string): Promise<void> {
    try {
      await db.transaction('rw', db.games, db.moveLogs, async () => {
        await db.games.delete(gameId);
        await moveLogRepository.deleteByGameId(gameId);
      });
    } catch (err) {
      throw new GameRepositoryError(`Failed to delete game "${gameId}"`, err);
    }
  }

  /** export ทุกตารางในฐานข้อมูลเป็น JSON string ก้อนเดียว — ใช้เป็นปุ่ม "สำรองข้อมูล" ให้ผู้ใช้ดาวน์โหลดเก็บเอง */
  public async exportAllDataAsJson(): Promise<string> {
    try {
      const [games, moveLogs, lessons, profile, bookCache] = await Promise.all([
        db.games.toArray(),
        db.moveLogs.toArray(),
        db.lessons.toArray(),
        db.profile.toArray(),
        db.bookCache.toArray(),
      ]);

      const envelope: DatabaseExportEnvelope = {
        exportFormatVersion: EXPORT_FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        tables: { games, moveLogs, lessons, profile, bookCache },
      };

      return JSON.stringify(envelope);
    } catch (err) {
      throw new GameRepositoryError('Failed to export database as JSON', err);
    }
  }

  /**
   * โหลดข้อมูลจากไฟล์ JSON ที่ export ไว้ก่อนหน้ากลับเข้าฐานข้อมูล — เป็นการ
   * "restore" ทับของเดิมทั้งหมด ไม่ใช่ merge (ล้างทุกตารางก่อนแล้วค่อยยัดของ
   * ใหม่เข้าไปในธุรกรรมเดียว เพื่อไม่ให้ข้อมูลเก่ากับใหม่ปนกันครึ่งๆ กลางๆ)
   */
  public async importDataFromJson(json: string): Promise<void> {
    let envelope: DatabaseExportEnvelope;
    try {
      envelope = JSON.parse(json) as DatabaseExportEnvelope;
    } catch (err) {
      throw new GameRepositoryError('Import failed: input is not valid JSON', err);
    }

    if (!envelope || typeof envelope !== 'object' || !envelope.tables) {
      throw new GameRepositoryError('Import failed: envelope is missing "tables"');
    }
    if (envelope.exportFormatVersion !== EXPORT_FORMAT_VERSION) {
      throw new GameRepositoryError(
        `Import failed: unsupported export format version ${String(envelope.exportFormatVersion)} (expected ${EXPORT_FORMAT_VERSION})`,
      );
    }

    const { games, moveLogs, lessons, profile, bookCache } = envelope.tables;

    try {
      await db.transaction('rw', db.games, db.moveLogs, db.lessons, db.profile, db.bookCache, async () => {
        await Promise.all([
          db.games.clear(),
          db.moveLogs.clear(),
          db.lessons.clear(),
          db.profile.clear(),
          db.bookCache.clear(),
        ]);
        await Promise.all([
          db.games.bulkPut(games as GameSummaryRecord[]),
          db.moveLogs.bulkPut(moveLogs as MoveLogRecord[]),
          db.lessons.bulkPut(lessons as LessonRecord[]),
          db.profile.bulkPut(profile as PlayerProfileRecord[]),
          db.bookCache.bulkPut(bookCache as BookCacheRecord[]),
        ]);
      });
    } catch (err) {
      throw new GameRepositoryError('Failed to import data into database', err);
    }
  }
}

/** Singleton — ใช้ instance เดียวกันทั้งแอป เช่นเดียวกับ db เอง */
export const gameRepository = new GameRepository();
