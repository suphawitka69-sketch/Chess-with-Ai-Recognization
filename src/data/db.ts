/**
 * db.ts
 * ---------------------------------------------------------------------------
 * นิยาม Dexie database เดียวของทั้งแอป — ตาราง/ดัชนีตรงกับ Phase 0 §3.3
 *
 * ⚠️ จุดที่แก้จากสเปกที่ให้มา: ดัชนี compound ของ `games` เดิมเขียนไว้ว่า
 * `[opponent.level+startedAt]` แต่โครงสร้างจริงของ `GameSummaryRecord`
 * (Schema 2A, §3.2) เก็บระดับคู่ต่อสู้ไว้ที่ `setup.opponent.level` ไม่ใช่
 * `opponent.level` ที่ top level — ถ้าประกาศ index ตามสเปกเป๊ะๆ Dexie จะสร้าง
 * ดัชนีที่ไม่ชี้ไปที่ field ไหนเลยในเอกสารจริง (ทุก entry จะได้ index value
 * เป็น undefined เงียบๆ โดยไม่ error) ทำให้ query ที่ filter ตามระดับคู่ต่อสู้
 * ไม่คืนผลอะไรเลยแม้ข้อมูลจะมีอยู่จริง จึงแก้ path ให้ตรงกับโครงสร้างจริงเป็น
 * `[setup.opponent.level+startedAt]` แทน
 * ---------------------------------------------------------------------------
 */

import Dexie, { type Table } from 'dexie';
import type {
  BookCacheRecord,
  GameSummaryRecord,
  LessonRecord,
  MoveLogRecord,
  PlayerProfileRecord,
} from '../shared/types/schema';

export class ChessCoachDatabase extends Dexie {
  public readonly games!: Table<GameSummaryRecord, string>;
  public readonly moveLogs!: Table<MoveLogRecord, string>;
  public readonly lessons!: Table<LessonRecord, string>;
  public readonly profile!: Table<PlayerProfileRecord, string>;
  public readonly bookCache!: Table<BookCacheRecord, string>;

  constructor(databaseName: string = 'chess-coach') {
    super(databaseName);

    this.version(1).stores({
      // PK = gameId; index บน startedAt (สำหรับ getRecentGames เรียงตามวันที่),
      // ดัชนีผสมสำหรับกรองเกมตามระดับคู่ต่อสู้แล้วเรียงตามเวลา, และ result.outcome
      // สำหรับสรุปสถิติแพ้/ชนะ/เสมอแบบเร็วโดยไม่ต้องโหลดทุกเกมมากรองเอง
      games: 'gameId, startedAt, [setup.opponent.level+startedAt], result.outcome',

      // PK = moveId ({gameId}_{color}_{ply} ตาม §3.1); ดัชนีผสม [gameId+ply] คือ
      // ทางหลักที่ SandboxStore ใช้ time-travel ไปตาที่ต้องการแบบเจาะจง;
      // position.fenBefore ไว้ให้ค้นหาตาที่เคยเจอตำแหน่งเดียวกันข้ามเกม (habit mining)
      moveLogs: 'moveId, gameId, [gameId+ply], position.fenBefore',

      // PK = lessonId; ค้นหาบทเรียนทั้งหมดของเกมหนึ่ง หรือของตาที่ระบุ
      lessons: 'lessonId, gameId, ply',

      // PK = profileId — ตารางนี้มีแค่ 1 แถวเสมอ (profileId: 'local_player')
      profile: 'profileId',

      // PK = fenKey (FEN ที่ตัด halfmove/fullmove ออกแล้ว ตาม §1.3 ข้อ 2);
      // fetchedAt ไว้ทำ cache eviction ตามอายุในอนาคตถ้าจำเป็น
      bookCache: 'fenKey, fetchedAt',
    });
  }
}

/** Singleton instance เดียวของทั้งแอป — ทุก repository import ตัวนี้ตัวเดียวกัน ห้ามสร้าง ChessCoachDatabase() เพิ่มเอง */
export const db = new ChessCoachDatabase();
