/**
 * useEngineStore.ts
 * ---------------------------------------------------------------------------
 * จัดการวงจรชีวิตและสถานะของ EnginePool ทั้งหมด — เป็นจุดเดียวในแอปที่รู้จัก
 * EnginePool instance โดยตรง สโตร์อื่น (useGameStore) เข้าถึง pool ผ่าน
 * `getEnginePool()` ที่ export จากไฟล์นี้เท่านั้น ไม่ import EnginePool เอง
 *
 * หลักการแยก re-render:
 * - EnginePool instance เป็น **module-scope singleton** ไม่ได้เก็บใน Zustand
 *   state โดยตรง เพราะเป็น mutable class ขนาดใหญ่ที่ไม่ควรกระตุ้น re-render
 *   ทุกครั้งที่ reference เปลี่ยน (มันไม่เปลี่ยน — มีแค่ตัวเดียวตลอดอายุแอป)
 * - state ถูกแบ่งเป็น `state` (ข้อมูลอ่านอย่างเดียวสำหรับ UI) กับ `actions`
 *   (ฟังก์ชันที่ reference คงที่ตลอดอายุ store) แยกกันชัดเจน ดังนั้น
 *   component ที่ select เฉพาะ `actions` จะไม่ re-render เลยแม้ state เปลี่ยน
 * - `liveEval` แยกออกจาก `state` หลักเป็นคนละ field เพื่อให้ component ที่
 *   สนใจแค่ eval bar (อัปเดตถี่มากระหว่างคิด) ไม่ทำให้ component ที่สนใจแค่
 *   connection status ต้อง re-render ไปด้วย
 * ---------------------------------------------------------------------------
 */

import { create } from 'zustand';
import {
  EnginePool,
  DEFAULT_STRENGTH_LADDER,
  detectEngineCapabilities,
  type EngineBuildUrls,
  type EngineCapabilities,
  type EnginePoolConfig,
  type EngineStrengthPreset,
  type EngineThreadMode,
  type UciBestMove,
  type UciInfo,
} from '../core/engine/EnginePool';
import type { UciScore } from '../core/engine/UciProtocol';

// ============================================================================
// Module-scope singleton — ไม่อยู่ใน Zustand state (ดูเหตุผลด้านบนของไฟล์)
// ============================================================================

let enginePoolInstance: EnginePool | null = null;

/** จุดเข้าเดียวสำหรับสโตร์อื่น (เช่น useGameStore) ในการเรียกใช้ EnginePool จริง */
export function getEnginePool(): EnginePool | null {
  return enginePoolInstance;
}

// ============================================================================
// Types
// ============================================================================

export type EngineConnectionStatus = 'idle' | 'initializing' | 'ready' | 'error';

/** eval สดของตำแหน่งปัจจุบัน — อัปเดตทุกครั้งที่ analysis engine รายงาน "info" บรรทัดใหม่ */
export interface LiveEvaluation {
  readonly fen: string;
  readonly depth: number;
  readonly score: UciScore | null;
  readonly bestMoveUci: string | null;
  readonly pv: readonly string[];
  readonly isMate: boolean;
}

/** การตั้งค่าความแรงแบบ custom ที่ข้าม Strength Ladder preset — ใช้เมื่อ UI มี slider Skill Level/Elo อิสระ */
export interface CustomStrengthOverride {
  readonly skillLevel: number; // 0-20
  readonly uciElo: number | null; // null = ไม่จำกัด Elo
}

export interface EngineState {
  readonly connectionStatus: EngineConnectionStatus;
  readonly errorMessage: string | null;
  readonly threadMode: EngineThreadMode | null;
  readonly threadModeReason: string | null;
  readonly hardwareConcurrency: number | null;
  readonly strengthLadder: readonly EngineStrengthPreset[];
  /** ระดับปัจจุบันตาม ladder — null เมื่อกำลังใช้ customStrength แทน */
  readonly strengthLevel: number | null;
  readonly customStrength: CustomStrengthOverride | null;
  readonly isAnalyzing: boolean;
  readonly liveEval: LiveEvaluation | null;
}

export interface EngineActions {
  /** เริ่มต้น EnginePool จริง — ต้องเรียกก่อนใช้งานฟังก์ชันอื่นทั้งหมด (ปกติเรียกครั้งเดียวตอนแอป mount) */
  readonly initializeEngine: (buildUrls: EngineBuildUrls, options?: Omit<EnginePoolConfig, 'buildUrls'>) => Promise<void>;
  /** ปรับความแรงของ playEngine ตาม preset ใน Strength Ladder (เช่น จากปุ่มเลือกระดับ 1-8) */
  readonly setStrengthLevel: (level: number) => Promise<void>;
  /** ปรับความแรงแบบละเอียดข้าม ladder โดยตรง — สำหรับ UI แบบ slider "Skill Level 0-20" หรือใส่ Elo เอง */
  readonly setCustomStrength: (override: CustomStrengthOverride) => Promise<void>;
  /** ขอ eval สดของตำแหน่งที่ระบุจาก analysisEngine — เช่นแสดง eval bar ระหว่างดู sandbox */
  readonly requestLiveEval: (fen: string, moves: readonly string[], depth: number) => Promise<void>;
  /** สั่งให้ analysisEngine หยุดคิดกลางคัน (ใช้ตอนผู้เล่นเปลี่ยนตำแหน่งเร็วกว่าที่ analysis จะตามทัน) */
  readonly stopLiveEval: () => void;
  readonly clearLiveEval: () => void;
  /** ทำลาย EnginePool ทั้งหมด (เช่นตอน component หลักถูก unmount หรือรีเซ็ตแอปทั้งระบบ) */
  readonly disposeEngine: () => void;
}

export interface EngineStore {
  readonly state: EngineState;
  readonly actions: EngineActions;
}

// ============================================================================
// Initial state
// ============================================================================

const initialEngineState: EngineState = {
  connectionStatus: 'idle',
  errorMessage: null,
  threadMode: null,
  threadModeReason: null,
  hardwareConcurrency: null,
  strengthLadder: DEFAULT_STRENGTH_LADDER,
  strengthLevel: null,
  customStrength: null,
  isAnalyzing: false,
  liveEval: null,
};

// ============================================================================
// Store
// ============================================================================

export const useEngineStore = create<EngineStore>()((set, get) => ({
  state: initialEngineState,

  actions: {
    initializeEngine: async (buildUrls, options) => {
      const current = get().state;
      if (current.connectionStatus === 'initializing' || current.connectionStatus === 'ready') {
        return; // กันเรียกซ้ำซ้อน (เช่น React StrictMode double-invoke effect)
      }

      set((s) => ({ state: { ...s.state, connectionStatus: 'initializing', errorMessage: null } }));

      try {
        const pool = new EnginePool({ buildUrls, ...options });
        const capabilities: EngineCapabilities = await pool.initialize();
        enginePoolInstance = pool;

        set((s) => ({
          state: {
            ...s.state,
            connectionStatus: 'ready',
            threadMode: capabilities.threadMode,
            threadModeReason: capabilities.reason,
            hardwareConcurrency: capabilities.hardwareConcurrency,
            strengthLevel: pool.getCurrentStrengthLevel(),
          },
        }));
      } catch (err) {
        enginePoolInstance = null;
        set((s) => ({
          state: {
            ...s.state,
            connectionStatus: 'error',
            errorMessage: err instanceof Error ? err.message : String(err),
          },
        }));
      }
    },

    setStrengthLevel: async (level) => {
      const pool = enginePoolInstance;
      if (!pool) {
        set((s) => ({ state: { ...s.state, errorMessage: 'Cannot set strength: engine pool is not initialized' } }));
        return;
      }

      try {
        await pool.setPlayStrength(level);
        set((s) => ({ state: { ...s.state, strengthLevel: level, customStrength: null, errorMessage: null } }));
      } catch (err) {
        set((s) => ({ state: { ...s.state, errorMessage: err instanceof Error ? err.message : String(err) } }));
      }
    },

    setCustomStrength: async (override) => {
      const pool = enginePoolInstance;
      if (!pool) {
        set((s) => ({ state: { ...s.state, errorMessage: 'Cannot set strength: engine pool is not initialized' } }));
        return;
      }

      const clampedSkill = Math.min(20, Math.max(0, Math.round(override.skillLevel)));

      try {
        const engine = pool.getPlayEngine();
        await engine.setOption('Skill Level', clampedSkill);
        if (override.uciElo !== null) {
          await engine.setOption('UCI_LimitStrength', true);
          await engine.setOption('UCI_Elo', Math.round(override.uciElo));
        } else {
          await engine.setOption('UCI_LimitStrength', false);
        }
        await engine.isReady();

        set((s) => ({
          state: {
            ...s.state,
            strengthLevel: null, // custom override แทนที่ ladder preset
            customStrength: { skillLevel: clampedSkill, uciElo: override.uciElo },
            errorMessage: null,
          },
        }));
      } catch (err) {
        set((s) => ({ state: { ...s.state, errorMessage: err instanceof Error ? err.message : String(err) } }));
      }
    },

    requestLiveEval: async (fen, moves, depth) => {
      const pool = enginePoolInstance;
      if (!pool) {
        set((s) => ({ state: { ...s.state, errorMessage: 'Cannot analyze: engine pool is not initialized' } }));
        return;
      }
      if (get().state.isAnalyzing) {
        return; // กันยิงซ้อนกันสอง request พร้อมกัน — analysis engine รับได้ทีละคำสั่ง
      }

      set((s) => ({
        state: {
          ...s.state,
          isAnalyzing: true,
          liveEval: { fen, depth: 0, score: null, bestMoveUci: null, pv: [], isMate: false },
        },
      }));

      const onInfo = (info: UciInfo): void => {
        // สนใจเฉพาะสายหลัก (multipv 1 หรือไม่ระบุ multipv เลย) สำหรับ eval bar หลัก
        if (info.multipv !== undefined && info.multipv !== 1) return;
        if (info.score === undefined && info.depth === undefined) return;

        set((s) => {
          if (s.state.liveEval === null || s.state.liveEval.fen !== fen) return s; // ตำแหน่งเปลี่ยนไปแล้วระหว่างคิด — ทิ้งผลเก่า
          return {
            state: {
              ...s.state,
              liveEval: {
                fen,
                depth: info.depth ?? s.state.liveEval.depth,
                score: info.score ?? s.state.liveEval.score,
                bestMoveUci: info.pv?.[0] ?? s.state.liveEval.bestMoveUci,
                pv: info.pv ?? s.state.liveEval.pv,
                isMate: info.score?.kind === 'mate',
              },
            },
          };
        });
      };

      try {
        const result = await pool.analyzePosition(fen, moves, depth, onInfo);
        const finalBest: UciBestMove = result.bestMove;

        set((s) => {
          if (s.state.liveEval === null || s.state.liveEval.fen !== fen) {
            return { state: { ...s.state, isAnalyzing: false } };
          }
          return {
            state: {
              ...s.state,
              isAnalyzing: false,
              liveEval: { ...s.state.liveEval, bestMoveUci: finalBest.bestMove },
            },
          };
        });
      } catch (err) {
        set((s) => ({
          state: { ...s.state, isAnalyzing: false, errorMessage: err instanceof Error ? err.message : String(err) },
        }));
      }
    },

    stopLiveEval: () => {
      const pool = enginePoolInstance;
      if (!pool) return;
      try {
        pool.getAnalysisEngine().stop();
      } catch {
        // getAnalysisEngine() อาจ throw ถ้ายังไม่ init — เพิกเฉยได้ เพราะไม่มีอะไรให้หยุดอยู่แล้ว
      }
    },

    clearLiveEval: () => {
      set((s) => ({ state: { ...s.state, liveEval: null } }));
    },

    disposeEngine: () => {
      enginePoolInstance?.dispose();
      enginePoolInstance = null;
      set(() => ({ state: initialEngineState }));
    },
  },
}));

// ============================================================================
// Selector helpers — ใช้ใน React component เพื่อ subscribe เฉพาะส่วนที่ต้องการจริงๆ
// ============================================================================

/** ใช้เมื่อ component สนใจแค่เรียก action ไม่สนใจ state — reference ของ actions คงที่ตลอดอายุ store จึงไม่ทำให้ re-render */
export function useEngineActions(): EngineActions {
  return useEngineStore((s) => s.actions);
}

export function useEngineConnectionStatus(): EngineConnectionStatus {
  return useEngineStore((s) => s.state.connectionStatus);
}

export function useEngineLiveEval(): LiveEvaluation | null {
  return useEngineStore((s) => s.state.liveEval);
}

export function useEngineStrengthLadder(): readonly EngineStrengthPreset[] {
  return useEngineStore((s) => s.state.strengthLadder);
}

/** เผื่อกรณีต้องการ capability ดิบไปแสดง เช่น badge "MT" / "ST" บน UI */
export function describeThreadMode(threadMode: EngineThreadMode | null): string {
  if (threadMode === 'multi-thread') return 'Multi-thread';
  if (threadMode === 'single-thread') return 'Single-thread';
  return 'Unknown';
}

/** re-export เผื่อ UI ต้องการเรียก detectEngineCapabilities() เองก่อน initializeEngine (เช่นแสดง warning ล่วงหน้าว่าจะได้ ST) */
export { detectEngineCapabilities };
