/**
 * OpeningEnrichment.ts
 * ---------------------------------------------------------------------------
 * Post-Game Analysis: รับตาเดินทั้งเกม แล้วสร้าง
 *   - `MoveLogContext` ต่อทุกตา  (บันทึกลง MoveLogRecord.context)
 *   - `OpeningSummary` ของเกม    (บันทึกลง GameSummaryRecord.openings)
 *
 * ขั้นตอน:
 *   1. วิเคราะห์ ECO ในเครื่อง (offline เสมอ)  -> ecoCode / openingName / inBook /
 *      bookDepthPlies / firstDeviationPly
 *   2. (ถ้ามี provider) ดึงสถิติมืออาชีพของ "ตำแหน่งก่อนเดิน" ทีละตา แบบ cache-first
 *      -> masterFrequency ต่อตา   หยุดทันทีเมื่อ offline หรือพ้นทฤษฎีมืออาชีพ
 *      (ไม่มีเกมผ่านตำแหน่งนั้น) เพื่อไม่ยิง request เกินจำเป็น
 *   3. ประเมิน deviationQuality ของตาที่เริ่มหลุดตำรา
 *
 * Pure TypeScript — ไม่มี I/O ของตัวเอง ทุกอย่างผ่าน OpeningBook + MasterStatsProvider
 * ---------------------------------------------------------------------------
 */

import type { MoveLogContext, OpeningSummary } from '../../shared/types/schema';
import { computeMasterFrequency, type MasterStatsProvider } from './MasterStats';
import { classifyDeviationQuality, OpeningBookError, type OpeningBook } from './OpeningBook';

export interface GamePlyInput {
  /** เริ่มที่ 1 (ตาแรกของขาว) และต้องต่อเนื่องไม่ข้าม */
  readonly ply: number;
  readonly fenBefore: string;
  readonly fenAfter: string;
  readonly uci: string;
  readonly san?: string | undefined;
}

export interface OpeningEnrichmentOptions {
  /** ดู OpeningLineOptions.gapTolerancePlies (ค่าเริ่มต้น 0) */
  readonly gapTolerancePlies?: number;
  /** จำนวน ply สูงสุดที่จะขอสถิติมืออาชีพ (ค่าเริ่มต้น 20 = 10 ตัวเต็ม) */
  readonly maxMasterLookupPlies?: number;
  /** ค่าเสีย centipawn ของตาเดินแต่ละ ply จาก engine (ถ้ามี) ไว้ตัดสิน deviationQuality */
  readonly evalLossCpByPly?: ReadonlyMap<number, number>;
}

export interface OpeningEnrichmentResult {
  /** เรียงตาม ply (index 0 = ply 1) */
  readonly moveContexts: readonly MoveLogContext[];
  readonly summary: OpeningSummary;
  /** true = ได้สถิติมืออาชีพอย่างน้อยหนึ่งตำแหน่ง (จากแคชหรือเครือข่าย) */
  readonly masterDataAvailable: boolean;
}

const DEFAULT_MAX_MASTER_LOOKUP_PLIES = 20;

export async function enrichGameOpening(
  book: OpeningBook,
  provider: MasterStatsProvider | null,
  plies: readonly GamePlyInput[],
  options: OpeningEnrichmentOptions = {},
): Promise<OpeningEnrichmentResult> {
  assertConsecutivePlies(plies);

  // ---- 1) ECO ในเครื่อง ------------------------------------------------------
  const analysis = book.analyzeOpeningLine(
    plies.map((entry) => entry.fenAfter),
    options.gapTolerancePlies === undefined ? {} : { gapTolerancePlies: options.gapTolerancePlies },
  );

  // ---- 2) สถิติมืออาชีพ (cache-first, ไม่ throw เมื่อ offline) -----------------
  const frequencyByPly = new Map<number, number | null>();
  let masterDataAvailable = false;

  if (provider !== null) {
    const limit = options.maxMasterLookupPlies ?? DEFAULT_MAX_MASTER_LOOKUP_PLIES;
    for (const entry of plies.slice(0, Math.max(0, limit))) {
      const lookup = await provider.getStats(entry.fenBefore);
      if (lookup.stats === null) {
        break; // offline / rate limit / ไม่มี token: หยุดยิง ใช้ ECO ในเครื่องต่อ
      }
      masterDataAvailable = true;
      if (lookup.stats.totalGames === 0) {
        break; // พ้นทฤษฎีมืออาชีพแล้ว ตำแหน่งถัด ๆ ไปก็ไม่มีข้อมูลเช่นกัน
      }
      frequencyByPly.set(entry.ply, computeMasterFrequency(lookup.stats, { uci: entry.uci, san: entry.san }));
    }
  }

  // ---- 3) คุณภาพของตาที่เริ่มหลุดตำรา ----------------------------------------
  const { firstDeviationPly } = analysis;
  const deviationQuality =
    firstDeviationPly === null
      ? null
      : classifyDeviationQuality({
          masterFrequency: frequencyByPly.get(firstDeviationPly) ?? null,
          evalLossCp: options.evalLossCpByPly?.get(firstDeviationPly) ?? null,
        });

  // ---- 4) ประกอบผลลัพธ์ -------------------------------------------------------
  const moveContexts: MoveLogContext[] = analysis.plies.map((status) => ({
    ecoCode: status.ecoCode,
    openingName: status.openingName,
    inBook: status.inBook,
    masterFrequency: frequencyByPly.get(status.ply) ?? null,
    opponentPrevMoveUci: plies[status.ply - 2]?.uci ?? null,
    opponentIntent: null, // ไม่อยู่ในขอบเขตของ Opening Book (เติมโดยโมดูล intent)
  }));

  const summary: OpeningSummary = {
    ecoCode: analysis.ecoCode,
    name: analysis.name,
    bookDepthPlies: analysis.bookDepthPlies,
    firstDeviationPly,
    deviationQuality,
  };

  return { moveContexts, summary, masterDataAvailable };
}

function assertConsecutivePlies(plies: readonly GamePlyInput[]): void {
  for (const [index, entry] of plies.entries()) {
    if (entry.ply !== index + 1) {
      throw new OpeningBookError(
        `ลำดับ ply ต้องเริ่มที่ 1 และต่อเนื่อง: index ${index} มี ply=${entry.ply} (คาดว่า ${index + 1})`,
      );
    }
  }
}
