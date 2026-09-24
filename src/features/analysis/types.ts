/**
 * types.ts  (src/features/analysis/)
 * ---------------------------------------------------------------------------
 * ⚠️ ผมไม่มีไฟล์จริงของ GameAnalyzer.ts / classifier.ts / useSandboxStore.ts /
 * shared/types/schema.ts เลยกำหนด type กลุ่มนี้ไว้ "เฉพาะสำหรับ UI 4 ไฟล์ใน
 * โฟลเดอร์ analysis/" แทนที่จะเดา import จากไฟล์ที่ไม่เห็น — ArrowLayer /
 * EvalChart / MoveList รับข้อมูลผ่าน props ล้วนๆ (presentational component)
 * ไม่ผูกกับ store ไหนโดยตรง มีแค่ AnalysisScreen.tsx ไฟล์เดียวที่ต้อง map
 * ข้อมูลจริงจาก GameAnalyzer/MoveLogRecord ให้เข้ารูป AnalyzedMove ด้านล่างนี้
 * ก่อนส่งต่อ — ถ้าโครงสร้างจริงต่างจากนี้ แก้แค่จุด map ใน AnalysisScreen.tsx
 * พอ ไม่ต้องแตะ 3 ไฟล์ที่เหลือ
 * ---------------------------------------------------------------------------
 */

import type { Square } from 'chess.js';

/** ตรงกับ Schema 1 `engine.classification` (Phase 0 §3.1) */
export type MoveClassification = 'brilliant' | 'great' | 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'forced';

export interface EvalScore {
  readonly type: 'cp' | 'mate';
  readonly value: number;
}

/** ผลวิเคราะห์ของ 1 ตา — สิ่งที่ GameAnalyzer ควร map มาให้ตรงรูปนี้ */
export interface AnalyzedMove {
  readonly ply: number;
  readonly moveNumber: number;
  readonly color: 'w' | 'b';
  readonly san: string;
  readonly uci: string;
  readonly fenBefore: string;
  readonly fenAfter: string;
  readonly evalBefore: EvalScore | null;
  readonly evalAfter: EvalScore | null;
  readonly bestMoveUci: string | null;
  readonly classification: MoveClassification | null;
  readonly centipawnLoss: number | null;
}

export interface AccuracySummary {
  readonly playerAccuracyPct: number;
  readonly avgCentipawnLoss: number;
  readonly counts: Readonly<Partial<Record<MoveClassification, number>>>;
}

export type ArrowKind = 'best' | 'played-mistake' | 'played-blunder';

export interface BoardArrow {
  readonly id: string;
  readonly from: Square;
  readonly to: Square;
  readonly kind: ArrowKind;
}

/** สี/ความหนาต่อชนิดลูกศร — export ไว้ให้ MoveList/AnalysisScreen ใช้สีชุดเดียวกันตอนทำ legend หรือ badge */
export const ARROW_COLORS: Readonly<Record<ArrowKind, string>> = {
  best: '#22c55e', // green-500
  'played-mistake': '#f97316', // orange-500
  'played-blunder': '#ef4444', // red-500
};

/** map classification → badge text ตามที่ระบุ (เฉพาะ 5 ระดับที่ควรมี badge — best/good/forced ปล่อยว่างไม่ให้รก) */
export const CLASSIFICATION_BADGE: Readonly<Partial<Record<MoveClassification, string>>> = {
  brilliant: '!!',
  great: '!',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};

export const CLASSIFICATION_COLOR: Readonly<Record<MoveClassification, string>> = {
  brilliant: 'text-teal-600',
  great: 'text-blue-600',
  best: 'text-gray-400',
  good: 'text-gray-400',
  inaccuracy: 'text-yellow-600',
  mistake: 'text-orange-600',
  blunder: 'text-red-600',
  forced: 'text-gray-400',
};

/** แปลง eval เป็นค่า centipawn ที่ clamp อยู่ในช่วง -1000..1000 สำหรับกราฟ — mate ปัดเป็น ±1000 ตามฝ่ายที่ได้เปรียบ */
export function evalToClampedCp(score: EvalScore | null): number {
  if (!score) return 0;
  if (score.type === 'mate') return score.value >= 0 ? 1000 : -1000;
  return Math.max(-1000, Math.min(1000, score.value));
}
