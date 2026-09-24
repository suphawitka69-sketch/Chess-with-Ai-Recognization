/**
 * classifier.ts
 * ---------------------------------------------------------------------------
 * จัดเกรดคุณภาพของตาเดินหนึ่งตา (Move Classification) เป็น 8 ระดับตามที่ระบุใน
 * Phase 0 §3.1 (`engine.classification` field ของ Schema 1):
 *   brilliant | great | best | good | inaccuracy | mistake | blunder | forced
 *
 * แนวคิดการจัดเกรด (เรียงจากตรวจก่อน-หลัง):
 * 1. "forced" ชนะทุกกรณี — ถ้าตานั้นเป็นตาที่ถูกกฎเพียงตาเดียว ไม่มีทางเลือกอื่น
 *    ก็ไม่ควรตัดสินว่าเป็น blunder/mistake แม้ผลลัพธ์จะแย่ลงมากก็ตาม
 * 2. ถ้า centipawn loss ต่ำมาก (แทบไม่เสียเปรียบ) → พิจารณากลุ่ม "คุณภาพสูง"
 *    (brilliant / best / great) โดยแยกกันด้วยอันดับของตาเทียบกับ MultiPV ของ
 *    engine และสัญญาณว่าเป็นการเสียสละหมาก (sacrifice) หรือไม่
 * 3. นอกเหนือจากนั้น จัดเกรดตาม "ความเสียหาย" (centipawn loss และ win% swing)
 *    ตามที่ผู้ใช้ระบุ: blunder = เสีย win% เกิน ~20-30% หรือ cp loss > 300
 *
 * หมายเหตุสำคัญ: การตรวจจับ "brilliant" แบบสมบูรณ์ (ตรวจจับ sacrifice จริง)
 * ต้องอาศัยข้อมูล material balance ก่อน/หลังตาเดิน ซึ่งไม่ใช่ความรับผิดชอบของ
 * ไฟล์นี้ — ผู้เรียก (เช่น GameAnalyzer.ts) มีหน้าที่คำนวณและส่ง flag
 * `sacrificesMaterial` เข้ามา ไฟล์นี้รับผิดชอบแค่ตรรกะการจัดเกรดเท่านั้น
 * ---------------------------------------------------------------------------
 */

import {
  povWinProbability,
  scoreToEquivalentCentipawns,
  type EngineScore,
  type PieceColor,
} from './winProbability';

// ============================================================================
// Types
// ============================================================================

export type MoveClassification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'forced';

/** กลุ่มการจัดเกรดที่ตัดสินจาก "ขนาดความเสียหาย" ล้วนๆ (ไม่รวม forced/brilliant/best/great ที่ต้องอาศัยสัญญาณอื่นประกอบ) */
type LossBasedClassification = Extract<MoveClassification, 'good' | 'inaccuracy' | 'mistake' | 'blunder'>;

export interface ClassifyMoveInput {
  /** สีของผู้เดินตานี้ */
  readonly moverColor: PieceColor;
  /** evaluation ของตำแหน่งก่อนเดิน (มุมมองฝ่ายขาว) — ตรงกับ "engine.evalBefore" ใน Schema 1 */
  readonly scoreBeforeMove: EngineScore;
  /** evaluation ของตำแหน่งหลังเดิน (มุมมองฝ่ายขาว) — ตรงกับ "engine.evalAfter" ใน Schema 1 */
  readonly scoreAfterMove: EngineScore;
  /** true เมื่อเป็นตาที่ถูกกฎเพียงตาเดียวในตำแหน่งนั้น (legalMoveCount === 1) → บังคับจัดเป็น 'forced' เสมอ */
  readonly isOnlyLegalMove?: boolean;
  /** อันดับของตาที่เล่นจริงเทียบกับผลลัพธ์ MultiPV ของ engine (1 = ตาที่ engine ชอบที่สุด) — undefined = ไม่ทราบอันดับ (ถือว่าเป็นตาที่ดีที่สุดเท่าที่ตรวจสอบได้) */
  readonly playedMoveRank?: number;
  /** true เมื่อตานี้เสียสละวัสดุ (material) เทียบกับทางเลือกที่ปลอดภัยกว่า — จำเป็นสำหรับเกรด 'brilliant' */
  readonly sacrificesMaterial?: boolean;
}

export interface MoveClassificationResult {
  readonly classification: MoveClassification;
  /** ความเสียหายเทียบเป็น centipawn จากมุมมองของผู้เดิน (ปัดเป็นจำนวนเต็ม, ไม่ติดลบ) */
  readonly centipawnLoss: number;
  /** win probability ของผู้เดิน ก่อนตาเดินนี้ (0.0-1.0) */
  readonly winProbBefore: number;
  /** win probability ของผู้เดิน หลังตาเดินนี้ (0.0-1.0) */
  readonly winProbAfter: number;
}

// ============================================================================
// Thresholds
// ============================================================================

/**
 * เกณฑ์การจัดเกรด — อ้างอิงคำอธิบายของผู้ใช้: "blunder = เสีย win% เกิน 20-30%
 * หรือ cp loss > 300" ตีความเป็นเกณฑ์ OR (เข้าเงื่อนไขข้อใดข้อหนึ่งก็พอ) และไล่
 * ระดับลงมาสำหรับ mistake/inaccuracy ด้วยสัดส่วนที่ลดหลั่นกันอย่างสมเหตุสมผล
 */
export const CLASSIFICATION_THRESHOLDS = {
  /** cpLoss ที่ยังถือว่า "แทบไม่เสียเปรียบ" พอจะเข้าเกณฑ์ brilliant/best/great */
  negligibleCentipawnLoss: 8,
  /** อันดับสูงสุด (เทียบกับ MultiPV) ที่ยังนับเป็น 'great' ได้ ถ้า cpLoss ต่ำมากแต่ไม่ใช่ตาอันดับ 1 ของ engine */
  greatMaxRank: 3,
  inaccuracy: { centipawnLoss: 60, winProbDrop: 0.1 },
  mistake: { centipawnLoss: 130, winProbDrop: 0.2 },
  blunder: { centipawnLoss: 300, winProbDrop: 0.3 },
} as const;

// ============================================================================
// Public API
// ============================================================================

export function classifyMove(input: ClassifyMoveInput): MoveClassificationResult {
  const {
    moverColor,
    scoreBeforeMove,
    scoreAfterMove,
    isOnlyLegalMove = false,
    playedMoveRank,
    sacrificesMaterial = false,
  } = input;

  const winProbBefore = povWinProbability(scoreBeforeMove, moverColor);
  const winProbAfter = povWinProbability(scoreAfterMove, moverColor);
  const winProbDrop = Math.max(0, winProbBefore - winProbAfter);

  const centipawnLoss = computeCentipawnLoss(scoreBeforeMove, scoreAfterMove, moverColor);

  if (isOnlyLegalMove) {
    return { classification: 'forced', centipawnLoss, winProbBefore, winProbAfter };
  }

  const isNegligibleLoss = centipawnLoss <= CLASSIFICATION_THRESHOLDS.negligibleCentipawnLoss;
  const isEngineTopChoice = playedMoveRank === undefined || playedMoveRank === 1;

  if (isNegligibleLoss) {
    if (sacrificesMaterial && isEngineTopChoice) {
      return { classification: 'brilliant', centipawnLoss, winProbBefore, winProbAfter };
    }
    if (isEngineTopChoice) {
      return { classification: 'best', centipawnLoss, winProbBefore, winProbAfter };
    }
    if (playedMoveRank !== undefined && playedMoveRank <= CLASSIFICATION_THRESHOLDS.greatMaxRank) {
      return { classification: 'great', centipawnLoss, winProbBefore, winProbAfter };
    }
    // cpLoss ต่ำมากแต่ playedMoveRank สูงเกิน greatMaxRank (กรณีนี้แทบไม่เกิดในทางปฏิบัติ
    // เพราะ cpLoss ต่ำมักหมายถึงอันดับต้นๆ อยู่แล้ว) — ปล่อยตกไปจัดเกรดตามขนาดความเสียหายตามปกติ
  }

  const classification = classifyByLossMagnitude(centipawnLoss, winProbDrop);
  return { classification, centipawnLoss, winProbBefore, winProbAfter };
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * คำนวณ centipawn loss จากมุมมองของผู้เดิน — แปลงทั้งสอง score (ซึ่งเป็นมุมมองขาวเสมอ)
 * ให้เป็นมุมมองผู้เดินก่อน แล้วหาผลต่าง (ก่อน - หลัง) โดย clamp ไม่ให้ติดลบ
 * (ถ้าตาเดินทำให้ดีขึ้นกว่าที่ engine ประเมินไว้ก่อนเดิน ถือว่า loss = 0 ไม่ใช่ค่าติดลบ)
 */
function computeCentipawnLoss(scoreBeforeMove: EngineScore, scoreAfterMove: EngineScore, moverColor: PieceColor): number {
  const beforeFromMoverView = toMoverRelativeCentipawns(scoreBeforeMove, moverColor);
  const afterFromMoverView = toMoverRelativeCentipawns(scoreAfterMove, moverColor);
  return Math.max(0, Math.round(beforeFromMoverView - afterFromMoverView));
}

/** แปลง EngineScore (มุมมองขาว) ให้เป็นตัวเลข centipawn จากมุมมองของสีที่ระบุ */
function toMoverRelativeCentipawns(score: EngineScore, moverColor: PieceColor): number {
  const whitePerspectiveCp = scoreToEquivalentCentipawns(score);
  return moverColor === 'w' ? whitePerspectiveCp : -whitePerspectiveCp;
}

/**
 * จัดเกรดตาม "ขนาดความเสียหาย" ล้วนๆ — ใช้เกณฑ์ OR ระหว่าง centipawn loss กับ
 * win probability drop ตามที่ผู้ใช้ระบุ เรียงตรวจจากรุนแรงที่สุดลงมาก่อนเสมอ
 * เพื่อไม่ให้ตาที่เข้าเกณฑ์ blunder ถูกจัดเป็น mistake โดยผิดพลาด
 */
function classifyByLossMagnitude(centipawnLoss: number, winProbDrop: number): LossBasedClassification {
  const { inaccuracy, mistake, blunder } = CLASSIFICATION_THRESHOLDS;

  if (centipawnLoss >= blunder.centipawnLoss || winProbDrop >= blunder.winProbDrop) {
    return 'blunder';
  }
  if (centipawnLoss >= mistake.centipawnLoss || winProbDrop >= mistake.winProbDrop) {
    return 'mistake';
  }
  if (centipawnLoss >= inaccuracy.centipawnLoss || winProbDrop >= inaccuracy.winProbDrop) {
    return 'inaccuracy';
  }
  return 'good';
}
