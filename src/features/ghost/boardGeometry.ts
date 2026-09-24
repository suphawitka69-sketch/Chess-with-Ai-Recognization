/**
 * boardGeometry.ts
 * ---------------------------------------------------------------------------
 * แปลงชื่อช่อง ("e4") เป็นตำแหน่งพิกเซลบนกระดาน — สร้างแยกเป็นไฟล์เดียวเพราะ
 * ทั้ง HeatmapOverlay.tsx และ GhostPiece.tsx ต้องใช้สูตรแปลงพิกัดแบบเดียวกัน
 * เป๊ะๆ (รวมถึงการกลับด้านตาม orientation) — ถ้าแยกเขียนคนละที่แล้วสูตรใด
 * สูตรหนึ่งพลาด สอง overlay จะไม่ align กัน โดยเฉพาะตอน orientation='black'
 * ---------------------------------------------------------------------------
 */

import type { Square } from 'chess.js';

export type BoardOrientation = 'white' | 'black';

export interface SquarePixelRect {
  readonly left: number;
  readonly top: number;
  readonly size: number;
}

export interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * ตำแหน่งมุมซ้ายบนของช่องที่ระบุ (เป็นพิกเซล) — orientation='white' หมายถึง
 * มุมมองปกติที่ขาวอยู่ล่าง (rank1 แถวล่างสุด), 'black' คือหมุนกระดาน 180 องศา
 */
export function squareToPixelRect(square: Square, boardWidthPx: number, orientation: BoardOrientation): SquarePixelRect {
  const size = boardWidthPx / 8;
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number.parseInt(square[1] ?? '1', 10) - 1;

  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;

  return { left: col * size, top: row * size, size };
}

/** จุดกึ่งกลางของช่อง (เป็นพิกเซล) — ใช้วาดเส้น/ลูกศรที่ต้องชี้ตรงกลางช่องพอดี */
export function squareCenterPx(square: Square, boardWidthPx: number, orientation: BoardOrientation): PixelPoint {
  const rect = squareToPixelRect(square, boardWidthPx, orientation);
  return { x: rect.left + rect.size / 2, y: rect.top + rect.size / 2 };
}
