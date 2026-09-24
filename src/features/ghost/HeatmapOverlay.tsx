/**
 * HeatmapOverlay.tsx
 * ---------------------------------------------------------------------------
 * ซ้อนทับกระดานเพื่อแสดงว่าฝ่ายไหนคุมช่องไหนอยู่ (จาก MindMeltCalculator) —
 * เป็น pure display, ไม่มี state, ไม่มี interaction เอง (pointer-events-none
 * ทั้ง container) ช่องที่ควบคุมสมดุลกันพอดี (controlBalance === 0) จะไม่ถูก
 * ไฮไลต์เลย เพราะไม่มีสีที่สื่อความหมายให้ทั้งสองเงื่อนไขที่ spec กำหนดมา
 * ---------------------------------------------------------------------------
 */

import { useMemo } from 'react';
import type { Square } from 'chess.js';
import type { SquareControlMap, SquareControlValue } from '../../core/analysis/MindMeltCalculator';
import { squareToPixelRect, type BoardOrientation } from './boardGeometry';

// ============================================================================
// Types
// ============================================================================

export interface HeatmapOverlayProps {
  readonly squareControl: SquareControlMap | null;
  readonly boardWidthPx: number;
  readonly orientation: BoardOrientation;
  readonly enabled: boolean;
}

interface HeatmapCell {
  readonly square: string;
  readonly rect: { readonly left: number; readonly top: number; readonly size: number };
  readonly color: string;
}

// ============================================================================
// Color constants
// ============================================================================

const WHITE_CONTROL_RGB = '56, 189, 248'; // sky-400
const BLACK_CONTROL_RGB = '249, 115, 22'; // orange-500
const MAX_ALPHA = 0.55;

// ============================================================================
// Component
// ============================================================================

export function HeatmapOverlay(props: HeatmapOverlayProps) {
  const { squareControl, boardWidthPx, orientation, enabled } = props;

  const cells: readonly HeatmapCell[] = useMemo(() => {
    if (!enabled || squareControl === null) return [];

    const entries = Object.entries(squareControl) as readonly [Square, SquareControlValue][];

    return entries
      .filter(([, entry]) => entry.controlBalance !== 0)
      .map(([square, entry]) => {
        const rect = squareToPixelRect(square, boardWidthPx, orientation);
        const rgb = entry.controlBalance > 0 ? WHITE_CONTROL_RGB : BLACK_CONTROL_RGB;
        const alpha = clamp01(entry.controlIntensity) * MAX_ALPHA;
        return { square, rect, color: `rgba(${rgb}, ${alpha})` };
      });
  }, [enabled, squareControl, boardWidthPx, orientation]);

  if (!enabled || squareControl === null || cells.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {cells.map((cell) => (
        <div
          key={cell.square}
          className="absolute"
          style={{
            left: cell.rect.left,
            top: cell.rect.top,
            width: cell.rect.size,
            height: cell.rect.size,
            backgroundColor: cell.color,
          }}
        />
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
