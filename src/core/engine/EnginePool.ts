/**
 * EnginePool.ts
 * ---------------------------------------------------------------------------
 * จัดการ instance ของ Stockfish worker ทั้งหมดในระบบ — จุดสำคัญคือ **ต้องมี
 * 2 instance แยกกันเสมอ**: playEngine (จำกัดความแรงเพื่อเล่นกับผู้เล่น) กับ
 * analysisEngine (แรงเต็มเพื่อวิเคราะห์หลังเกม) เพราะ UCI option อย่าง
 * "UCI_LimitStrength" / "Skill Level" เป็น global state ต่อ 1 process —
 * ถ้าใช้ instance เดียวกันสองงาน การตั้งค่าจะเหยียบกันเอง
 *
 * นอกจากนี้ยังรับผิดชอบ feature detection ว่าบราวเซอร์รองรับ multi-thread
 * (SharedArrayBuffer + crossOriginIsolated) หรือไม่ แล้วเลือกไฟล์ .wasm
 * build ที่เหมาะสมให้อัตโนมัติ พร้อม fallback ถ้า MT โหลดไม่สำเร็จ
 * ---------------------------------------------------------------------------
 */

import { EngineWorker, EngineWorkerError, type GoParams } from './EngineWorker';
import type { UciBestMove, UciInfo, UciOptionSpec } from './UciProtocol';

// ============================================================================
// Types
// ============================================================================

export type EngineRole = 'play' | 'analysis';
export type EngineThreadMode = 'multi-thread' | 'single-thread';

/** ระดับความแรงของ playEngine ตาม Strength Ladder ในเอกสารสถาปัตยกรรม (Phase 0, ตาราง §4.4) */
export interface EngineStrengthPreset {
  readonly level: number;
  readonly labelTh: string;
  readonly skillLevel: number; // Stockfish "Skill Level" option: 0-20
  readonly uciElo?: number; // ใส่เมื่อต้องการ UCI_LimitStrength; undefined = ไม่จำกัด Elo
  readonly depth: number;
  readonly moveTimeMs: number;
  /** ยิ่งสูง ยิ่งสุ่มเลือกจาก multipv แทนตาที่ดีที่สุดเสมอ (0 = เดินตาดีที่สุดทุกครั้ง) เพื่อเลียนแบบความไม่สมบูรณ์แบบของมนุษย์ */
  readonly multiPvNoiseTopN: number;
  readonly useOpeningBook: boolean;
}

/** ค่าเริ่มต้นตาม roadmap — ผู้เรียกสามารถ override ได้ทั้งชุดผ่าน EnginePoolConfig */
export const DEFAULT_STRENGTH_LADDER: readonly EngineStrengthPreset[] = [
  { level: 1, labelTh: 'เริ่มต้น', skillLevel: 0, uciElo: 1320, depth: 1, moveTimeMs: 100, multiPvNoiseTopN: 8, useOpeningBook: false },
  { level: 2, labelTh: 'ฝึกหัด', skillLevel: 3, uciElo: 1500, depth: 3, moveTimeMs: 200, multiPvNoiseTopN: 5, useOpeningBook: false },
  { level: 3, labelTh: 'ปานกลาง', skillLevel: 6, uciElo: 1700, depth: 5, moveTimeMs: 400, multiPvNoiseTopN: 3, useOpeningBook: false },
  { level: 4, labelTh: 'ค่อนข้างยาก', skillLevel: 10, uciElo: 1900, depth: 8, moveTimeMs: 700, multiPvNoiseTopN: 1, useOpeningBook: false },
  { level: 5, labelTh: 'ยาก', skillLevel: 14, uciElo: 2100, depth: 12, moveTimeMs: 1000, multiPvNoiseTopN: 1, useOpeningBook: false },
  { level: 6, labelTh: 'มืออาชีพ', skillLevel: 17, uciElo: 2400, depth: 16, moveTimeMs: 1500, multiPvNoiseTopN: 1, useOpeningBook: true },
  { level: 7, labelTh: 'แกรนด์มาสเตอร์', skillLevel: 20, uciElo: 2850, depth: 20, moveTimeMs: 2000, multiPvNoiseTopN: 1, useOpeningBook: true },
  { level: 8, labelTh: 'ไร้ขีดจำกัด', skillLevel: 20, uciElo: undefined, depth: 24, moveTimeMs: 3000, multiPvNoiseTopN: 1, useOpeningBook: true },
] as const;

export interface EngineBuildUrls {
  readonly multiThread: string;
  readonly singleThread: string;
}

export interface EnginePoolConfig {
  readonly buildUrls: EngineBuildUrls;
  readonly strengthLadder?: readonly EngineStrengthPreset[];
  /** จำนวน MultiPV lines ที่ analysisEngine ต้องคำนวณเสมอ (จำเป็นสำหรับ TrapDetector ที่ต้องดูหลายสาย) */
  readonly analysisMultiPv?: number;
  readonly analysisHashMb?: number;
  readonly playHashMb?: number;
  /** เปิด logging รายละเอียดของการ fallback MT→ST เพื่อ debug */
  readonly verbose?: boolean;
}

export interface EngineCapabilities {
  readonly threadMode: EngineThreadMode;
  readonly reason: string;
  readonly hardwareConcurrency: number;
}

export interface AnalysisResult {
  readonly bestMove: UciBestMove;
  /** ทุกบรรทัด info ที่ engine รายงานตลอดการค้นหา เรียงตามเวลา (ใช้ดูวิวัฒนาการของ eval ระหว่างคิด) */
  readonly infoHistory: readonly UciInfo[];
  /** เฉพาะ info บรรทัดสุดท้ายของแต่ละ multipv line — ใช้เป็น "คำตอบสุดท้าย" ของแต่ละสาย */
  readonly finalLinesByMultiPv: ReadonlyMap<number, UciInfo>;
}

// ============================================================================
// Feature detection
// ============================================================================

/**
 * ตรวจว่าบราวเซอร์ปัจจุบันรองรับ Stockfish multi-thread build ได้จริงหรือไม่
 * เงื่อนไขคือต้องมีทั้ง SharedArrayBuffer และ crossOriginIsolated === true
 * (ซึ่ง crossOriginIsolated จะเป็น true ก็ต่อเมื่อเว็บตั้ง COOP/COEP header ถูกต้อง)
 */
export function detectEngineCapabilities(): EngineCapabilities {
  const hardwareConcurrency =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 1;

  const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
  const isCrossOriginIsolated = typeof self !== 'undefined' && self.crossOriginIsolated === true;

  if (!hasSharedArrayBuffer) {
    return { threadMode: 'single-thread', reason: 'SharedArrayBuffer is not available in this browser', hardwareConcurrency };
  }
  if (!isCrossOriginIsolated) {
    return {
      threadMode: 'single-thread',
      reason: 'Page is not cross-origin isolated (missing COOP/COEP headers) — falling back to single-thread build',
      hardwareConcurrency,
    };
  }
  if (hardwareConcurrency < 2) {
    return { threadMode: 'single-thread', reason: 'Device reports fewer than 2 logical cores', hardwareConcurrency };
  }

  return { threadMode: 'multi-thread', reason: 'SharedArrayBuffer + crossOriginIsolated both available', hardwareConcurrency };
}

// ============================================================================
// EnginePool
// ============================================================================

export class EnginePool {
  private playWorker: EngineWorker | null = null;
  private analysisWorker: EngineWorker | null = null;
  private capabilities: EngineCapabilities | null = null;
  private currentStrengthLevel: number | null = null;

  private readonly strengthLadder: readonly EngineStrengthPreset[];
  private readonly analysisMultiPv: number;
  private readonly analysisHashMb: number;
  private readonly playHashMb: number;
  private readonly verbose: boolean;

  constructor(private readonly config: EnginePoolConfig) {
    this.strengthLadder = config.strengthLadder ?? DEFAULT_STRENGTH_LADDER;
    this.analysisMultiPv = config.analysisMultiPv ?? 3;
    this.analysisHashMb = config.analysisHashMb ?? 256;
    this.playHashMb = config.playHashMb ?? 32;
    this.verbose = config.verbose ?? false;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * ตรวจ capability ของบราวเซอร์ แล้วสร้าง worker ทั้งสองตัวพร้อมกัน (parallel init)
   * ถ้า multi-thread build โหลดพัง (เช่น .wasm 404 หรือ instantiate error) จะ fallback
   * เป็น single-thread โดยอัตโนมัติแบบโปร่งใสต่อผู้เรียก
   */
  public async initialize(): Promise<EngineCapabilities> {
    this.capabilities = detectEngineCapabilities();
    this.log(`Detected capabilities: ${this.capabilities.threadMode} (${this.capabilities.reason})`);

    const buildUrl =
      this.capabilities.threadMode === 'multi-thread' ? this.config.buildUrls.multiThread : this.config.buildUrls.singleThread;

    try {
      this.playWorker = await this.createConfiguredWorker(buildUrl, 'play', this.playHashMb);
      this.analysisWorker = await this.createConfiguredWorker(buildUrl, 'analysis', this.analysisHashMb, {
        multiPv: this.analysisMultiPv,
      });
    } catch (err) {
      if (this.capabilities.threadMode === 'multi-thread') {
        this.log(`Multi-thread build failed to initialize (${String(err)}), falling back to single-thread`);
        this.disposeWorkers();
        this.capabilities = {
          threadMode: 'single-thread',
          reason: `Fallback after MT init failure: ${err instanceof Error ? err.message : String(err)}`,
          hardwareConcurrency: this.capabilities.hardwareConcurrency,
        };
        this.playWorker = await this.createConfiguredWorker(this.config.buildUrls.singleThread, 'play', this.playHashMb);
        this.analysisWorker = await this.createConfiguredWorker(
          this.config.buildUrls.singleThread,
          'analysis',
          this.analysisHashMb,
          { multiPv: this.analysisMultiPv },
        );
      } else {
        throw new EngineWorkerError('Failed to initialize single-thread engine pool', err);
      }
    }

    // ตั้งความแรงเริ่มต้นของ playEngine ให้ระดับกลางๆ (ระดับ 3) กันลืมตั้งแล้วเล่นแรงเกินไปโดยไม่ตั้งใจ
    await this.setPlayStrength(3);

    return this.capabilities;
  }

  public getCapabilities(): EngineCapabilities {
    if (!this.capabilities) throw new EngineWorkerError('EnginePool.initialize() has not been called yet');
    return this.capabilities;
  }

  public dispose(): void {
    this.disposeWorkers();
  }

  private disposeWorkers(): void {
    this.playWorker?.terminate();
    this.analysisWorker?.terminate();
    this.playWorker = null;
    this.analysisWorker = null;
  }

  // --------------------------------------------------------------------------
  // Worker access (สำหรับกรณีต้องการควบคุมละเอียดนอกเหนือ helper ด้านล่าง)
  // --------------------------------------------------------------------------

  public getPlayEngine(): EngineWorker {
    if (!this.playWorker) throw new EngineWorkerError('Play engine is not initialized — call initialize() first');
    return this.playWorker;
  }

  public getAnalysisEngine(): EngineWorker {
    if (!this.analysisWorker) throw new EngineWorkerError('Analysis engine is not initialized — call initialize() first');
    return this.analysisWorker;
  }

  // --------------------------------------------------------------------------
  // Play engine helpers
  // --------------------------------------------------------------------------

  public getStrengthLadder(): readonly EngineStrengthPreset[] {
    return this.strengthLadder;
  }

  public getCurrentStrengthLevel(): number | null {
    return this.currentStrengthLevel;
  }

  /** ปรับความแรงของ playEngine ตามระดับใน Strength Ladder (§4.4 ของเอกสารสถาปัตยกรรม) */
  public async setPlayStrength(level: number): Promise<void> {
    const preset = this.strengthLadder.find((p) => p.level === level);
    if (!preset) {
      throw new EngineWorkerError(
        `Unknown strength level: ${level}. Valid levels: ${this.strengthLadder.map((p) => p.level).join(', ')}`,
      );
    }

    const engine = this.getPlayEngine();

    await engine.setOption('Skill Level', preset.skillLevel);

    if (preset.uciElo !== undefined) {
      await engine.setOption('UCI_LimitStrength', true);
      await engine.setOption('UCI_Elo', preset.uciElo);
    } else {
      await engine.setOption('UCI_LimitStrength', false);
    }

    await engine.isReady();
    this.currentStrengthLevel = level;
    this.log(`Play engine strength set to level ${level} (${preset.labelTh})`);
  }

  /**
   * ขอตาเดินจาก playEngine ตามตำแหน่งปัจจุบัน
   * ใช้ multipv เพื่อเก็บตัวเลือก top-N ไว้ให้ชั้น "human-like noise" (นอกไฟล์นี้) สุ่มเลือกได้
   * ถ้า preset.multiPvNoiseTopN <= 1 จะคืนแค่ตาที่ดีที่สุดตรงๆ
   */
  public async requestPlayMove(
    fen: string,
    moves: readonly string[],
    clock?: { readonly wtimeMs: number; readonly btimeMs: number; readonly wincMs: number; readonly bincMs: number },
  ): Promise<{ readonly bestMove: UciBestMove; readonly candidateLines: readonly UciInfo[] }> {
    if (this.currentStrengthLevel === null) {
      throw new EngineWorkerError('Play strength has not been set — call setPlayStrength() first');
    }
    const preset = this.strengthLadder.find((p) => p.level === this.currentStrengthLevel);
    if (!preset) throw new EngineWorkerError('Internal error: current strength level not found in ladder');

    const engine = this.getPlayEngine();

    if (preset.multiPvNoiseTopN > 1) {
      await engine.setOption('MultiPV', preset.multiPvNoiseTopN);
    } else {
      await engine.setOption('MultiPV', 1);
    }

    await engine.setPosition(fen, moves);

    const infoByMultiPv = new Map<number, UciInfo>();
    const goParams: GoParams = clock
      ? { wtimeMs: clock.wtimeMs, btimeMs: clock.btimeMs, wincMs: clock.wincMs, bincMs: clock.bincMs, depth: preset.depth, movetimeMs: preset.moveTimeMs }
      : { depth: preset.depth, movetimeMs: preset.moveTimeMs };

    const bestMove = await engine.go(goParams, (info) => {
      if (info.multipv !== undefined) infoByMultiPv.set(info.multipv, info);
    });

    const candidateLines = Array.from(infoByMultiPv.values()).sort((a, b) => (a.multipv ?? 0) - (b.multipv ?? 0));

    return { bestMove, candidateLines };
  }

  // --------------------------------------------------------------------------
  // Analysis engine helpers
  // --------------------------------------------------------------------------

  /**
   * วิเคราะห์ตำแหน่งเต็มกำลัง — ใช้กับ GameAnalyzer หลังจบเกม (batch) หรือ TrapDetector (live)
   * เก็บ infoHistory ทั้งหมดไว้ เพื่อให้ผู้เรียกดูวิวัฒนาการของ eval ระหว่าง search ได้
   * (เช่น กราฟ "engine กำลังลังเลระหว่างสองสาย" ที่บาง UI แสดงเป็น loading state)
   */
  public async analyzePosition(
    fen: string,
    moves: readonly string[],
    depth: number = 12,
    movetimeMsOrOnInfo: number | ((info: UciInfo) => void) = 400,
    onInfo?: (info: UciInfo) => void,
  ): Promise<AnalysisResult> {
    const engine = this.getAnalysisEngine();
    const movetimeMs = typeof movetimeMsOrOnInfo === 'number' ? movetimeMsOrOnInfo : 400;
    const infoCallback = typeof movetimeMsOrOnInfo === 'function' ? movetimeMsOrOnInfo : onInfo;

    await engine.setPosition(fen, moves);

    const infoHistory: UciInfo[] = [];
    const finalLinesByMultiPv = new Map<number, UciInfo>();

    const bestMove = await engine.go({ depth, movetimeMs }, (info) => {
      infoHistory.push(info);
      if (info.multipv !== undefined) finalLinesByMultiPv.set(info.multipv, info);
      infoCallback?.(info);
    });

    return { bestMove, infoHistory, finalLinesByMultiPv };
  }

  /**
   * วิเคราะห์ทั้งเกมแบบ batch — เรียก analyzePosition ทีละตำแหน่งเรียงตามลำดับ (ไม่ parallel
   * เพราะมี analysisEngine instance เดียว) พร้อม progress callback ให้ UI แสดง progress bar
   * รองรับ AbortSignal เพื่อให้ผู้เล่นกดยกเลิกกลางทางได้ตามที่ระบุใน roadmap Phase 3
   */
  public async analyzeGameBatch(
    positions: readonly { readonly fen: string; readonly movesFromStart: readonly string[]; readonly ply: number }[],
    depth: number,
    onProgress?: (done: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<number, AnalysisResult>> {
    const results = new Map<number, AnalysisResult>();

    for (let i = 0; i < positions.length; i += 1) {
      if (signal?.aborted) {
        this.log(`analyzeGameBatch aborted at ${i}/${positions.length}`);
        break;
      }
      const pos = positions[i];
      const result = await this.analyzePosition(pos.fen, pos.movesFromStart, depth);
      results.set(pos.ply, result);
      onProgress?.(i + 1, positions.length);
    }

    return results;
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private async createConfiguredWorker(
    buildUrl: string,
    role: EngineRole,
    hashMb: number,
    extra?: { readonly multiPv?: number },
  ): Promise<EngineWorker> {
    const worker = new EngineWorker(buildUrl, { label: role, timeoutMs: role === 'analysis' ? 90_000 : 15_000 });
    await worker.init();
    await worker.setOption('Hash', hashMb);
    await worker.setOption('Threads', this.capabilities?.threadMode === 'multi-thread' ? recommendedThreadCount(this.capabilities) : 1);
    if (extra?.multiPv !== undefined) {
      await worker.setOption('MultiPV', extra.multiPv);
    }
    await worker.newGame();
    this.log(`${role} engine ready (${buildUrl}, hash=${hashMb}MB)`);
    return worker;
  }

  private log(message: string): void {
    if (this.verbose) {
      // eslint-disable-next-line no-console
      console.log(`[EnginePool] ${message}`);
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** เว้น core ไว้ 1 ตัวให้ main thread เสมอ กัน UI กระตุกตอน engine คิดหนักๆ */
function recommendedThreadCount(capabilities: EngineCapabilities): number {
  return Math.max(1, capabilities.hardwareConcurrency - 1);
}

// ============================================================================
// Re-exports สำหรับความสะดวกของผู้ใช้ไฟล์นี้ (หลีกเลี่ยงต้อง import 2 ที่)
// ============================================================================

export type { UciOptionSpec, UciInfo, UciBestMove } from './UciProtocol';
export { EngineWorker, EngineWorkerError } from './EngineWorker';
