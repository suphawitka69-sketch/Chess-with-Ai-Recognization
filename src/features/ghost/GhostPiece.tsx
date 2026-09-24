/**
 * GhostPiece.tsx
 * ---------------------------------------------------------------------------
 * ซ้อนทับกระดานด้วยตัวหมากโปร่งแสง + ลูกศรเส้นประ จำลองว่า GM กำลังเล็งตา
 * ล่วงหน้ากี่ตาอยู่ — export component ชื่อ `GhostPieceOverlay` (ไม่ใช่
 * `GhostPiece` ตรงชื่อไฟล์เป๊ะๆ) เพราะ `GhostPiece` เป็นชื่อ type ข้อมูลที่
 * import มาจาก MindMeltCalculator อยู่แล้ว — ตั้งชื่อชนกันจะบังคับให้ทุกที่ที่
 * ใช้ทั้งสองต้อง alias เอง จึงแยกชื่อให้ชัดเจนตั้งแต่ต้นทาง
 *
 * ไม่มีข้อมูลสี (ขาว/ดำ) ของ ghost piece ในสเปก — ใช้สัญลักษณ์หมากรุกชุด
 * "outline" (♙♘♗♖♕♔) ทั้งหมดโดยไม่สนใจสี เพราะให้ความรู้สึกโปร่งแสง/เป็นภาพ
 * ลวงตามากกว่าชุด "filled" (♟♞♝♜♛♚) อยู่แล้ว เหมาะกับคอนเซปต์ "ผี" ของโหมดนี้
 * ---------------------------------------------------------------------------
 */

import { useMemo } from 'react';
import type { GhostPiece as GhostPieceData } from '../../core/analysis/MindMeltCalculator';
import { squareCenterPx, squareToPixelRect, type BoardOrientation } from './boardGeometry';

// ============================================================================
// Types
// ============================================================================

export interface GhostPieceOverlayProps {
  readonly ghostPieces: readonly GhostPieceData[];
  readonly boardWidthPx: number;
  readonly orientation: BoardOrientation;
  readonly enabled: boolean;
}

interface GhostRenderItem {
  readonly key: string;
  readonly ghost: GhostPieceData;
  readonly targetRect: { readonly left: number; readonly top: number; readonly size: number };
  readonly fromCenter: { readonly x: number; readonly y: number };
  readonly toCenter: { readonly x: number; readonly y: number };
}

const PIECE_GLYPH: Record<GhostPieceData['piece'], string> = {
  p: '♙',
  n: '♘',
  b: '♗',
  r: '♖',
  q: '♕',
  k: '♔',
};

// ============================================================================
// Component
// ============================================================================

export function GhostPieceOverlay(props: GhostPieceOverlayProps) {
  const { ghostPieces, boardWidthPx, orientation, enabled } = props;

  const items: readonly GhostRenderItem[] = useMemo(() => {
    if (!enabled) return [];
    return ghostPieces.map((ghost, index) => ({
      key: `${ghost.from}-${ghost.to}-${ghost.plyOffset}-${index}`,
      ghost,
      targetRect: squareToPixelRect(ghost.to, boardWidthPx, orientation),
      fromCenter: squareCenterPx(ghost.from, boardWidthPx, orientation),
      toCenter: squareCenterPx(ghost.to, boardWidthPx, orientation),
    }));
  }, [enabled, ghostPieces, boardWidthPx, orientation]);

  if (!enabled || items.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <svg width={boardWidthPx} height={boardWidthPx} viewBox={`0 0 ${boardWidthPx} ${boardWidthPx}`} className="absolute inset-0">
        {items.map((item) => (
          <line
            key={`arrow-${item.key}`}
            x1={item.fromCenter.x}
            y1={item.fromCenter.y}
            x2={item.toCenter.x}
            y2={item.toCenter.y}
            stroke="rgba(226, 232, 240, 0.55)"
            strokeWidth={2}
            strokeDasharray="4 4"
            opacity={clamp01(item.ghost.intensity)}
          />
        ))}
      </svg>

      {items.map((item) => (
        <div
          key={`piece-${item.key}`}
          className="absolute flex select-none items-center justify-center"
          style={{
            left: item.targetRect.left,
            top: item.targetRect.top,
            width: item.targetRect.size,
            height: item.targetRect.size,
            fontSize: item.targetRect.size * 0.7,
            opacity: clamp01(item.ghost.intensity) * 0.85,
            color: '#e2e8f0',
            textShadow: '0 0 6px rgba(226, 232, 240, 0.6)',
          }}
        >
          {PIECE_GLYPH[item.ghost.piece]}
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
