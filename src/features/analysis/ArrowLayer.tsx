/**
 * ArrowLayer.tsx
 * ---------------------------------------------------------------------------
 * SVG overlay ที่วางซ้อนบนกระดาน (position: absolute, inset-0, pointer-events
 * ปิดไว้ทั้งหมด) — ไม่รู้จัก GameEngine/SandboxStore เลย รับแค่ `arrows` +
 * ขนาด/orientation ของกระดานที่ซ้อนทับอยู่ผ่าน props เพื่อให้คำนวณพิกัดตรงกัน
 * เป๊ะกับ SandboxBoard/react-chessboard ที่วาดอยู่ข้างใต้
 *
 * ต้องส่ง `boardWidthPx` ให้ตรงกับความกว้างจริงของกระดานที่ mount อยู่ด้านล่าง
 * เป๊ะ (react-chessboard เป็นสี่เหลี่ยมจัตุรัสเสมอ ความสูง = ความกว้าง) ไม่งั้น
 * ลูกศรจะไม่ตรงช่อง — แนะนำให้ AnalysisScreen วัดความกว้าง container จริงแล้ว
 * ส่งค่าเดียวกันเข้าทั้ง SandboxBoard และ ArrowLayer
 * ---------------------------------------------------------------------------
 */

import { useMemo } from 'react';
import type { Square } from 'chess.js';
import { ARROW_COLORS, type BoardArrow } from './types';

// ============================================================================
// Types
// ============================================================================

export interface ArrowLayerProps {
  readonly arrows: readonly BoardArrow[];
  readonly boardWidthPx: number;
  readonly orientation: 'white' | 'black';
}

interface Point {
  readonly x: number;
  readonly y: number;
}

// ============================================================================
// Helpers
// ============================================================================

/** แปลง square เช่น "e4" เป็นพิกัดกลางช่อง (px) โดยคำนึงถึง orientation ของกระดาน */
function squareToCenterPoint(square: Square, squareSizePx: number, orientation: 'white' | 'black'): Point {
  const file = square.charCodeAt(0) - 97; // 'a' -> 0 ... 'h' -> 7
  const rank = Number.parseInt(square[1] ?? '1', 10) - 1; // '1' -> 0 ... '8' -> 7

  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;

  return { x: col * squareSizePx + squareSizePx / 2, y: row * squareSizePx + squareSizePx / 2 };
}

/** ร่นจุดปลายลูกศรเข้าหาจุดเริ่มเล็กน้อย กันหัวลูกศรจมลงไปในตัวหมากพอดีเป๊ะจนดูอึดอัด */
function shortenTowards(from: Point, to: Point, shortenByPx: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return to;
  const ratio = Math.max(0, (length - shortenByPx) / length);
  return { x: from.x + dx * ratio, y: from.y + dy * ratio };
}

// ============================================================================
// Component
// ============================================================================

export function ArrowLayer({ arrows, boardWidthPx, orientation }: ArrowLayerProps): JSX.Element {
  const squareSizePx = boardWidthPx / 8;

  const lines = useMemo(() => {
    return arrows.map((arrow) => {
      const start = squareToCenterPoint(arrow.from, squareSizePx, orientation);
      const rawEnd = squareToCenterPoint(arrow.to, squareSizePx, orientation);
      const end = shortenTowards(start, rawEnd, squareSizePx * 0.32); // เผื่อที่ให้หัวลูกศร
      return { ...arrow, start, end };
    });
  }, [arrows, squareSizePx, orientation]);

  return (
    <svg
      width={boardWidthPx}
      height={boardWidthPx}
      viewBox={`0 0 ${boardWidthPx} ${boardWidthPx}`}
      className="pointer-events-none absolute inset-0"
    >
      <defs>
        {(Object.keys(ARROW_COLORS) as (keyof typeof ARROW_COLORS)[]).map((kind) => (
          <marker
            key={kind}
            id={`arrowhead-${kind}`}
            markerWidth={6}
            markerHeight={6}
            refX={4.5}
            refY={3}
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill={ARROW_COLORS[kind]} />
          </marker>
        ))}
      </defs>

      {lines.map((line) => (
        <line
          key={line.id}
          x1={line.start.x}
          y1={line.start.y}
          x2={line.end.x}
          y2={line.end.y}
          stroke={ARROW_COLORS[line.kind]}
          strokeWidth={Math.max(4, squareSizePx * 0.12)}
          strokeLinecap="round"
          opacity={0.85}
          markerEnd={`url(#arrowhead-${line.kind})`}
        />
      ))}
    </svg>
  );
}

export default ArrowLayer;
