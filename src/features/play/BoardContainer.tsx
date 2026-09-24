/**
 * BoardContainer.tsx  (อัปเดต — Phase 2: Telemetry hookup)
 * ---------------------------------------------------------------------------
 * ⚠️ สมมติฐานเกี่ยวกับไฟล์ที่ยังไม่เห็นเนื้อหาจริง (โปรดปรับให้ตรงถ้าของจริงต่างจากนี้):
 *
 *   import { MoveTracker }    from '../../core/telemetry/MoveTracker';
 *   import { PanicCalculator } from '../../core/telemetry/PanicCalculator';
 *
 *   class MoveTracker {
 *     startTurn(atMs: number): void;                    // เรียกตอนเริ่มเป็นตาผู้เล่น — ใช้คำนวณ idleBeforeFirstTouchMs
 *     recordSelection(square: string, cancelled: boolean): void;
 *     recordHover(square: string, durationMs: number): void;
 *     recordDrag(distancePx: number): void;
 *     recordTabBlur(): void;
 *     getLiveCounts(): { selectionCancelCount: number; repeatClickSamePiece: number; hesitationIndex: number };
 *     commitAndReset(): MoveBehaviorSnapshot;            // shape ตรงกับ ../../state/useGameStore ที่ export ไว้
 *   }
 *
 *   class PanicCalculator {
 *     update(partial: {
 *       selectionCancelCount?: number;
 *       repeatClickSamePiece?: number;
 *       clockRemainingMs?: number;
 *       baseTimeMs?: number;
 *       thinkTimeMs?: number;
 *     }): number; // คืนคะแนน 0-100 ที่ผ่าน EMA smoothing แล้ว (สูตรตาม Phase 0 §4.3)
 *     reset(): void;
 *   }
 *
 * ถ้า MoveTracker/PanicCalculator ของจริงมีชื่อ method ต่างจากนี้ ให้แก้แค่จุด
 * ที่เรียกใช้งานด้านล่าง — โครงส่วนที่เหลือ (การดัก event, การส่ง telemetry
 * เข้า useGameStore) ไม่ต้องเปลี่ยน
 *
 * react-chessboard: ใช้ API ของ v4 (props: position, onPieceDrop,
 * onSquareClick, onMouseOverSquare, onMouseOutSquare, customSquareStyles) —
 * ถ้าเวอร์ชันที่ติดตั้งจริงต่างไป ให้ปรับชื่อ prop ให้ตรง
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import {
  useGameStore,
  useGameActions,
  useGameFen,
  useGameTurn,
  useGamePlayerColor,
  useGamePhase,
  useGameClock,
  useIsEngineThinking,
} from '../../state/useGameStore';
import { useTelemetryActions, computeIsUnderTimePressure } from '../../state/useTelemetryStore';
import { MoveTracker } from '../../core/telemetry/MoveTracker';
import { PanicCalculator } from '../../core/telemetry/PanicCalculator';
import type { PieceColor } from '../../core/chess/GameEngine';
import type { MoveLogRecord } from '../../shared/types/schema';

// ============================================================================
// Helpers
// ============================================================================

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** react-chessboard ให้สีหมากมาเป็น "wP","bK" ฯลฯ — เราสนใจแค่สี ('w'/'b') ว่าเป็นของผู้เล่นหรือไม่ */
function pieceColorFromCode(pieceCode: string): PieceColor {
  return pieceCode.startsWith('w') ? 'w' : 'b';
}

// ============================================================================
// Component
// ============================================================================

export function BoardContainer(): JSX.Element {
  const fen = useGameFen();
  const turn = useGameTurn();
  const playerColor = useGamePlayerColor();
  const phase = useGamePhase();
  const clock = useGameClock();
  const isEngineThinking = useIsEngineThinking();
  const gameActions = useGameActions();
  const telemetryActions = useTelemetryActions();

  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);

  const isPlayerTurn = phase === 'playing' && !isEngineThinking && turn === playerColor;

  // --------------------------------------------------------------------------
  // MoveTracker / PanicCalculator — instance เดียวตลอดเกม สร้างใหม่ทุกครั้งที่
  // เกมใหม่เริ่ม (phase เปลี่ยนจากอย่างอื่นมาเป็น 'playing') เพื่อไม่ให้ค่าตกค้าง
  // ข้ามเกม (เช่น hesitationIndex EMA เก่าเอาไปปนกับเกมใหม่)
  // --------------------------------------------------------------------------
  const moveTrackerRef = useRef<MoveTracker>(new MoveTracker());
  const panicCalculatorRef = useRef<PanicCalculator>(new PanicCalculator());
  const firstTouchRecordedRef = useRef(false);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const hoverStartRef = useRef<{ square: string; atMs: number } | null>(null);

  useEffect(() => {
    if (phase === 'playing') {
      moveTrackerRef.current = new MoveTracker();
      panicCalculatorRef.current = new PanicCalculator();
      telemetryActions.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ตั้งใจ trigger เฉพาะตอน phase เปลี่ยนเป็น 'playing' เท่านั้น
  }, [phase === 'playing']);

  /** เริ่มนับ "ตาใหม่" ของผู้เล่นทุกครั้งที่ turn สลับมาเป็นผู้เล่น — ใช้คำนวณ idleBeforeFirstTouchMs */
  useEffect(() => {
    if (isPlayerTurn) {
      const remainingMs = clock ? (playerColor === 'w' ? clock.whiteRemainingMs : clock.blackRemainingMs) : 0;
      moveTrackerRef.current.startMoveTurn(remainingMs);
      firstTouchRecordedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- เริ่ม tracker เฉพาะตอนเปลี่ยนกลับมาเป็นตาผู้เล่น
  }, [isPlayerTurn]);

  // --------------------------------------------------------------------------
  // Panic score: อัปเดตทุกครั้งที่นาฬิกา tick (ทุก ~100ms ระหว่าง running) เพื่อ
  // ให้ PanicMeter ขยับตามเวลาที่กดดันขึ้นเรื่อยๆ แม้ผู้เล่นจะยังไม่แตะอะไรเลย
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!clock || !isPlayerTurn) return;

    const remainingMs = playerColor === 'w' ? clock.whiteRemainingMs : clock.blackRemainingMs;
    const baseTimeMs = remainingMs + clock.elapsedInCurrentTurnMs; // ประมาณ base เท่าที่รู้ ณ ตอนนี้ (ไม่รวม increment สะสมของตาก่อนๆ แต่พอสำหรับ ratio)
    const liveCounts = moveTrackerRef.current.getLiveCounts(clock.elapsedInCurrentTurnMs);

    const panicResult = panicCalculatorRef.current.calculate({
      telemetry: {
        selectionCancelCount: liveCounts.selectionCancelCount,
        repeatClickSamePiece: liveCounts.repeatClickSamePiece,
      } as Parameters<PanicCalculator['calculate']>[0]['telemetry'],
      clockRemainingMs: remainingMs,
      baseTimeMs,
      thinkTimeMs: clock.elapsedInCurrentTurnMs,
      personalAvgThinkTimeMs: 0,
      evalTrendLast3Moves: 0,
    });

    telemetryActions.updateLiveMetrics({
      panicScore: panicResult.panicScore,
      hesitationIndex: liveCounts.hesitationIndex,
      isUnderTimePressure: computeIsUnderTimePressure(remainingMs, baseTimeMs),
      triggerFlags: panicResult.triggerFlags,
    });
  }, [clock, isPlayerTurn, playerColor, telemetryActions]);

  // --------------------------------------------------------------------------
  // Tab blur — สลับแท็บไปดูอย่างอื่นระหว่างคิดตา (Schema 1: behavior.tabBlurCount)
  // --------------------------------------------------------------------------
  useEffect(() => {
    function handleVisibilityChange(): void {
      if (document.hidden && isPlayerTurn) {
        moveTrackerRef.current.recordBlur();
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isPlayerTurn]);

  // --------------------------------------------------------------------------
  // Drag distance — ติดตามระยะทางที่เมาส์ลากจริง (ไม่ใช่แค่ from/to square) โดย
  // ฟัง pointerdown/pointermove/pointerup บน wrapper div รอบกระดานทั้งก้อน
  // --------------------------------------------------------------------------
  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragStartPosRef.current = { x: event.clientX, y: event.clientY };
    markFirstTouchIfNeeded();
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartPosRef.current;
    if (!start) return;
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (distance > 2) {
      // กัน noise ของการคลิกเฉยๆ (มือสั่นนิดหน่อยไม่ควรนับเป็น drag)
      moveTrackerRef.current.recordDragDistance(distance);
    }
    dragStartPosRef.current = null;
  }, []);

  function markFirstTouchIfNeeded(): void {
    if (!firstTouchRecordedRef.current && isPlayerTurn) {
      firstTouchRecordedRef.current = true;
    }
  }

  // --------------------------------------------------------------------------
  // Hover heatmap — จับเวลาที่เมาส์ค้างอยู่บนแต่ละช่อง
  // --------------------------------------------------------------------------
  const handleMouseOverSquare = useCallback((square: string) => {
    hoverStartRef.current = { square, atMs: now() };
  }, []);

  const handleMouseOutSquare = useCallback((square: string) => {
    const hover = hoverStartRef.current;
    if (hover && hover.square === square) {
      const durationMs = now() - hover.atMs;
      if (durationMs > 0) moveTrackerRef.current.recordHover(square as Square, durationMs);
    }
    hoverStartRef.current = null;
  }, []);

  // --------------------------------------------------------------------------
  // Click-to-move — สลับเลือก/ยกเลิก/เดิน ตามตรรกะ: คลิกช่องเดิมซ้ำ = cancel,
  // คลิกหมากตัวเองอีกตัว = สลับ selection (ตัวเก่านับเป็น cancel), คลิกช่องที่
  // เดินได้ = ยืนยันเดิน
  // --------------------------------------------------------------------------
  const attemptMove = useCallback(
    (from: string, to: string): boolean => {
      const legalMoves = useGameStore.getState().actions.getLegalMovesFrom(from);
      const match = legalMoves.find((m) => m.to === to);
      if (!match) return false;

      const remainingMs = clock ? (playerColor === 'w' ? clock.whiteRemainingMs : clock.blackRemainingMs) : 0;
      const thinkTimeMs = clock?.elapsedInCurrentTurnMs ?? 0;
      const telemetry = moveTrackerRef.current.flushMoveTelemetry(thinkTimeMs, remainingMs);
      const moveTelemetry: MoveLogRecord['behavior'] & Pick<MoveLogRecord['timing'], 'idleBeforeFirstTouchMs'> = {
        ...telemetry.behavior,
        idleBeforeFirstTouchMs: telemetry.idleBeforeFirstTouchMs,
      };
      void gameActions.makePlayerMove({ from: from as never, to: to as never, promotion: match.promotion }, moveTelemetry);
      return true;
    },
    [gameActions],
  );

  const handleSquareClick = useCallback(
    (square: string) => {
      if (!isPlayerTurn) return;
      markFirstTouchIfNeeded();

      const pieceHere = useGameStore.getState().actions.getPieceAt(square);
      const isOwnPiece = pieceHere !== null && pieceHere.color === playerColor;

      if (selectedSquare === null) {
        if (isOwnPiece) {
          moveTrackerRef.current.recordSelect(square as Square);
          setSelectedSquare(square);
        }
        return;
      }

      if (square === selectedSquare) {
        // คลิกซ้ำช่องเดิม — ยกเลิกการเลือก
        moveTrackerRef.current.recordCancel(square as Square);
        setSelectedSquare(null);
        return;
      }

      const moved = attemptMove(selectedSquare, square);
      if (moved) {
        setSelectedSquare(null);
        return;
      }

      // เดินไม่ได้ — ถ้าคลิกโดนหมากตัวเองอีกตัว ถือเป็นการสลับ selection (ของเก่านับ cancel)
      if (isOwnPiece) {
        moveTrackerRef.current.recordCancel(selectedSquare as Square);
        moveTrackerRef.current.recordSelect(square as Square);
        setSelectedSquare(square);
      } else {
        moveTrackerRef.current.recordCancel(selectedSquare as Square);
        setSelectedSquare(null);
      }
    },
    [isPlayerTurn, playerColor, selectedSquare, attemptMove],
  );

  // --------------------------------------------------------------------------
  // Drag-and-drop move (react-chessboard v4: onPieceDrop)
  // --------------------------------------------------------------------------
  const handlePieceDrop = useCallback(
    (sourceSquare: string, targetSquare: string): boolean => {
      if (!isPlayerTurn) return false;
      markFirstTouchIfNeeded();

      if (sourceSquare === targetSquare) {
        // ยกหมากขึ้นมาแล้ววางคืนที่เดิม — ถือเป็น cancel เหมือนคลิกซ้ำ
        moveTrackerRef.current.recordCancel(sourceSquare as Square);
        setSelectedSquare(null);
        return false;
      }

      const moved = attemptMove(sourceSquare, targetSquare);
      if (moved) setSelectedSquare(null);
      return moved;
    },
    [isPlayerTurn, attemptMove],
  );

  // --------------------------------------------------------------------------
  // ไฮไลต์ช่องที่เลือกอยู่ + ช่องที่เดินได้จากช่องนั้น (UX พื้นฐาน — ไม่ใช่ requirement
  // ของ telemetry แต่จำเป็นสำหรับ click-to-move ให้ใช้งานได้จริง)
  // --------------------------------------------------------------------------
  const customSquareStyles = useMemo(() => {
    if (!selectedSquare) return {};
    const styles: Record<string, React.CSSProperties> = {
      [selectedSquare]: { backgroundColor: 'rgba(255, 255, 0, 0.4)' },
    };
    const legalMoves = useGameStore.getState().actions.getLegalMovesFrom(selectedSquare);
    for (const move of legalMoves) {
      styles[move.to] = {
        ...styles[move.to],
        boxShadow: 'inset 0 0 0 4px rgba(0, 0, 0, 0.25)',
      };
    }
    return styles;
  }, [selectedSquare]);

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      style={{ width: '100%', maxWidth: 560, touchAction: 'none' }}
    >
      <Chessboard
        position={fen}
        boardOrientation={playerColor === 'b' ? 'black' : 'white'}
        arePiecesDraggable={isPlayerTurn}
        onPieceDrop={handlePieceDrop}
        onSquareClick={handleSquareClick}
        onMouseOverSquare={handleMouseOverSquare}
        onMouseOutSquare={handleMouseOutSquare}
        customSquareStyles={customSquareStyles}
        animationDuration={200}
      />
    </div>
  );
}

export default BoardContainer;
