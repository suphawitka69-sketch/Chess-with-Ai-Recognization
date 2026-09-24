/**
 * PromptBuilder.ts
 * ---------------------------------------------------------------------------
 * ประกอบข้อมูลจากหลายแหล่ง (GameEngine, classifier, telemetry, Clock,
 * OpeningBook, CognitiveBiasDetector) ให้เป็น prompt เดียวที่พร้อมส่งให้ LLM
 * เพื่อขอคำอธิบายภาษาไทยแบบครูสอนจริง — ไฟล์นี้เป็นแค่ "ตัวประกอบ"
 * (formatter/composer) ไม่คำนวณอะไรเอง ทุก field ใน input ต้องถูกคำนวณมา
 * ก่อนแล้วจากโมดูลที่ถูกต้อง (classifyMove สำหรับ eval, MoveTelemetryTracker
 * สำหรับพฤติกรรม, detectCognitiveBiases สำหรับ tunnel vision ฯลฯ) — การแยก
 * แบบนี้ทำให้ทดสอบ PromptBuilder ได้ด้วย mock data ล้วนๆ โดยไม่ต้องพึ่ง
 * engine/telemetry จริงเลย
 *
 * `ExplanationResponse` (โครงสร้าง 5 ส่วน) ที่ประกาศไว้ในไฟล์นี้คือ "สัญญา"
 * ร่วมกันระหว่าง PromptBuilder (ฝั่งขอ) กับทั้ง LLM จริง (ฝั่งตอบ ผ่าน system
 * prompt ที่บังคับ JSON shape นี้) และ lessonTemplates.ts (fallback ฝั่งตอบ
 * เมื่อ LLM ใช้งานไม่ได้) — สาม parties นี้ต้องคืนรูปร่างเดียวกันเป๊ะ เพื่อให้
 * UI (LessonPanel) render ได้แบบเดียวกันไม่ว่าคำตอบจะมาจากทางไหน
 *
 * --- Cognitive Diagnosis Integration ---
 * เมื่อ `params.cognitiveDiagnosis` ถูกส่งเข้ามาและ `isTriggered === true`
 * PromptBuilder จะ: (1) สลับ persona ของ system prompt ให้ LLM สวมบทบาทเป็น
 * "โค้ชจิตวิทยาและสถาปนิกความคิด (Cognitive & Systems Coach)" แทน persona
 * ปกติ และ (2) ผนวกส่วน "## การวินิจฉัยเชิงพฤติกรรม (Cognitive Diagnosis)"
 * เข้าไปใน user prompt เพื่อให้ LLM ใช้เป็นหลักฐานอ้างอิงเจาะลึกเรื่อง
 * mindset/systems thinking แทนที่จะอธิบายแค่ตาเดินเฉยๆ
 * ---------------------------------------------------------------------------
 */

import type { PieceColor } from '../chess/GameEngine';
import type { MoveClassification } from '../analysis/classifier';
import type { UciScore } from '../engine/UciProtocol';
import type { CognitiveDiagnosis } from '../analysis/CognitiveBiasDetector';

// ============================================================================
// Response contract — ใช้ร่วมกันระหว่าง LLM จริงและ lessonTemplates.ts (fallback)
// ============================================================================

export interface ExplanationResponse {
  /** (1) เกิดอะไรขึ้นบนกระดาน */
  readonly whatHappened: string;
  /** (2) ทำไมคุณถึงเดินแบบนั้น — ควรอ้างอิงข้อมูลพฤติกรรม/ความลนถ้ามีนัยสำคัญ */
  readonly whyYouPlayedThatMove: string;
  /** (3) ทำไมคู่ต่อสู้ถึงเดินแบบนั้น / เขาเล็งอะไรอยู่ */
  readonly whyOpponentPlayedThatMove: string;
  /** (4) ตาที่ถูกต้องคืออะไร และทำไมถึงดีกว่า */
  readonly correctMove: string;
  /** (5) บทเรียน/หลักการหมากรุกที่ต้องจำไปใช้ */
  readonly lessonPrinciple: string;
}

/** ชื่อ key ทั้ง 5 ของ ExplanationResponse ตามลำดับ — export ไว้ให้ทั้ง system prompt และผู้ parse response ฝั่ง caller ใช้ชุดเดียวกัน กันสะกดพลาดไม่ตรงกัน */
export const EXPLANATION_RESPONSE_KEYS = [
  'whatHappened',
  'whyYouPlayedThatMove',
  'whyOpponentPlayedThatMove',
  'correctMove',
  'lessonPrinciple',
] as const satisfies readonly (keyof ExplanationResponse)[];

// ============================================================================
// Input types
// ============================================================================

export interface MoveContext {
  readonly color: PieceColor;
  readonly ply: number;
  readonly fenBefore: string;
  readonly fenAfter: string;
  readonly sanPlayed: string;
  readonly uciPlayed: string;
}

export interface AlternativeLine {
  readonly san: string;
  readonly uci: string;
  readonly eval: UciScore;
  /** คำอธิบายสั้นๆ ว่าทางเลือกนี้ดี/แย่อย่างไร ถ้ามี — PromptBuilder ไม่ generate เอง รับมาจากผู้เรียกเท่านั้น */
  readonly note?: string;
}

export interface EngineAnalysisContext {
  readonly classification: MoveClassification;
  readonly centipawnLoss: number;
  /** 0-1 ตรงตาม output ของ classifyMove — PromptBuilder แปลงเป็น % ให้เองตอน format */
  readonly winProbBefore: number;
  readonly winProbAfter: number;
  readonly bestMoveSan: string;
  readonly bestMoveUci: string;
  readonly bestLineEval: UciScore;
  readonly playedMoveEval: UciScore;
  readonly alternatives: readonly AlternativeLine[];
}

export interface BehaviorContext {
  readonly thinkTimeMs: number;
  readonly averageThinkTimeMs: number;
  /** 0-100 — มาจากระบบ panic scoring ภายนอกไฟล์นี้ */
  readonly panicScore: number;
  readonly selectionCancelCount: number;
  /** 0-1 จาก RawMoveTelemetrySnapshot.hesitationIndex */
  readonly hesitationIndex: number;
}

export interface GameSituationContext {
  readonly openingEco: string | null;
  readonly openingName: string | null;
  /** เช่น "10+5" */
  readonly timeControlLabel: string;
  readonly clockRemainingMs: number;
  /** เช่น "Stockfish ระดับมืออาชีพ" หรือชื่อคู่ต่อสู้ */
  readonly opponentLabel: string;
}

export interface BuildExplanationPromptParams {
  readonly move: MoveContext;
  readonly analysis: EngineAnalysisContext;
  readonly behavior: BehaviorContext;
  readonly situation: GameSituationContext;
  /**
   * ผลวินิจฉัย Cognitive Bias จาก `detectCognitiveBiases()` (ถ้ามี) — เมื่อ
   * `isTriggered === true` จะทำให้ system prompt สลับ persona เป็น
   * "โค้ชจิตวิทยาและสถาปนิกความคิด" และผนวกหลักฐานเข้า user prompt
   * ปล่อยเป็น `null`/`undefined` ได้ถ้ายังไม่ได้รัน detector หรือไม่ trigger
   */
  readonly cognitiveDiagnosis?: CognitiveDiagnosis | null;
}

export interface ExplanationPromptPayload {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  /** ไว้ log/debug เท่านั้น — ไม่ได้เป็นส่วนหนึ่งของสิ่งที่ส่งให้ LLM */
  readonly metadata: {
    readonly ply: number;
    readonly classification: MoveClassification;
    readonly cognitiveBiasTriggered: boolean;
  };
}

// ============================================================================
// PromptBuilder
// ============================================================================

export interface PromptBuilderConfig {
  /** ชื่อบุคลิกของโค้ชในโหมดปกติ — ค่าเริ่มต้นเป็นกลางๆ แบบครูใจดีแต่ตรงไปตรงมา */
  readonly coachPersonaLabel?: string;
  /** ชื่อบุคลิกของโค้ชเมื่อ cognitiveDiagnosis.isTriggered === true */
  readonly cognitiveCoachPersonaLabel?: string;
}

export class PromptBuilder {
  private readonly coachPersonaLabel: string;
  private readonly cognitiveCoachPersonaLabel: string;

  constructor(config: PromptBuilderConfig = {}) {
    this.coachPersonaLabel = config.coachPersonaLabel ?? 'โค้ชหมากรุกที่ใจดีแต่ตรงไปตรงมา';
    this.cognitiveCoachPersonaLabel =
      config.cognitiveCoachPersonaLabel ?? 'โค้ชจิตวิทยาและสถาปนิกความคิด (Cognitive & Systems Coach)';
  }

  public buildExplanationPrompt(params: BuildExplanationPromptParams): ExplanationPromptPayload {
    const diagnosis = params.cognitiveDiagnosis ?? null;
    const isCognitiveTriggered = diagnosis?.isTriggered === true;

    return {
      systemPrompt: this.buildSystemPrompt(isCognitiveTriggered),
      userPrompt: buildUserPrompt(params),
      metadata: {
        ply: params.move.ply,
        classification: params.analysis.classification,
        cognitiveBiasTriggered: isCognitiveTriggered,
      },
    };
  }

  private buildSystemPrompt(isCognitiveTriggered: boolean): string {
    const persona = isCognitiveTriggered ? this.cognitiveCoachPersonaLabel : this.coachPersonaLabel;

    const roleDirective = isCognitiveTriggered
      ? 'หน้าที่ของคุณคือเจาะลึกการแก้ไข Mindset ของผู้เล่น ชี้ให้เห็นรูปแบบพฤติกรรมที่นำไปสู่ความผิดพลาด (Tunnel Vision / Amygdala Hijack / Reactive Fixation) และสอนให้เปลี่ยนจากการ "ดับเพลิงเฉพาะจุด" ไปสู่ "การคิดการไหลเชิงโครงสร้าง (Systems Thinking & Prophylaxis)" — เน้นเชื่อมโยงหลักฐานพฤติกรรมที่ให้มาเข้ากับคำอธิบายเสมอ ไม่ใช่อธิบายแค่ตาเดินบนกระดานเพียงอย่างเดียว'
      : 'หน้าที่ของคุณคืออธิบายตาเดินหมากรุกหนึ่งตาให้ผู้เล่นเข้าใจว่าเกิดอะไรขึ้นและควรทำอย่างไรต่อไป';

    const lines = [
      `คุณคือ${persona} ${roleDirective}`,
      '',
      'กฎการตอบ (สำคัญมาก ต้องทำตามทุกข้อ):',
      '1. ตอบเป็นภาษาไทยล้วน ยกเว้นสัญลักษณ์หมากรุกมาตรฐาน (SAN เช่น Nf3, O-O) ที่คงไว้ตามเดิม',
      '2. ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่นใดนอก JSON object ห้ามมี markdown code fence ห้ามมีคำนำหรือคำลงท้าย',
      `3. JSON ต้องมี key ครบทั้ง 5 ตัวนี้เท่านั้น เรียงตามนี้: ${EXPLANATION_RESPONSE_KEYS.join(', ')} — ทุก value เป็น string ภาษาไทย`,
      '4. ในส่วน "whyYouPlayedThatMove" ถ้าข้อมูลพฤติกรรม (เวลาคิด, panic score, จำนวนครั้งที่ยกเลิกเลือกหมาก) บ่งชี้ว่าผู้เล่นรีบร้อนหรือลังเล ให้อ้างอิงตัวเลขจริงมาประกอบคำอธิบาย (เช่น "คุณใช้เวลาคิดแค่ 4 วินาทีทั้งที่เวลาเฉลี่ยของคุณคือ 15 วินาที และนาฬิกาเหลือไม่ถึง 20 วินาที จึงน่าจะรีบตัดสินใจ") แทนที่จะพูดลอยๆ ว่า "คุณลน"',
      '5. ในส่วน "correctMove" ต้องอธิบายเหตุผลเชิงกลยุทธ์ว่าทำไมตาที่ engine แนะนำถึงดีกว่า ไม่ใช่แค่บอกว่า "ควรเดินตานี้แทน"',
      '6. ในส่วน "lessonPrinciple" ให้สรุปเป็นหลักการทั่วไปที่นำไปใช้ในตำแหน่งอื่นได้ ไม่ใช่แค่สรุปตาที่เพิ่งเกิดขึ้น',
      '7. น้ำเสียงให้กำลังใจ ไม่ตำหนิผู้เล่น แต่ต้องตรงไปตรงมาเกี่ยวกับความผิดพลาด',
    ];

    if (isCognitiveTriggered) {
      lines.push(
        '8. ต้องอ้างอิงข้อมูลในส่วน "## การวินิจฉัยเชิงพฤติกรรม (Cognitive Diagnosis)" ของคำถามโดยตรง — ใช้กรอบ 4 ขั้นตอนในการอธิบาย: (ก) สะท้อนหลักฐานพฤติกรรมที่ตรวจพบให้ผู้เล่นเห็นภาพตัวเอง (ข) ชี้ให้เห็นว่าการแก้ปัญหาเฉพาะหน้าที่เพิ่งทำไปสร้างจุดอ่อนถาวรอย่างไร (ค) สอนหลักคิดการไหลเชิงระบบ/Prophylaxis เพื่อไม่ให้เกิดซ้ำ (ง) ปิดท้ายด้วยกฎเหล็กที่นำไปถามตัวเองได้ทุกตา',
      );
    }

    lines.push(
      '',
      'ตัวอย่างรูปแบบ JSON ที่ต้องการ (โครงสร้างเท่านั้น เนื้อหาจริงต้องอิงจากข้อมูลที่ให้ในคำถาม):',
      '{',
      '  "whatHappened": "...",',
      '  "whyYouPlayedThatMove": "...",',
      '  "whyOpponentPlayedThatMove": "...",',
      '  "correctMove": "...",',
      '  "lessonPrinciple": "..."',
      '}',
    );

    return lines.join('\n');
  }
}

// ============================================================================
// User prompt composition
// ============================================================================

function buildUserPrompt(params: BuildExplanationPromptParams): string {
  const sections = [
    formatMoveSection(params.move),
    formatAnalysisSection(params.analysis),
    formatBehaviorSection(params.behavior),
    formatSituationSection(params.situation),
  ];

  const diagnosis = params.cognitiveDiagnosis;
  if (diagnosis && diagnosis.isTriggered) {
    sections.push(formatCognitiveDiagnosisSection(diagnosis));
  }

  return sections.join('\n\n');
}

function formatMoveSection(move: MoveContext): string {
  return [
    '## ตาที่เดิน',
    `- ผู้เดิน: ${move.color === 'w' ? 'ฝ่ายขาว' : 'ฝ่ายดำ'} (ตาที่ ${move.ply})`,
    `- ตาที่เล่นจริง: ${move.sanPlayed} (UCI: ${move.uciPlayed})`,
    `- FEN ก่อนเดิน: ${move.fenBefore}`,
    `- FEN หลังเดิน: ${move.fenAfter}`,
  ].join('\n');
}

function formatAnalysisSection(analysis: EngineAnalysisContext): string {
  const lines = [
    '## ผลวิเคราะห์จาก Engine',
    `- เกรดตาเดิน: ${classificationLabelTh(analysis.classification)}`,
    `- Centipawn loss: ${analysis.centipawnLoss}`,
    `- Win% ก่อนเดิน: ${formatPercent(analysis.winProbBefore)} → หลังเดิน: ${formatPercent(analysis.winProbAfter)}`,
    `- Eval สายที่ดีที่สุด (ก่อนเดิน): ${formatScoreTh(analysis.bestLineEval)}`,
    `- Eval หลังตาที่เล่นจริง: ${formatScoreTh(analysis.playedMoveEval)}`,
    `- ตาที่ engine แนะนำ: ${analysis.bestMoveSan} (UCI: ${analysis.bestMoveUci})`,
  ];

  if (analysis.alternatives.length > 0) {
    lines.push('- ทางเลือกอื่นที่ engine พิจารณา:');
    for (const alt of analysis.alternatives) {
      const note = alt.note ? ` — ${alt.note}` : '';
      lines.push(`  - ${alt.san} (${formatScoreTh(alt.eval)})${note}`);
    }
  }

  return lines.join('\n');
}

function formatBehaviorSection(behavior: BehaviorContext): string {
  return [
    '## พฤติกรรมของผู้เล่นระหว่างคิดตานี้',
    `- เวลาคิด: ${formatMsAsSeconds(behavior.thinkTimeMs)} (เฉลี่ยปกติของผู้เล่นคนนี้: ${formatMsAsSeconds(behavior.averageThinkTimeMs)})`,
    `- Panic score: ${Math.round(behavior.panicScore)}/100`,
    `- จำนวนครั้งที่ยกเลิกเลือกหมากระหว่างตานี้: ${behavior.selectionCancelCount}`,
    `- Hesitation index: ${behavior.hesitationIndex.toFixed(2)} (0=มั่นใจเต็มที่, 1=ลังเลมาก)`,
  ].join('\n');
}

function formatSituationSection(situation: GameSituationContext): string {
  const opening =
    situation.openingEco && situation.openingName
      ? `${situation.openingEco} — ${situation.openingName}`
      : 'ไม่อยู่ในฐานข้อมูล opening (หลุดจาก opening theory แล้ว)';

  return [
    '## บริบทของเกม',
    `- Opening: ${opening}`,
    `- การจับเวลา: ${situation.timeControlLabel}`,
    `- เวลาคงเหลือในนาฬิกาตอนเดินตานี้: ${formatMsAsSeconds(situation.clockRemainingMs)}`,
    `- คู่ต่อสู้: ${situation.opponentLabel}`,
  ].join('\n');
}

function formatCognitiveDiagnosisSection(diagnosis: CognitiveDiagnosis): string {
  const lines = [
    '## การวินิจฉัยเชิงพฤติกรรม (Cognitive Diagnosis)',
    `- Bias หลักที่ตรวจพบ: ${diagnosis.primaryBias ?? 'ไม่ระบุ'}`,
    `- Tunnel Vision Index: ${Math.round(diagnosis.tunnelVisionIndex)}/100`,
  ];

  if (diagnosis.focusFlank) {
    lines.push(`- สัดส่วนการจดจ่อ: ${(diagnosis.spatialFocusRatio * 100).toFixed(0)}% อยู่ที่ฝั่ง ${diagnosis.focusFlank}`);
  }

  if (diagnosis.behavioralEvidence.length > 0) {
    lines.push('- หลักฐานพฤติกรรม:');
    for (const evidence of diagnosis.behavioralEvidence) {
      lines.push(`  - ${evidence}`);
    }
  }

  if (diagnosis.systemicLesson) {
    lines.push(
      `- ปัญหาเฉพาะหน้าที่ผู้เล่นโฟกัส: ${diagnosis.systemicLesson.problemPattern}`,
      `- ความจริงบนกระดานที่ถูกมองข้าม: ${diagnosis.systemicLesson.overlookedReality}`,
      `- หลักการคิดการไหลที่ควรสอน: ${diagnosis.systemicLesson.flowPrinciple}`,
    );
  }

  return lines.join('\n');
}

// ============================================================================
// Formatting helpers
// ============================================================================

function classificationLabelTh(classification: MoveClassification): string {
  switch (classification) {
    case 'brilliant':
      return 'ยอดเยี่ยม (Brilliant)';
    case 'great':
      return 'ดีมาก (Great)';
    case 'best':
      return 'ดีที่สุด (Best)';
    case 'good':
      return 'ดี (Good)';
    case 'inaccuracy':
      return 'ไม่แม่นยำ (Inaccuracy)';
    case 'mistake':
      return 'ผิดพลาด (Mistake)';
    case 'blunder':
      return 'พลาดร้ายแรง (Blunder)';
    case 'forced':
      return 'ตาบังคับ (Forced — มีตาเดียวให้เดิน)';
    default:
      return classification;
  }
}

function formatScoreTh(score: UciScore): string {
  if (score.kind === 'mate') {
    return score.value > 0 ? `รุกฆาตใน ${score.value} ตา` : `โดนรุกฆาตใน ${Math.abs(score.value)} ตา`;
  }
  const pawns = score.value / 100;
  const sign = pawns > 0 ? '+' : '';
  return `${sign}${pawns.toFixed(2)}`;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatMsAsSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} วินาที`;
}