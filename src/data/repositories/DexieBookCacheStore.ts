/**
 * DexieBookCacheStore.ts
 * ---------------------------------------------------------------------------
 * Adapter: ทำให้ `db.bookCache` (Dexie/IndexedDB) ตรงกับ port `BookCacheStore`
 * ที่ core ต้องการ — core จึงไม่ต้อง import Dexie
 * ---------------------------------------------------------------------------
 */

import type { BookCacheStore } from '../../core/pedagogy/MasterStats';
import type { BookCacheRecord } from '../../shared/types/schema';
import { db, type ChessCoachDatabase } from '../db';

export class DexieBookCacheStore implements BookCacheStore {
  private readonly database: ChessCoachDatabase;

  constructor(database: ChessCoachDatabase = db) {
    this.database = database;
  }

  public get(fenKey: string): Promise<BookCacheRecord | undefined> {
    return this.database.bookCache.get(fenKey);
  }

  public async put(record: BookCacheRecord): Promise<void> {
    await this.database.bookCache.put(record);
  }
}
