/**
 * useEngine.ts
 * ---------------------------------------------------------------------------
 * Hook เดียวที่ UI component ควรใช้ในการคุยกับชั้น engine ทั้งหมด — ห่อ
 * useEngineStore (สถานะ/config ของ EnginePool) เข้ากับ useGameStore (fen/
 * history ของเกมปัจจุบัน) เพื่อให้เรียก requestLiveEval() ได้โดยไม่ต้อง
 * ส่ง fen/moves เองทุกครั้งจากฝั่ง component
 *
 * รับผิดชอบ lifecycle การ initialize EnginePool ครั้งแรก (ครั้งเดียวต่อแอป
 * ทั้งชีวิต ไม่ผูกกับการ mount/unmount ของ component ใดๆ) — ตั้งใจไม่ dispose
 * engine ตอน unmount เพราะ EnginePool เป็น singleton ระดับแอป ถ้าไปยุ่งตอน
 * unmount จะทำให้หน้าจออื่นที่ยังใช้ engine อยู่พังไปด้วย
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef } from 'react';
import type { EngineBuildUrls, EngineStrengthPreset, EngineThreadMode } from '../core/engine/EnginePool';
import {
  useEngineActions,
  useEngineConnectionStatus,
  useEngineLiveEval,
  useEngineStrengthLadder,
  useEngineStore,
  type CustomStrengthOverride,
  type EngineConnectionStatus,
  type LiveEvaluation,
} from '../state/useEngineStore';
import { useGameStore } from '../state/useGameStore';

// ============================================================================
// Types
// ============================================================================

export interface UseEngineOptions {
  /** ที่อยู่ไฟล์ build ของ Stockfish WASM ทั้งสองแบบ (multi-thread / single-thread) */
  readonly buildUrls: EngineBuildUrls;
  /** ถ้า true (ค่าเริ่มต้น) จะเรียก initializeEngine ให้อัตโนมัติเมื่อ hook ถูก mount ครั้งแรกและยังไม่เคย init */
  readonly autoInitialize?: boolean;
  /** ความลึกเริ่มต้นที่ใช้เมื่อเรียก requestLiveEval() โดยไม่ระบุ depth เอง */
  readonly defaultEvalDepth?: number;
}

export interface UseEngineResult {
  readonly connectionStatus: EngineConnectionStatus;
  readonly isReady: boolean;
  readonly isInitializing: boolean;
  readonly errorMessage: string | null;
  readonly threadMode: EngineThreadMode | null;
  readonly threadModeReason: string | null;
  readonly strengthLadder: readonly EngineStrengthPreset[];
  readonly strengthLevel: number | null;
  readonly liveEval: LiveEvaluation | null;
  readonly isAnalyzing: boolean;
  /** สั่ง initialize เอง (เผื่อ autoInitialize: false หรือครั้งก่อนล้มเหลวแล้วอยากลองใหม่) */
  readonly initialize: () => Promise<void>;
  readonly setStrengthLevel: (level: number) => Promise<void>;
  readonly setCustomStrength: (override: CustomStrengthOverride) => Promise<void>;
  /** วิเคราะห์ตำแหน่งปัจจุบันของเกม (จาก useGameStore) ที่ depth ที่ระบุ — ไม่ต้องส่ง fen/moves เอง */
  readonly requestLiveEval: (depth?: number) => Promise<void>;
  readonly stopLiveEval: () => void;
  readonly clearLiveEval: () => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useEngine(options: UseEngineOptions): UseEngineResult {
  const connectionStatus = useEngineConnectionStatus();
  const errorMessage = useEngineStore((s) => s.state.errorMessage);
  const threadMode = useEngineStore((s) => s.state.threadMode);
  const threadModeReason = useEngineStore((s) => s.state.threadModeReason);
  const strengthLadder = useEngineStrengthLadder();
  const strengthLevel = useEngineStore((s) => s.state.strengthLevel);
  const liveEval = useEngineLiveEval();
  const isAnalyzing = useEngineStore((s) => s.state.isAnalyzing);
  const actions = useEngineActions();

  // อ่าน fen/history ของเกมปัจจุบันจาก useGameStore เพื่อประกอบ requestLiveEval() ให้อัตโนมัติ
  const currentFen = useGameStore((s) => s.state.fen);
  const currentHistory = useGameStore((s) => s.state.history);

  const autoInitialize = options.autoInitialize ?? true;
  const defaultEvalDepth = options.defaultEvalDepth ?? 18;

  // กัน initializeEngine ถูกเรียกซ้ำหลายครั้งจาก re-render หรือ React StrictMode's double-invoke ของ effect
  const hasRequestedInitRef = useRef(false);

  const initialize = useCallback(async () => {
    await actions.initializeEngine(options.buildUrls);
  }, [actions, options.buildUrls]);

  useEffect(() => {
    if (!autoInitialize) return;
    if (hasRequestedInitRef.current) return;
    hasRequestedInitRef.current = true;
    void initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoInitialize]);

  const setStrengthLevel = useCallback(
    async (level: number) => {
      await actions.setStrengthLevel(level);
    },
    [actions],
  );

  const setCustomStrength = useCallback(
    async (override: CustomStrengthOverride) => {
      await actions.setCustomStrength(override);
    },
    [actions],
  );

  const requestLiveEval = useCallback(
    async (depth?: number) => {
      const uciMoves = currentHistory.map((m) => m.uci);
      await actions.requestLiveEval(currentFen, uciMoves, depth ?? defaultEvalDepth);
    },
    [actions, currentFen, currentHistory, defaultEvalDepth],
  );

  const stopLiveEval = useCallback(() => {
    actions.stopLiveEval();
  }, [actions]);

  const clearLiveEval = useCallback(() => {
    actions.clearLiveEval();
  }, [actions]);

  return {
    connectionStatus,
    isReady: connectionStatus === 'ready',
    isInitializing: connectionStatus === 'initializing',
    errorMessage,
    threadMode,
    threadModeReason,
    strengthLadder,
    strengthLevel,
    liveEval,
    isAnalyzing,
    initialize,
    setStrengthLevel,
    setCustomStrength,
    requestLiveEval,
    stopLiveEval,
    clearLiveEval,
  };
}
