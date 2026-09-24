/**
 * src/features/analysis/SandboxBoard.tsx
 * ---------------------------------------------------------------------------
 * กระดานหมากรุกสำหรับโหมดวิเคราะห์และ Sandbox (Instance B)
 * - แยก State การเดินออกจากกระดานจริง 100% ผ่าน useSandboxStore
 * - ซ้อน ArrowLayer (ลูกศร SVG ชี้ตาที่ดีที่สุด / ตาที่พลาด) ทับบนกระดาน
 * - รองรับการแตกกิ่งสายแยกเมื่อผู้เล่นลองเดินหมากในโหมดวิเคราะห์
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Chessboard } from 'react-chessboard';
import {
  useSandboxActions,
  useSandboxActive,
  useSandboxFen,
  useSandboxStore,
} from '../../state/useSandboxStore';
import { ArrowLayer } from './ArrowLayer';
import type { BoardArrow } from './types';
import type { PromotionPiece } from '../../core/chess/GameEngine';
import type { Square } from 'chess.js';

export interface SandboxBoardProps {
  /** ตำแหน่ง FEN ที่ต้องการแสดงผล (ถ้าไม่ส่งมา จะอ่านจาก useSandboxStore อัตโนมัติ) */
  readonly fen?: string;
  /** มุมมองฝั่งกระดาน ('white' | 'black') */
  readonly orientation?: 'white' | 'black';
  /** รายการลูกศรที่ต้องการวาดซ้อนบนกระดาน */
  readonly arrows?: readonly BoardArrow[];
  /** ความกว้างกระดาน (px) — ถ้าไม่ระบุ จะปรับตามขนาดหน้าจอแบบ Responsive */
  readonly width?: number;
  readonly className?: string;
}

export function SandboxBoard(props: SandboxBoardProps): JSX.Element {
  const {
    fen: propFen,
    orientation = 'white',
    arrows = [],
    width: fixedWidth,
    className,
  } = props;

  const sandboxFen = useSandboxFen();
  const isSandboxActive = useSandboxActive();
  const sandboxState = useSandboxStore((s) => s.state);
  const sandboxActions = useSandboxActions();

  // ใช้ FEN จาก Sandbox ถ้ากำลังเปิดโหมดลองเดินอยู่ ถ้าไม่จะใช้ FEN ที่ส่งมาทาง Props
  const displayFen = propFen ?? (isSandboxActive && sandboxFen ? sandboxFen : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>(fixedWidth ?? 480);

  // วัดขนาดกระดานจริงเพื่อส่งต่อให้ ArrowLayer วาดลูกศรได้ตรงพิกัดช่องพอดีเป๊ะ
  useEffect(() => {
    if (fixedWidth) {
      setMeasuredWidth(fixedWidth);
      return;
    }

    const updateWidth = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0) {
          setMeasuredWidth(rect.width);
        }
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [fixedWidth]);

  // เมื่อผู้เล่นลากปล่อยหมากบนกระดาน Sandbox
  const handlePieceDrop = useCallback(
    (sourceSquare: string, targetSquare: string): boolean => {
      if (sourceSquare === targetSquare) return false;

      try {
        // แตกกิ่งลองเดินบนกระดาน Sandbox
        sandboxActions.tryMove({
          from: sourceSquare as Square,
          to: targetSquare as Square,
          promotion: 'q' as PromotionPiece, // fallback default promotion เป็นควีน
        });
        return true;
      } catch {
        return false;
      }
    },
    [sandboxActions],
  );

  return (
    <div
      ref={containerRef}
      className={[
        'relative aspect-square w-full max-w-[560px] overflow-hidden rounded-2xl shadow-2xl shadow-slate-950/60 ring-1 ring-slate-800',
        className ?? '',
      ].join(' ')}
      style={fixedWidth ? { width: fixedWidth, height: fixedWidth } : undefined}
    >
      {/* กระดานหมากรุก react-chessboard */}
      {isSandboxActive && sandboxState.isEngineThinking && (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 rounded-full border border-amber-500/60 bg-slate-950/80 px-3 py-1 text-center text-xs font-semibold text-amber-200 shadow-lg shadow-amber-900/20">
          🤖 คอมกำลังแก้ลำ…
        </div>
      )}

      <Chessboard
        position={displayFen}
        boardOrientation={orientation}
        arePiecesDraggable={!sandboxState.isEngineThinking}
        onPieceDrop={handlePieceDrop}
        animationDuration={180}
        customDarkSquareStyle={{ backgroundColor: '#334155' }}
        customLightSquareStyle={{ backgroundColor: '#94a3b8' }}
      />

      {/* เลเยอร์ลูกศร SVG ซ้อนทับบนกระดาน */}
      {arrows.length > 0 && (
        <ArrowLayer
          arrows={arrows}
          boardWidthPx={measuredWidth}
          orientation={orientation}
        />
      )}
    </div>
  );
}

// รองรับทั้งแบบ Named Export และ Default Export เพื่อให้ตรงกับ import ของ AnalysisScreen
export default SandboxBoard;