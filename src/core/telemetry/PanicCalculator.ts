/**
 * src/core/telemetry/PanicCalculator.ts
 * ---------------------------------------------------------------------------
 * คำนวณ Panic Score (0-100) — โมเดลสรีรวิทยา & Cognitive Science ฉบับสมบูรณ์
 *
 * อ้างอิงงานวิจัยทางการแพทย์และวิทยาศาสตร์การกีฬา:
 * 1. Troubat et al. (2009) & Fuentes et al. (2018):
 *    - การประมวลผลหมากรุกกระตุ้น Sympathetic Nervous System ทำให้ Heart Rate พุ่งสูง
 *    - Vagal Recovery Lag: ร่างกายใช้เวลาผ่อนคลายอย่างน้อย 30-60 วินาที ฮอร์โมนความเครียด
 *      ไม่ดิ่งลงสู่ศูนย์ทันทีหลังปล่อยหมาก
 * 2. Neurovisceral Integration Model (Thayer et al.):
 *    - 0-2.5s  : Pattern recognition ปกติ
 *    - 2.5-8s  : Working memory และ Executive function ทำงานหนัก ความเครียดเริ่มไต่ระดับ
 *    - > 8s    : Cognitive strain รุนแรง ยับยั้ง Parasympathetic ชัดเจน
 * 3. Situational Stress Floor:
 *    - ในสถานะเสียเปรียบหรือเพิ่งเสียหมาก ระดับความตึงเครียดพื้นฐาน (Baseline) จะถูกล็อกไว้สูง
 *      ไม่ลดลงแม้จะตัดสินใจเดินหมากตาถัดไปอย่างรวดเร็ว
 * ---------------------------------------------------------------------------
 */

import type { RawMoveTelemetrySnapshot } from './events';

export type PanicTriggerFlag =
  | 'low_clock'
  | 'time_scramble'
  | 'after_blunder'
  | 'high_hesitation'
  | 'repeated_indecision'
  | 'eval_collapse'
  | 'panic_insta_move'
  | 'tunnel_vision';

export interface PanicCalculationInput {
  readonly telemetry: RawMoveTelemetrySnapshot;
  readonly clockRemainingMs: number;
  readonly baseTimeMs: number;
  readonly thinkTimeMs?: number;
  readonly personalAvgThinkTimeMs?: number;
  readonly evalTrendLast3Moves?: number;
  readonly isAfterBlunder?: boolean;
  readonly isCheck?: boolean;
}

export interface PanicCalculationResult {
  readonly rawScore: number;
  readonly panicScore: number;
  readonly panicDelta: number;
  readonly confidenceProxy: number;
  readonly triggerFlags: readonly PanicTriggerFlag[];
  readonly breakdown: {
    readonly cancelFactor: number;
    readonly repeatClickFactor: number;
    readonly timePressureFactor: number;
    readonly thinkTimeFactor: number;
    readonly evalTrendFactor: number;
    readonly instaMoveFactor: number;
  };
}

// ============================================================================
// ⚙️ พารามิเตอร์ปรับแต่งอ้างอิงสรีรวิทยา (PHYSIOLOGICAL CONFIG)
// ============================================================================
const PANIC_CONFIG = {
  /** ความไวการตอบสนองของเข็ม EMA (0.35 = นุ่มนวลแต่ไม่หน่วงเฉื่อย) */
  emaAlpha: 0.36,

  /** สัดส่วนความเครียดตกค้างหลังปล่อยหมาก (Vagal Lag: คงไว้ 82% ไม่ดิ่งลงทันที) */
  postMoveRetentionBase: 0.82,

  /** วินาทีที่สมองเริ่มใช้ Working Memory หนัก (ไต่ระดับความลน) */
  thinkTimeStartSec: 2.5,

  /** เกณฑ์วิกฤตเวลาคิดต่อเนื่อง (วินาที) */
  heavyCognitiveStrainSec: 8.0,

  /** เกณฑ์เวลาสะดุ้งเดินเร็วตอนคับขัน (Insta-move Amygdala Reflex) */
  instaMoveThresholdSec: 1.5,

  /** น้ำหนักคะแนนสูงสุดของแต่ละปัจจัย */
  weights: {
    cancel: 20,       // ยกเลิกหมาก
    repeatClick: 15,  // คลิกตัวเดิมซ้ำ
    timePressure: 25, // เวลานาฬิกาเหลือน้อย
    thinkTimeMax: 50, // คิดนานสะสม
    evalTrend: 25,    // สถานการณ์เสียเปรียบ (ปรับเพิ่มจาก 15 ให้มีผลจริง)
    instaMove: 30,    // แต้มดีดเมื่อสะดุ้งเดินเร็วหลังเกิดวิกฤต
  },
} as const;

export class PanicCalculator {
  private previousEmaScore: number = 0;
  private postMoveResidualStress: number = 0;
  private previousThinkTimeMs: number = 0;
  private isInitialized: boolean = false;

  public calculate(input: PanicCalculationInput): PanicCalculationResult {
    const { telemetry, clockRemainingMs, baseTimeMs } = input;
    const evalTrend = input.evalTrendLast3Moves ?? 0;
    const currentThinkMs = input.thinkTimeMs ?? 0;
    const thinkSeconds = currentThinkMs / 1000;

    // ------------------------------------------------------------------------
    // 1. ตรวจจับการเปลี่ยนตาเดิน (Turn Transition & Residual Lag)
    // ------------------------------------------------------------------------
    if (this.isInitialized && currentThinkMs < this.previousThinkTimeMs - 500) {
      this.postMoveResidualStress = this.previousEmaScore * PANIC_CONFIG.postMoveRetentionBase;
    }
    this.previousThinkTimeMs = currentThinkMs;

    // ------------------------------------------------------------------------
    // 2. 🛡️ Situational Danger Floor (ล็อกความกดดันเมื่อกระดานกำลังเสียเปรียบ)
    // ------------------------------------------------------------------------
    const isInCrisis =
      Boolean(input.isAfterBlunder) ||
      Boolean(input.isCheck) ||
      evalTrend <= -80 ||
      this.previousEmaScore >= 60;

    // ถ้ากำลังเสียเปรียบหนัก ล็อกเพดานความเครียดขั้นต่ำไว้ที่ 40-55 แต้มเสมอ ไม่ยอมให้ตกฮวบ
    let dangerFloor = 0;
    if (isInCrisis) {
      dangerFloor = Boolean(input.isAfterBlunder) || evalTrend <= -150 ? 55 : 40;
    }

    // ------------------------------------------------------------------------
    // 3. ตรวจจับ Insta-Move Panic Reflex (< 1.5s ตอนคับขัน)
    // ------------------------------------------------------------------------
    const isInstaMove = thinkSeconds > 0 && thinkSeconds < PANIC_CONFIG.instaMoveThresholdSec;
    let instaMoveFactor = 0;
    if (isInstaMove && isInCrisis) {
      const rushIntensity = 1 - thinkSeconds / PANIC_CONFIG.instaMoveThresholdSec;
      instaMoveFactor = clamp(
        Math.round(PANIC_CONFIG.weights.instaMove * rushIntensity),
        15,
        PANIC_CONFIG.weights.instaMove,
      );
    }

    // ------------------------------------------------------------------------
    // 4. คำนวณอัตราการผ่อนคลาย (Autonomic Decay)
    // ------------------------------------------------------------------------
    let sustainedStress = 0;
    if (this.postMoveResidualStress > 0) {
      if (isInCrisis) {
        // อยู่ในวิกฤต: ล็อกความเครียดตกค้างไว้สูงมาก (90-95%)
        sustainedStress = Math.max(dangerFloor, this.postMoveResidualStress * 0.92);
      } else if (thinkSeconds < PANIC_CONFIG.thinkTimeStartSec) {
        // คิดเร็วในสภาวะปกติ: ค่อยๆ ทยอยผ่อนคลายลงทีละนิด
        const relaxationRatio = thinkSeconds / PANIC_CONFIG.thinkTimeStartSec;
        sustainedStress = this.postMoveResidualStress * (1.0 - relaxationRatio * 0.30);
      } else if (thinkSeconds < PANIC_CONFIG.heavyCognitiveStrainSec) {
        // คิด 2.5 - 8 วินาที: ทรงตัว
        sustainedStress = this.postMoveResidualStress * 0.78;
      } else {
        // คิด > 8 วินาที: ความเครียดเริ่มสะสมต่อเนื่อง
        sustainedStress = this.postMoveResidualStress * 0.90;
      }
    }

    // ------------------------------------------------------------------------
    // 5. ปัจจัยพฤติกรรมสดในตานี้ (Instant Factors)
    // ------------------------------------------------------------------------
    const cancelFactor = PANIC_CONFIG.weights.cancel * clamp01(telemetry.selectionCancelCount / 4);
    const repeatClickFactor = PANIC_CONFIG.weights.repeatClick * clamp01(telemetry.repeatClickSamePiece / 3);

    // เวลาบนนาฬิกาใกล้หมด
    const timeThresholdMs = baseTimeMs * 0.25;
    let timePressureFactor = 0;
    if (timeThresholdMs > 0 && clockRemainingMs < timeThresholdMs) {
      timePressureFactor = PANIC_CONFIG.weights.timePressure * clamp01(1 - clockRemainingMs / timeThresholdMs);
    }

    // ⭐ เวลาคิด (Think Time Escalation) ปรับให้ตอบสนองทันใจ:
    // เกิน 2.5 วิ เริ่มไต่ | 6 วิ ได้ ~14 แต้ม | 10 วิ ได้ ~28 แต้ม | 15-20 วิ ได้ 45-50 แต้มเต็ม
    let thinkTimeFactor = 0;
    if (thinkSeconds >= PANIC_CONFIG.thinkTimeStartSec) {
      const excessSec = thinkSeconds - PANIC_CONFIG.thinkTimeStartSec;
      if (excessSec <= 5.5) {
        // ช่วง 2.5 - 8 วินาที: ไต่ขึ้นสม่ำเสมอ (~3 แต้มต่อวินาที)
        thinkTimeFactor = Math.round(excessSec * 3.2);
      } else {
        // เกิน 8 วินาที: ดันแต้มเร็วขึ้นอย่างเห็นได้ชัด (~4 แต้มต่อวินาที)
        thinkTimeFactor = Math.round(18 + (excessSec - 5.5) * 4.0);
      }
      thinkTimeFactor = clamp(thinkTimeFactor, 0, PANIC_CONFIG.weights.thinkTimeMax);
    }

    // สถานการณ์เสียเปรียบ (น้ำหนัก 25)
    const evalTrendFactor = PANIC_CONFIG.weights.evalTrend * clamp01(-evalTrend / 160);

    const instantScore =
      cancelFactor +
      repeatClickFactor +
      timePressureFactor +
      thinkTimeFactor +
      evalTrendFactor +
      instaMoveFactor;

    // ------------------------------------------------------------------------
    // 6. สังเคราะห์คะแนนขั้นสุดท้าย (ผสาน Danger Floor)
    // ------------------------------------------------------------------------
    const baseCalculated = Math.max(instantScore, sustainedStress);
    const rawScore = clamp(Math.round(Math.max(baseCalculated, dangerFloor)), 0, 100);

    const smoothedScore = this.isInitialized
      ? PANIC_CONFIG.emaAlpha * rawScore + (1 - PANIC_CONFIG.emaAlpha) * this.previousEmaScore
      : rawScore;

    const finalPanicScore = Math.round(clamp(smoothedScore, 0, 100));
    const panicDelta = this.isInitialized ? finalPanicScore - this.previousEmaScore : 0;

    this.previousEmaScore = finalPanicScore;
    this.isInitialized = true;

    const confidenceProxy = Number((1 - finalPanicScore / 100).toFixed(2));

    // Trigger Flags
    const triggerFlags: PanicTriggerFlag[] = [];
    if (clockRemainingMs <= 30_000) triggerFlags.push('low_clock');
    if (timePressureFactor >= 18) triggerFlags.push('time_scramble');
    if (telemetry.selectionCancelCount >= 3) triggerFlags.push('repeated_indecision');
    if (thinkSeconds >= 12 || finalPanicScore >= 50) triggerFlags.push('high_hesitation');
    if (evalTrendFactor >= 15) triggerFlags.push('eval_collapse');
    if (input.isAfterBlunder) triggerFlags.push('after_blunder');
    if (instaMoveFactor >= 15) triggerFlags.push('panic_insta_move');
    if (
      (telemetry.selectionCancelCount >= 3 || telemetry.repeatClickSamePiece >= 2) &&
      finalPanicScore >= 50
    ) {
      triggerFlags.push('tunnel_vision');
    }

    return {
      rawScore,
      panicScore: finalPanicScore,
      panicDelta,
      confidenceProxy,
      triggerFlags,
      breakdown: {
        cancelFactor: Math.round(cancelFactor),
        repeatClickFactor: Math.round(repeatClickFactor),
        timePressureFactor: Math.round(timePressureFactor),
        thinkTimeFactor: Math.round(thinkTimeFactor),
        evalTrendFactor: Math.round(evalTrendFactor),
        instaMoveFactor: Math.round(instaMoveFactor),
      },
    };
  }

  public reset(): void {
    this.previousEmaScore = 0;
    this.postMoveResidualStress = 0;
    this.previousThinkTimeMs = 0;
    this.isInitialized = false;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}