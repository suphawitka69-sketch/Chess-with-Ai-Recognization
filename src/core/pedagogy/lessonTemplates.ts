/**
 * lessonTemplates.ts
 * ---------------------------------------------------------------------------
 * Fallback แบบ rule-based เมื่อ LLM ใช้งานไม่ได้ (ออฟไลน์/หมดโควตา/error) —
 * คืนค่าโครงสร้างเดียวกับ ExplanationResponse ที่ PromptBuilder.ts นิยามไว้
 * เป๊ะๆ เพื่อให้ LessonPanel render ได้แบบเดียวกันไม่ว่าคำตอบจะมาจาก LLM
 * จริงหรือ fallback นี้
 *
 * `detectRootCause()` **ไม่คำนวณ heuristic ซับซ้อนเอง** (เช่น "เปิดเส้นทาง
 * ให้คู่ต่อสู้" หรือ "พลาดการตรึง") เพราะสิ่งเหล่านี้ต้องการวิเคราะห์ตำแหน่ง
 * กระดานเชิงลึกที่ไม่ควรทำในไฟล์ template — รับเป็น `RootCauseSignals` ที่
 * ผู้เรียก (เช่น GameAnalyzer หรือ tactical motif detector ในอนาคต) คำนวณ
 * มาให้แล้ว ไฟล์นี้มีหน้าที่แค่ "ตัดสินใจว่าเข้าเกณฑ์ไหนก่อน" (priority
 * ordering) และ "render เป็นข้อความ" เท่านั้น
 *
 * --- หมวด Systems Thinking Fallback (Cognitive Bias) ---
 * `buildCognitiveBiasExplanation()` เป็น fallback อีกเส้นทางหนึ่ง แยกจาก
 * `detectRootCause`/`buildFallbackExplanation` เดิมโดยสิ้นเชิง — ใช้เมื่อ
 * CognitiveBiasDetector.ts ตรวจพบ Tunnel Vision / Reactive Fixation
 * (diagnosis.isTriggered === true) โดยยึดกรอบการสอน 4 ขั้นตอนตามโจทย์:
 * (1) สะท้อนภาพ (Mirroring) → (2) ชี้หลุมพรางเฉพาะหน้า (Exposing Band-aid)
 * → (3) สอนคิดการไหล (Systems Thinking & Flow) → (4) กฎเหล็กติดตัว
 * (Actionable Mental Model) — ผลลัพธ์ยัง map เข้า ExplanationResponse
 * (สัญญาเดียวกับ PromptBuilder.ts) เพื่อให้ LessonPanel render ได้แบบเดียวกัน
 * ---------------------------------------------------------------------------
 */

import type { ExplanationResponse } from './PromptBuilder';
import { formatMsAsSeconds, formatPercent } from './PromptBuilder';
import type { CognitiveDiagnosis, CognitiveBiasType } from '../analysis/CognitiveBiasDetector';

// ============================================================================
// Root cause types
// ============================================================================

export type LessonRootCause =
  | 'greed_pawn_grab'
  | 'back_rank_weakness'
  | 'time_trouble_panic'
  | 'hanging_piece'
  | 'missed_tactic_fork_pin';

/**
 * สัญญาณดิบที่ใช้ตัดสินใจว่าตาที่พลาดนี้เข้าข่าย root cause ไหน — ทุก field
 * ต้องถูกคำนวณมาจากภายนอกไฟล์นี้ (ดูคำอธิบายต้นไฟล์) ปล่อยเป็น `null`/`false`
 * ได้ถ้าไม่ทราบหรือคำนวณไม่ได้ — detectRootCause() จะข้ามเกณฑ์นั้นไปเฉยๆ
 */
export interface RootCauseSignals {
  readonly wasPawnCapture: boolean;
  /** เดินตานี้แล้วทำให้คู่ต่อสู้เปิดเส้นทาง/แนวรุกได้มากขึ้นอย่างมีนัยสำคัญ (ผู้เรียกคำนวณเอง เช่นเทียบ mobility ก่อน/หลัง) */
  readonly openedOpponentLines: boolean;
  readonly kingNeverCastled: boolean;
  /** แถวสุดท้ายของฝ่ายตัวเองไม่มีเบี้ยกันช่องให้คิงหนี (luft) */
  readonly backRankOpen: boolean;
  /** 0-1 จาก Clock.getRemainingMsFor()/baseMs */
  readonly clockPressureRatio: number;
  /** มูลค่าหมาก (หน่วย pawn เทียบเท่า เช่น Q=9, R=5) ที่ถูกกินฟรีในตานี้ — null ถ้าไม่มีหมากถูกกินฟรี */
  readonly hungPieceValue: number | null;
  readonly missedForkOrPin: boolean;
}

const TIME_TROUBLE_THRESHOLD = 0.85;

/**
 * ตัดสินใจว่า root cause ไหน "เด่นที่สุด" จากสัญญาณที่มี — เรียงลำดับความสำคัญ
 * ไว้ตายตัว (เวลาจวนตัวมาก่อนเสมอ เพราะมักเป็นสาเหตุร่วมของความผิดพลาดอื่นๆ
 * ด้วย) คืน `null` ถ้าไม่เข้าเกณฑ์ไหนชัดเจน — ผู้เรียกควรใช้
 * `buildGenericFallbackExplanation()` แทนในกรณีนั้น
 */
export function detectRootCause(signals: RootCauseSignals): LessonRootCause | null {
  if (signals.clockPressureRatio >= TIME_TROUBLE_THRESHOLD) return 'time_trouble_panic';
  if (signals.hungPieceValue !== null && signals.hungPieceValue > 0) return 'hanging_piece';
  if (signals.missedForkOrPin) return 'missed_tactic_fork_pin';
  if (signals.backRankOpen && signals.kingNeverCastled) return 'back_rank_weakness';
  if (signals.wasPawnCapture && signals.openedOpponentLines) return 'greed_pawn_grab';
  return null;
}

// ============================================================================
// Template context
// ============================================================================

export interface LessonTemplateContext {
  readonly sanPlayed: string;
  readonly bestMoveSan: string;
  readonly centipawnLoss: number;
  /** 0-1 */
  readonly winProbDrop: number;
  /** 0-100 */
  readonly panicScore: number;
  readonly thinkTimeMs: number;
  readonly averageThinkTimeMs: number;
  readonly clockRemainingMs: number;
  readonly openingName: string | null;
  /** ใช้เฉพาะ hanging_piece template — มูลค่าหมากที่เสียไปเป็นหน่วย pawn เทียบเท่า */
  readonly hungPieceValue?: number;
}

// ============================================================================
// Public API — root-cause fallback (เดิม)
// ============================================================================

export function buildFallbackExplanation(rootCause: LessonRootCause | null, context: LessonTemplateContext): ExplanationResponse {
  switch (rootCause) {
    case 'greed_pawn_grab':
      return greedPawnGrabTemplate(context);
    case 'back_rank_weakness':
      return backRankWeaknessTemplate(context);
    case 'time_trouble_panic':
      return timeTroublePanicTemplate(context);
    case 'hanging_piece':
      return hangingPieceTemplate(context);
    case 'missed_tactic_fork_pin':
      return missedTacticTemplate(context);
    case null:
      return genericTemplate(context);
    default:
      return genericTemplate(context);
  }
}

// ============================================================================
// Templates — root cause เฉพาะทาง
// ============================================================================

function greedPawnGrabTemplate(ctx: LessonTemplateContext): ExplanationResponse {
  return {
    whatHappened: `คุณเดิน ${ctx.sanPlayed} เพื่อกินเบี้ยที่คู่ต่อสู้ปล่อยไว้ แต่การกินครั้งนี้ทำให้ตำแหน่งของคุณเสียเปรียบขึ้นถึง ${formatCpLoss(ctx.centipawnLoss)} (win probability ลดลงประมาณ ${formatPercent(ctx.winProbDrop)})`,
    whyYouPlayedThatMove: `เบี้ยที่ปล่อยไว้เป็นเป้าที่ล่อตาได้ง่าย และการกินได้วัสดุเพิ่มมักรู้สึกเป็นทางเลือกที่ปลอดภัยในทันที — แต่ในตำแหน่งนี้มันเป็นกับดัก การกินเบี้ยใช้เวลาไปกับการเคลื่อนหมากที่ไม่ช่วยพัฒนาตำแหน่ง ทำให้คู่ต่อสู้ได้จังหวะเปิดเส้นทางโจมตีฟรีๆ`,
    whyOpponentPlayedThatMove: `คู่ต่อสู้ตั้งใจปล่อยเบี้ยตัวนี้ไว้เป็นเหยื่อล่อ (poisoned pawn) เพื่อดึงหมากของคุณออกจากตำแหน่งที่ดี หรือเปิดเส้นทาง/แนวทแยงให้หมากตัวอื่นของเขาทำงานได้เต็มที่`,
    correctMove: `ตาที่ดีกว่าคือ ${ctx.bestMoveSan} ซึ่งเน้นพัฒนาตำแหน่ง/ความปลอดภัยของคิงต่อไปแทนที่จะไปเก็บเบี้ยที่มีเงื่อนงำ — วัสดุหนึ่งเบี้ยไม่คุ้มกับการเสียเทมโปหรือเปิดช่องให้คู่ต่อสู้โจมตี`,
    lessonPrinciple: 'ก่อนกินหมากที่ดูเหมือนฟรี ให้ถามตัวเองเสมอว่า "ทำไมเขาถึงปล่อยมันไว้" — เบี้ย/หมากที่ดูไม่มีใครป้องกันในตำแหน่งที่ซับซ้อน มักเป็นกับดักมากกว่าของแถม โดยเฉพาะถ้าการกินนั้นทำให้คุณต้องขยับหมากออกจากตำแหน่งที่ดีหรือล่าช้าในการพัฒนาตัวหมาก',
  };
}

function backRankWeaknessTemplate(ctx: LessonTemplateContext): ExplanationResponse {
  return {
    whatHappened: `คิงของคุณติดอยู่ที่แถวหลังโดยไม่มีช่องให้หนี (luft) และตา ${ctx.sanPlayed} ไม่ได้แก้ปัญหานี้ ทำให้เสียเปรียบ ${formatCpLoss(ctx.centipawnLoss)}`,
    whyYouPlayedThatMove: `จุดสนใจของคุณอยู่ที่ส่วนอื่นของกระดาน (เช่นการโจมตีหรือพัฒนาหมาก) จนมองข้ามว่าแถวหลังของตัวเองไม่มีช่องให้คิงหนีเลยสักช่อง — เป็นเรื่องปกติที่จะมองข้ามจุดอ่อนที่ "อยู่หลังบ้าน" เพราะความสนใจส่วนใหญ่มักอยู่ที่แนวรุก`,
    whyOpponentPlayedThatMove: 'คู่ต่อสู้มองเห็นว่าแถวหลังของคุณอ่อนแอและวางแผนใช้หมากหนัก (เรือ/ควีน) แทรกเข้าไปตามแถวหรือแนวทแยงที่เปิดอยู่ เพื่อสร้างภัยคุกคามรุกฆาตหรือบังคับให้คุณเสียวัสดุเพื่อป้องกัน',
    correctMove: `ตาที่ควรเล่นคือ ${ctx.bestMoveSan} ซึ่งช่วยเปิดช่องหนีให้คิง (เช่นเดินเบี้ยหน้าคิงไปหนึ่งช่อง) ก่อนที่จะไปทำอย่างอื่นต่อ — ความปลอดภัยของคิงมาก่อนแผนการรุกเสมอ`,
    lessonPrinciple: 'เมื่อคุณ castle แล้ว ให้ถามตัวเองอยู่เสมอว่าคิงมีช่องหนีไหมถ้าโดนรุกที่แถวหลัง (โดยเฉพาะเมื่อฝ่ายตรงข้ามยังมีเรือหรือควีนอยู่ในกระดาน) การเสียเทมโปหนึ่งตาเพื่อเปิด luft มักคุ้มค่ากว่าการเสี่ยงโดนรุกฆาตแถวหลังในภายหลังมาก',
  };
}

function timeTroublePanicTemplate(ctx: LessonTemplateContext): ExplanationResponse {
  return {
    whatHappened: `คุณเดิน ${ctx.sanPlayed} ในสภาวะที่นาฬิกาเหลือเพียง ${formatMsAsSeconds(ctx.clockRemainingMs)} ทำให้เสียเปรียบ ${formatCpLoss(ctx.centipawnLoss)}`,
    whyYouPlayedThatMove: `คุณใช้เวลาคิดตานี้แค่ ${formatMsAsSeconds(ctx.thinkTimeMs)} ทั้งที่เวลาเฉลี่ยปกติของคุณคือ ${formatMsAsSeconds(ctx.averageThinkTimeMs)} และ panic score ของตานี้สูงถึง ${Math.round(ctx.panicScore)}/100 — สัญญาณเหล่านี้บ่งชี้ชัดเจนว่าคุณตัดสินใจภายใต้ความกดดันด้านเวลา ไม่ได้คิดวิเคราะห์ตำแหน่งอย่างเต็มที่`,
    whyOpponentPlayedThatMove: 'คู่ต่อสู้เดินตามแผนปกติของเขาต่อไป โดยอาศัยจังหวะที่นาฬิกาของคุณกำลังกดดันคุณอยู่ — ในสถานการณ์เวลาน้อย ฝ่ายตรงข้ามมักเลือกเดินตาที่ทำให้ตำแหน่งซับซ้อนขึ้นเพื่อเพิ่มโอกาสที่คุณจะพลาดภายใต้แรงกดดัน',
    correctMove: `ถ้ามีเวลาคิดมากกว่านี้ ตาที่ดีกว่าคือ ${ctx.bestMoveSan} — แต่บทเรียนสำคัญกว่าตาเดียวนี้คือการบริหารเวลาโดยรวมของทั้งเกม`,
    lessonPrinciple: 'เมื่อนาฬิกาเหลือน้อย ให้เล่นตาที่ปลอดภัยและตรงไปตรงมาที่สุดเท่าที่จะทำได้ แทนที่จะพยายามหาตาที่ดีที่สุดในเชิงทฤษฎี — ความเร็วในการตัดสินใจที่ "ดีพอ" มีค่ามากกว่าความสมบูรณ์แบบเมื่อเวลาใกล้หมด และควรฝึกจัดสรรเวลาให้เหลือ buffer สำหรับช่วงท้ายเกมไว้ล่วงหน้า',
  };
}

function hangingPieceTemplate(ctx: LessonTemplateContext): ExplanationResponse {
  const pieceValueText = ctx.hungPieceValue !== undefined ? `(มูลค่าประมาณ ${ctx.hungPieceValue} แต้ม)` : '';
  return {
    whatHappened: `ตา ${ctx.sanPlayed} ปล่อยให้หมากของคุณอยู่ในตำแหน่งที่ถูกกินได้ฟรีโดยไม่มีการป้องกัน ${pieceValueText} ทำให้เสียเปรียบ ${formatCpLoss(ctx.centipawnLoss)}`,
    whyYouPlayedThatMove: 'มีความเป็นไปได้สูงว่าคุณโฟกัสอยู่กับแผนการในส่วนอื่นของกระดาน จนลืมตรวจสอบว่าหมากตัวนี้ยังมีตัวคุ้มอยู่หรือไม่หลังจากเดินตานี้ — การลืมเช็ค "ตาคุม" เป็นสาเหตุการเสียหมากฟรีที่พบบ่อยที่สุดในทุกระดับฝีมือ',
    whyOpponentPlayedThatMove: 'คู่ต่อสู้เพียงแค่เก็บหมากที่ไม่มีการป้องกันไว้ตามปกติ ไม่จำเป็นต้องมีแผนซับซ้อนอะไร — นี่คือเหตุผลที่การตรวจสอบตาคุมก่อนเดินทุกครั้งสำคัญมาก เพราะฝ่ายตรงข้ามแทบไม่ต้องคิดอะไรเลยเพื่อได้ประโยชน์',
    correctMove: `ตาที่ควรเล่นคือ ${ctx.bestMoveSan} ซึ่งรักษาหมากทุกตัวให้อยู่ในตำแหน่งที่ปลอดภัยหรือมีตัวคุ้มเพียงพอ`,
    lessonPrinciple: 'ก่อนเดินทุกตา ให้ตรวจสอบเสมอว่า: (1) หมากที่กำลังจะขยับ กำลังทิ้งช่องที่เคยคุมอยู่หรือไม่ (2) หมากตัวอื่นที่เหลืออยู่ยังมีตัวป้องกันเพียงพอหรือไม่ การฝึกเช็คสองข้อนี้เป็นนิสัยจะช่วยลดการเสียหมากฟรีได้อย่างมาก',
  };
}

function missedTacticTemplate(ctx: LessonTemplateContext): ExplanationResponse {
  return {
    whatHappened: `ในตำแหน่งนี้มีโอกาสทำสองทาง (fork) หรือตรึงหมาก (pin) ที่ได้เปรียบชัดเจน แต่ตา ${ctx.sanPlayed} พลาดโอกาสนั้นไป เสียเปรียบไป ${formatCpLoss(ctx.centipawnLoss)} เมื่อเทียบกับตาที่ดีที่สุด`,
    whyYouPlayedThatMove: 'การมองเห็น fork/pin ต้องอาศัยการตรวจสอบว่าหมากของคู่ต่อสู้สองตัวขึ้นไปอยู่ในแนวเดียวกัน (แนวตรง/แนวทแยง สำหรับ pin) หรือมีจุดที่หมากตัวเดียวโจมตีได้พร้อมกันสองเป้าหมาย (สำหรับ fork) — ถ้าไม่ได้ตรวจสอบมุมมองนี้อย่างเป็นระบบ โอกาสแบบนี้มักถูกมองข้ามได้ง่าย',
    whyOpponentPlayedThatMove: 'คู่ต่อสู้เดินตามแผนของเขาโดยไม่รู้ตัวหรือยอมรับความเสี่ยงว่าตำแหน่งหมากของเขาเปิดช่องให้เกิด fork/pin ได้ — ถ้าคุณเล่นตาที่ถูกต้อง เขาจะต้องเสียวัสดุหรือคุณภาพตำแหน่งเพื่อแก้ไขสถานการณ์นี้',
    correctMove: `ตาที่ถูกต้องคือ ${ctx.bestMoveSan} ซึ่งใช้ประโยชน์จากตำแหน่งหมากของคู่ต่อสู้ที่เปิดช่องให้ทำสองทางหรือตรึงได้`,
    lessonPrinciple: 'ฝึกนิสัยสแกนกระดานหาแนวตรง/แนวทแยง/ตัว L ของม้าที่โจมตีได้สองเป้าหมายพร้อมกันทุกตาที่คุณคิด โดยเฉพาะเมื่อหมากของคู่ต่อสู้ (คิง, ควีน, เรือ) อยู่ในแนวเดียวกัน — ยุทธวิธีเหล่านี้มักเป็นตาที่เปลี่ยนผลของเกมได้มากที่สุด',
  };
}

// ============================================================================
// Generic fallback (ไม่เข้าเกณฑ์ root cause เฉพาะทางไหนชัดเจน)
// ============================================================================

function genericTemplate(ctx: LessonTemplateContext): ExplanationResponse {
  return {
    whatHappened: `ตา ${ctx.sanPlayed} ทำให้ตำแหน่งของคุณแย่ลง ${formatCpLoss(ctx.centipawnLoss)} เมื่อเทียบกับตาที่ดีที่สุดในตำแหน่งนี้`,
    whyYouPlayedThatMove: buildGenericWhyText(ctx),
    whyOpponentPlayedThatMove: 'คู่ต่อสู้เดินตามแผนที่ได้ประโยชน์จากจุดอ่อนที่เกิดขึ้นในตำแหน่งของคุณหลังจากตานี้',
    correctMove: `ตาที่ดีกว่าคือ ${ctx.bestMoveSan} — ลองเปรียบเทียบดูว่าตานี้ต่างจากที่คุณเล่นอย่างไร และตำแหน่งหลังจากนั้นเปลี่ยนไปแบบไหน`,
    lessonPrinciple: 'ทุกครั้งที่เจอตาที่ engine ประเมินว่าแย่กว่าที่ควร ให้ลองย้อนกลับไปดูว่ามีทางเลือกอื่นที่คุณไม่ได้พิจารณาหรือไม่ — การทบทวนแบบนี้สม่ำเสมอจะช่วยขยายมุมมองการมองกระดานของคุณในระยะยาว',
  };
}

function buildGenericWhyText(ctx: LessonTemplateContext): string {
  if (ctx.panicScore >= 60) {
    return `Panic score ของตานี้อยู่ที่ ${Math.round(ctx.panicScore)}/100 ซึ่งค่อนข้างสูง อาจมีความรีบร้อนหรือความกดดันบางอย่างที่ทำให้ตัดสินใจได้ไม่เต็มที่`;
  }
  return 'ไม่มีสัญญาณพฤติกรรมที่ชัดเจนว่ามีความรีบร้อนหรือกดดันเป็นพิเศษ — ตานี้น่าจะเป็นการมองข้ามรายละเอียดทางยุทธวิธีหรือกลยุทธ์ของตำแหน่งมากกว่า';
}

// ============================================================================
// Public API — Systems Thinking Fallback (ใหม่ สำหรับ CognitiveDiagnosis)
// ============================================================================

const BIAS_LABEL_TH: Record<CognitiveBiasType, string> = {
  SPATIAL_TUNNELING: 'การจดจ่อแคบเฉพาะปีกเดียว (Spatial Tunneling)',
  REACTIVE_BAND_AID: 'การแก้ปัญหาเฉพาะหน้าแบบดับเพลิง (Reactive Band-aid)',
  PANIC_INSTA_MOVE: 'การเดินสวนทันทีเพราะตกใจ (Panic Insta-move)',
  TIME_ASYMMETRY_COLLAPSE: 'ภาวะเวลาคิดล่มหลังค้างนานผิดปกติ (Time Asymmetry Collapse)',
  TARGET_BLINDNESS: 'อาการตาบอดต่อเป้าหมายอื่น (Target Blindness)',
};

/**
 * สร้างคำอธิบายแบบ fallback ตามกรอบการสอน 4 ขั้นตอน (Systems Thinking) เมื่อ
 * `CognitiveBiasDetector` ตรวจพบว่า diagnosis.isTriggered === true — ใช้แทน
 * `buildFallbackExplanation()` เดิม (root-cause ทาง engine eval) ในกรณีที่
 * สาเหตุหลักมาจากพฤติกรรม/จิตวิทยา ไม่ใช่เนื้อหาทางยุทธวิธีล้วนๆ
 *
 * Mapping เข้า ExplanationResponse (สัญญาเดียวกับ PromptBuilder.ts):
 * - whatHappened            → (1) สะท้อนภาพ (Mirroring) + หลักฐานพฤติกรรม
 * - whyYouPlayedThatMove    → ขยายความ Mirroring ด้วย problemPattern
 * - whyOpponentPlayedThatMove → overlookedReality (สิ่งที่กระดานเป็นจริง)
 * - correctMove             → (2) ชี้หลุมพรางเฉพาะหน้า (Exposing Band-aid)
 * - lessonPrinciple         → (3)+(4) สอนคิดการไหล + กฎเหล็กติดตัว
 *
 * คืนค่า `null` ถ้า diagnosis ไม่ได้ triggered — ผู้เรียกควรตกไปใช้
 * `buildFallbackExplanation()` เส้นทางเดิมแทน
 */
export function buildCognitiveBiasExplanation(diagnosis: CognitiveDiagnosis): ExplanationResponse | null {
  if (!diagnosis.isTriggered || !diagnosis.primaryBias || !diagnosis.systemicLesson) {
    return null;
  }

  const biasLabel = BIAS_LABEL_TH[diagnosis.primaryBias];
  const evidenceText =
    diagnosis.behavioralEvidence.length > 0
      ? diagnosis.behavioralEvidence.join(' และ ')
      : 'พฤติกรรมระหว่างคิดตานี้ผิดปกติไปจากรูปแบบปกติของคุณ';

  // (1) Mirroring — สะท้อนหลักฐานพฤติกรรมตรงๆ ให้ผู้เล่นเห็นภาพตัวเอง
  const mirroring = `สัญญาณพฤติกรรมของคุณในตานี้บ่งชี้ ${biasLabel}: ${evidenceText} (ดัชนี Tunnel Vision อยู่ที่ ${Math.round(diagnosis.tunnelVisionIndex)}/100)`;

  const whyYouPlayedThatMove = `${mirroring} — สิ่งที่คุณโฟกัสอยู่ตรงหน้าคือ: ${diagnosis.systemicLesson.problemPattern}`;

  // (2) Exposing the band-aid — ชี้ว่าการแก้ปัญหาเฉพาะหน้านี้สร้างปัญหาใหม่อย่างไร
  const correctMove = `การตัดสินใจแบบนี้แก้ปัญหาได้แค่เฉพาะหน้า แต่ในความเป็นจริงบนกระดานคือ: ${diagnosis.systemicLesson.overlookedReality} ลองย้อนกลับไปดูตำแหน่งก่อนเดิน แล้วถามตัวเองว่ามีทางที่ป้องกันไว้ล่วงหน้าโดยไม่ต้องแก้ขัดแบบนี้หรือไม่`;

  // (3)+(4) Systems thinking & flow + กฎเหล็กติดตัว
  const lessonPrinciple = `แทนที่จะดับเพลิงเฉพาะจุด ให้คิดแบบสร้างระบบกันไฟ (Prophylaxis): ${diagnosis.systemicLesson.flowPrinciple} กฎเหล็กที่ควรถามตัวเองทุกตา: "การแก้ปัญหานี้ กำลังสร้างปัญหาใหม่ที่ใหญ่กว่าในอนาคตหรือไม่?"`;

  return {
    whatHappened: mirroring,
    whyYouPlayedThatMove,
    whyOpponentPlayedThatMove: diagnosis.systemicLesson.overlookedReality,
    correctMove,
    lessonPrinciple,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function formatCpLoss(centipawnLoss: number): string {
  return `${(centipawnLoss / 100).toFixed(2)} แต้ม`;
}