/**
 * src/core/telemetry/PanicCalculator.ts
 * ---------------------------------------------------------------------------
 * คำนวณ Panic Score (0-100) — ปรับปรุงด้วยโมเดลสรีรวิทยา & Cognitive Bias:
 *
 * อ้างอิงงานวิจัย:
 * 1. Cognitive Load & Autonomic Recovery in Chess (Troubat et al., 2009 / Fuentes et al., 2018):
 *    หลังผ่านจุดกดดัน อัตราการเต้นหัวใจจะไม่ดิ่งลงสู่ศูนย์ทันที (Recovery Lag)
 * 2. Amygdala Hijack & Panic Reflex (LeDoux / Goleman):
 *    เมื่อถูกโจมตีกะทันหัน ผู้เล่นที่ลนลานมัก "สะดุ้งเดินสวนทันที (< 1.5s)" เพื่อกำจัด
 *    ความกดดันตรงหน้า (Insta-move Panic Response) แทนที่จะหยุดวิเคราะห์รอบกระดาน
 * 3. Neurovisceral Integration Model (Thayer et al.):
 *    - คิด < 5 วินาที  : สมองผ่อนคลาย (Vagal Reactivation) -> คะแนนค่อยๆ ทยอยลดลงนุ่มนวล
 *    - คิด 5-10 วินาที : มี Cognitive Strain ปานกลาง -> ชะลอการลดลง (รักษาระดับไว้)
 *    - คิด > 10 วินาที : สมองใช้ Working Memory หนักมาก -> คงความเครียดเดิมไว้ และดันเข็มขึ้นต่อ
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
  | 'panic_insta_move' // ⚡ เพิ่มใหม่: สะดุ้งเดินเร็วหลังโดนโจมตี
  | 'tunnel_vision';    // 👁️ เพิ่มใหม่: จ้องมองแคบแก้ปัญหาเฉพาะหน้า

export interface PanicCalculationInput {
  readonly telemetry: RawMoveTelemetrySnapshot;
  readonly clockRemainingMs: number;
  readonly baseTimeMs: number;
  readonly thinkTimeMs?: number;
  readonly personalAvgThinkTimeMs?: number;
  readonly evalTrendLast3Moves?: number;
  readonly isAfterBlunder?: boolean;
  readonly isCheck?: boolean; // 👈 เพิ่มใหม่: กำลังโดนรุกหรือไม่ (optional)
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
    readonly instaMoveFactor: number; // 👈 เพิ่มใหม่: แต้มสะดุ้งเดินเร็ว
  };
}

// ============================================================================
// ⚙️ จุดปรับแต่งค่าคอนฟิก (CONFIG & TUNING)
// ============================================================================
const PANIC_CONFIG = {
  /** [จุดปรับ 1]: ความไวของการเคลื่อนที่ของเข็ม EMA (0.1 = นุ่มนวลมาก, 0.5 = ไวมาก) */
  emaAlpha: 0.32,

  /** [จุดปรับ 2]: สัดส่วนความเครียดที่ "คงค้างไว้" ทันทีที่ปล่อยหมาก (0.78 = ลดลงมาแค่ 22% ไม่ตกฮวบ) */
  postMoveRetentionBase: 0.78,

  /** [จุดปรับ 3]: เกณฑ์เวลาเริ่มเครียดปานกลาง (วินาที) */
  mildStressThresholdSec: 5.0,

  /** [จุดปรับ 4]: เกณฑ์เวลาใช้ความคิดหนักต่อเนื่อง (วินาที) */
  heavyStressThresholdSec: 10.0,

  /** [จุดปรับ 5]: เกณฑ์เวลาสะดุ้งเดินเร็ว (Insta-move Panic Reflex ในสถานการณ์กดดัน) */
  instaMoveThresholdSec: 1.5,

  /** [จุดปรับ 6]: น้ำหนักคะแนนสูงสุดของแต่ละปัจจัย */
  weights: {
    cancel: 20,       // ยกเลิกหมาก
    repeatClick: 15,  // คลิกตัวเดิมซ้ำ
    timePressure: 25, // เวลานาฬิกาเหลือน้อย
    thinkTimeMax: 50, // คิดนานสะสม
    evalTrend: 15,    // สถานการณ์เสียเปรียบ
    instaMove: 30,    // แต้มดีดเมื่อสะดุ้งเดินเร็วหลังเกิดวิกฤต
  },
} as const;

export class PanicCalculator {
  private previousEmaScore: number = 0;
  private postMoveResidualStress: number = 0; // ความเครียดที่ยกยอดมาจากตาที่แล้ว
  private previousThinkTimeMs: number = 0;
  private isInitialized: boolean = false;

  public calculate(input: PanicCalculationInput): PanicCalculationResult {
    const { telemetry, clockRemainingMs, baseTimeMs } = input;
    const evalTrend = input.evalTrendLast3Moves ?? 0;
    const currentThinkMs = input.thinkTimeMs ?? 0;
    const thinkSeconds = currentThinkMs / 1000;

    // ------------------------------------------------------------------------
    // ตรวจจับการเปลี่ยนตาเดิน (Turn Transition Detection)
    // ------------------------------------------------------------------------
    if (this.isInitialized && currentThinkMs < this.previousThinkTimeMs - 500) {
      // ยกยอดความลนจากตาที่แล้วมาเป็นฐานความเครียดตกค้าง
      this.postMoveResidualStress = this.previousEmaScore * PANIC_CONFIG.postMoveRetentionBase;
    }
    this.previousThinkTimeMs = currentThinkMs;

    // ------------------------------------------------------------------------
    // ตรวจจับ Insta-Move Panic Reflex (สะดุ้งเดินเร็ว < 1.5s หลังเพิ่งโดนบุก/โดนกิน)
    // ------------------------------------------------------------------------
    const isVulnerableSituation =
      Boolean(input.isAfterBlunder) ||
      Boolean(input.isCheck) ||
      evalTrend <= -100 ||
      this.previousEmaScore >= 50;

    const isInstaMove = thinkSeconds > 0 && thinkSeconds < PANIC_CONFIG.instaMoveThresholdSec;
    let instaMoveFactor = 0;

    if (isInstaMove && isVulnerableSituation) {
      // ยิ่งเดินเร็วเท่าไหร่ ยิ่งสะท้อนอาการสติหลุดรีบเดินสวน (Amygdala Hijack)
      const rushIntensity = 1 - thinkSeconds / PANIC_CONFIG.instaMoveThresholdSec;
      instaMoveFactor = clamp(
        Math.round(PANIC_CONFIG.weights.instaMove * rushIntensity),
        10,
        PANIC_CONFIG.weights.instaMove,
      );
    }

    // ------------------------------------------------------------------------
    // คำนวณอัตราการผ่อนคลาย (Physiological Recovery Decay)
    // ------------------------------------------------------------------------
    let sustainedStress = 0;
    if (this.postMoveResidualStress > 0) {
      if (isInstaMove && isVulnerableSituation) {
        // ⚡ สะดุ้งเดินเร็วในวิกฤต: สมองไม่ได้หยุดพักผ่อนคลาย -> คงความเครียดไว้เกือบ 100%
        sustainedStress = this.postMoveResidualStress * 0.95;
      } else if (thinkSeconds < PANIC_CONFIG.mildStressThresholdSec) {
        // 🟢 คิด < 5 วินาที (สภาวะปกติ): ค่อยๆ ผ่อนคลายลงอย่างนุ่มนวล
        const relaxationRatio = thinkSeconds / PANIC_CONFIG.mildStressThresholdSec;
        const decayMultiplier = 1.0 - relaxationRatio * 0.35;
        sustainedStress = this.postMoveResidualStress * decayMultiplier;
      } else if (thinkSeconds < PANIC_CONFIG.heavyStressThresholdSec) {
        // 🟡 คิด 5 - 10 วินาที: มี Cognitive Strain ปานกลาง -> ชะลอการลด (ล็อกไว้ที่ ~70%)
        sustainedStress = this.postMoveResidualStress * 0.70;
      } else {
        // 🔴 คิด > 10 วินาที: สมองคำนวณหนักต่อเนื่อง -> ล็อกความเครียดตกค้างไว้สูง (90%) ไม่ยอมให้ลด
        sustainedStress = this.postMoveResidualStress * 0.90;
      }
    }

    // ------------------------------------------------------------------------
    // ปัจจัยพฤติกรรมสดในตานี้ (Instant Factors)
    // ------------------------------------------------------------------------
    // ยกเลิกการเลือกหมาก (น้ำหนัก 20)
    const cancelFactor = PANIC_CONFIG.weights.cancel * clamp01(telemetry.selectionCancelCount / 4);

    // คลิกตัวเดิมซ้ำๆ บ่งบอกความลังเล (น้ำหนัก 15)
    const repeatClickFactor = PANIC_CONFIG.weights.repeatClick * clamp01(telemetry.repeatClickSamePiece / 3);

    // เวลาบนนาฬิกาใกล้หมด (น้ำหนัก 25 เมื่อเหลือ < 25% ของเวลาเริ่ม)
    const timeThresholdMs = baseTimeMs * 0.25;
    let timePressureFactor = 0;
    if (timeThresholdMs > 0 && clockRemainingMs < timeThresholdMs) {
      timePressureFactor = PANIC_CONFIG.weights.timePressure * clamp01(1 - clockRemainingMs / timeThresholdMs);
    }

    // เวลาคิดในตานี้ (Think Time Escalation)
    let thinkTimeFactor = 0;
    if (thinkSeconds >= PANIC_CONFIG.mildStressThresholdSec) {
      const excessSeconds = thinkSeconds - PANIC_CONFIG.mildStressThresholdSec;
      const rate = thinkSeconds >= PANIC_CONFIG.heavyStressThresholdSec ? 2.5 : 1.5;
      thinkTimeFactor = clamp(Math.round(excessSeconds * rate), 0, PANIC_CONFIG.weights.thinkTimeMax);
    }

    // แต้มสถานการณ์กำลังเสียเปรียบ (น้ำหนัก 15)
    const evalTrendFactor = PANIC_CONFIG.weights.evalTrend * clamp01(-evalTrend / 200);

    // รวมคะแนนสดที่เกิดขึ้นในตานี้ (บวกแต้มสะดุ้งเดินเร็วเข้าไปด้วย)
    const instantScore =
      cancelFactor +
      repeatClickFactor +
      timePressureFactor +
      thinkTimeFactor +
      evalTrendFactor +
      instaMoveFactor;

    // ------------------------------------------------------------------------
    // รวมคะแนนสดเข้ากับความเครียดตกค้าง (Carryover Synthesis)
    // ------------------------------------------------------------------------
    const rawScore = clamp(Math.round(Math.max(instantScore, sustainedStress)), 0, 100);

    // เกลี่ยด้วย EMA Smoothing เพื่อให้เข็มหมุนนุ่มนวล
    const smoothedScore = this.isInitialized
      ? PANIC_CONFIG.emaAlpha * rawScore + (1 - PANIC_CONFIG.emaAlpha) * this.previousEmaScore
      : rawScore;

    const finalPanicScore = Math.round(clamp(smoothedScore, 0, 100));
    const panicDelta = this.isInitialized ? finalPanicScore - this.previousEmaScore : 0;

    this.previousEmaScore = finalPanicScore;
    this.isInitialized = true;

    const confidenceProxy = Number((1 - finalPanicScore / 100).toFixed(2));

    // ------------------------------------------------------------------------
    // ตรวจจับ Trigger Flags (รวม Flags ทางจิตวิทยา)
    // ------------------------------------------------------------------------
    const triggerFlags: PanicTriggerFlag[] = [];
    if (clockRemainingMs <= 30_000) triggerFlags.push('low_clock');
    if (timePressureFactor >= 18) triggerFlags.push('time_scramble');
    if (telemetry.selectionCancelCount >= 3) triggerFlags.push('repeated_indecision');
    if (thinkSeconds >= 20 || finalPanicScore >= 55) triggerFlags.push('high_hesitation');
    if (evalTrendFactor >= 10) triggerFlags.push('eval_collapse');
    if (input.isAfterBlunder) triggerFlags.push('after_blunder');
    if (instaMoveFactor >= 12) triggerFlags.push('panic_insta_move'); // 👈 ติดธงสะดุ้งเดินเร็ว

    // ติดธง Tunnel Vision เมื่อมีความลังเลวนเวียนร่วมกับความลนระดับสูง
    if (
      (telemetry.selectionCancelCount >= 3 || telemetry.repeatClickSamePiece >= 2) &&
      finalPanicScore >= 55
    ) {
      triggerFlags.push('tunnel_vision'); // 👈 ติดธงมองแคบ
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