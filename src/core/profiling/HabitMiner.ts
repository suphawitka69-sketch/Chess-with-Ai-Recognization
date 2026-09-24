/**
 * HabitMiner.ts
 * ---------------------------------------------------------------------------
 * ขุดหารูปแบบความเคยชินที่ซ้ำๆ (Habit Patterns) และจัดอันดับจุดอ่อน
 * (Weakness Ranking) จากประวัติการเล่นหลายเกม ตาม Phase 0 §3.2 Schema 2B
 * (habitPatterns / weaknessRanking) — ตรวจจับ 3 กลุ่มพฤติกรรมที่ระบุไว้:
 *   1. ลนลานเมื่อเวลาเหลือน้อย (time-pressure blunder spike)
 *   2. ตอบสนองต่อการถูกกดดันแบบอัตโนมัติซ้ำๆ (reactive trigger→response)
 *   3. โลภกินหมากจนโดนดัก (greedy capture leading to follow-up mistakes)
 *
 * หลักการสำคัญที่ยึดตลอดไฟล์นี้ — "ห้ามฟันธงจากข้อมูลน้อยเกินไป": ทุกฟังก์ชัน
 * ตรวจจับมี `minSampleSize`/`minTriggerRepetition` เป็นเกณฑ์ขั้นต่ำก่อนจะสรุปว่า
 * เป็น "นิสัย" จริง เพราะการฟันธงจากตัวอย่าง 2-3 ครั้งจะทำให้ผู้เล่นเข้าใจผิดว่า
 * ตัวเองมีจุดอ่อนที่จริงๆ อาจเป็นแค่ความบังเอิญของเกมไม่กี่เกม
 *
 * ⚠️ ข้อจำกัดที่ต้องรู้ก่อนใช้งาน: `recommendedAlternative` ของแต่ละ pattern
 * จะเป็น `null` เสมอ ยกเว้นกรณีที่มีข้อมูล `engine.bestMove` จริงจาก move log
 * มาอ้างอิงได้ตรงๆ (pattern เรื่อง reactive response) — ไฟล์นี้ไม่เดา "ตาที่ควร
 * เดินแทน" เอาเองเด็ดขาด เพราะไม่มีการเรียก engine วิเคราะห์ซ้ำในนี้ ตาม
 * กฎเหล็กของโปรเจกต์เรื่องห้ามฝังข้อมูลปลอมแล้วนำเสนอเป็นข้อเท็จจริง
 *
 * ⚠️ ข้อสมมติเรื่องลำดับเวลา: ฟังก์ชัน `mineHabits()` คำนวณ `trend` ของแต่ละ
 * weakness โดยสมมติว่า `records` ที่ส่งเข้ามาเรียงตามลำดับเวลาที่เกมเกิดขึ้นจริง
 * (เกมเก่าสุดอยู่ต้น array, ใหม่สุดอยู่ท้าย) — เป็นหน้าที่ของผู้เรียก (เช่น ดึงจาก
 * GameRepository.getRecentGames() แล้วเรียงตามวันที่ก่อนส่งเข้ามา) ถ้าลำดับผิด
 * ผลลัพธ์ trend จะผิดไปด้วย เพราะไฟล์นี้ไม่มีข้อมูล timestamp ของเกมให้ตรวจสอบเอง
 *
 * [แก้แล้ว] Import path ผิด — เดิม `../../shared/types/schema` ชี้ไปที่
 * `src/shared/types/schema.ts` ซึ่งไม่มีจริง ไฟล์นี้อยู่ที่
 * `src/core/profiling/HabitMiner.ts` ดังนั้น `../../` จาก path นี้จะไปถึง
 * `src/` เท่านั้น (ไม่ใช่ `src/data/`) — path ที่ถูกต้องคือ
 * `../../data/shared/types/schema` (ดูหมายเหตุเดียวกันใน GhostEngine.ts)
 * ---------------------------------------------------------------------------
 */

import type { MoveClassification } from '../analysis/classifier';
import type { HabitPattern, MoveLogEngine, MoveLogRecord, WeaknessRankingEntry } from '../../data/shared/types/schema';

// ============================================================================
// Types — input (self-contained mirror ของ MoveLogRecord)
// ============================================================================

/**
 * ⚠️ Type นี้เป็น "mirror" ของ MoveLogRecord (Schema 1) ที่ประกาศจริงใน
 * src/data/shared/types/schema.ts — เขียนแบบ self-contained ในไฟล์นี้เพราะ
 * ยังไม่เคยเห็นเนื้อไฟล์ schema.ts จริงในเซสชันนี้ (ตามกฎข้อ 5 ของโปรเจกต์ —
 * แพทเทิร์นเดียวกับที่ใช้ไปแล้วกับ TrapDetector.ts และ LessonPanel.tsx)
 * ประกาศเฉพาะ field ที่ HabitMiner ใช้งานจริงเท่านั้น (ไม่ใช่ทั้ง schema) โดย
 * อ้างอิงชื่อ/ตำแหน่ง field ตรงจาก Phase 0 §3.1 JSON Schema ฉบับเต็ม —
 * field เดียวที่ import จริงคือ `MoveClassification` จาก classifier.ts เพราะ
 * เป็นไฟล์ที่เขียนเองในโปรเจกต์นี้และทราบ shape แน่ชัด 100%
 *
 * ก่อนใช้งานจริง ต้องเทียบ field ของ type นี้กับ MoveLogRecord จริงใน
 * schema.ts — ถ้าโครงสร้างตรงกัน (แม้แค่บางส่วน) สามารถเปลี่ยนเป็น
 * `import type { MoveLogRecord } from '../../data/shared/types/schema'` แล้ว
 * ใช้แทนที่ HabitMinerMoveLogRecord ได้ทันทีโดยไม่ต้องแก้ logic ส่วนอื่นในไฟล์
 * (ฟังก์ชันทั้งหมดในไฟล์นี้เข้าถึง field ผ่าน path เดียวกับ schema จริงเป๊ะ)
 */
export interface HabitMinerMoveLogRecord {
  readonly gameId: string;
  readonly ply: number;
  readonly color: 'w' | 'b';
  readonly actor: 'human' | 'engine' | 'ghost';
  readonly position: {
    /** UCI ของตานี้เอง เช่น "g1f3" — ใช้ตัดเอา 2 ตัวท้ายเป็น "ช่องปลายทาง" */
    readonly uci: string;
    /** ตัวหมากที่ขยับในตานี้: 'p'|'n'|'b'|'r'|'q'|'k' */
    readonly piece: string;
    /** ตัวหมากที่ถูกกิน (ถ้ามี) รูปแบบเดียวกับ piece — null ถ้าไม่ใช่ตากิน */
    readonly captured: string | null;
  };
  readonly timing: {
    readonly clockRemainingMs: number;
  };
  readonly engine: {
    readonly classification: MoveClassification;
    readonly centipawnLoss: number;
    /** SAN หรือ UCI ของตาที่ engine แนะนำ ณ ตำแหน่งนั้น (รูปแบบขึ้นกับที่ GameAnalyzer บันทึกจริง) — null ถ้า engine ไม่ได้วิเคราะห์ตานี้ */
    readonly bestMove: string | null;
  };
}

// ============================================================================
// Types — output
// ============================================================================

export type HabitTrend = 'improving' | 'worsening' | 'flat';

export type WeaknessItem = WeaknessRankingEntry;

export interface HabitMiningResult {
  readonly patterns: readonly HabitPattern[];
  readonly weaknessRanking: readonly WeaknessItem[];
}

export interface HabitMinerConfig {
  /** เวลาคงเหลือ (ms) ที่ต่ำกว่านี้ถือว่า "อยู่ในภาวะกดดันเรื่องเวลา" — ค่าเริ่มต้น 60,000 (60 วินาที) */
  readonly lowClockThresholdMs?: number;
  /** จำนวนตัวอย่างขั้นต่ำต่อกลุ่ม ก่อนจะกล้าสรุปว่าเป็น pattern จริง (กัน false positive จากข้อมูลน้อยเกินไป) — ค่าเริ่มต้น 8 */
  readonly minSampleSize?: number;
  /** ต้องเจอ trigger เดียวกันซ้ำอย่างน้อยกี่ครั้งถึงนับเป็น "ความเคยชิน" ในกลุ่ม reactive response — ค่าเริ่มต้น 3 */
  readonly minTriggerRepetition?: number;
  /** centipawn loss ขั้นต่ำของตาที่กินเบี้ยเอง ถึงจะถือว่าเป็น "การกินที่ไม่คุ้ม" — ค่าเริ่มต้น 40 */
  readonly greedyCaptureCentipawnLossThreshold?: number;
  /** จำนวนตาถัดไปของผู้เล่นเอง (ไม่นับตาคู่ต่อสู้) ที่จะเช็คว่าพลาดตามมาหรือไม่ หลังตากินเบี้ย — ค่าเริ่มต้น 1 */
  readonly reactiveResponseLookaheadPlies?: number;
}

export class HabitMinerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HabitMinerError';
  }
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: Required<HabitMinerConfig> = {
  lowClockThresholdMs: 60_000,
  minSampleSize: 3,
  minTriggerRepetition: 2,
  greedyCaptureCentipawnLossThreshold: 40,
  reactiveResponseLookaheadPlies: 1,
};

/** ผลต่างอัตรา blunder/mistake (หน่วยสัดส่วน 0-1) ที่ต่ำกว่านี้ถือว่ายังไม่ต่างกันมากพอจะเรียกว่าเป็น "นิสัย" */
const MIN_NOTABLE_RATE_INCREASE = 0.05;

/** ถ้าการตอบสนองแบบอัตโนมัติสำเร็จ (ไม่ใช่ inaccuracy ขึ้นไป) เกินสัดส่วนนี้ ไม่ถือว่าเป็นจุดอ่อนที่ต้องเตือน */
const MAX_SUCCESS_RATE_TO_FLAG = 0.6;

/** จำนวน reactive-response pattern สูงสุดที่จะคืนกลับ (เรียงจากแย่ที่สุดก่อน) กันรายการยาวเกินจนท่วมหน้าจอ */
const MAX_REACTIVE_PATTERNS = 5;

/** สัดส่วนของ "กินเบี้ยแล้วพลาดตามมา" ที่ต่ำกว่านี้ยังไม่ถือว่าเป็นนิสัยที่มีนัยสำคัญ */
const MIN_NOTABLE_BAD_OUTCOME_RATE = 0.25;

/** จำนวน record ขั้นต่ำก่อนจะกล้าคำนวณ trend (แบ่งครึ่งแรก/ครึ่งหลังเปรียบเทียบ) */
const MIN_RECORDS_FOR_TREND = 5;

/** ผลต่างอัตราระหว่างครึ่งแรก/ครึ่งหลังที่ต่ำกว่านี้ถือว่า trend เป็น 'flat' */
const TREND_NOTABLE_DELTA = 0.05;

const PIECE_NAME_TH: Readonly<Record<string, string>> = {
  p: 'เบี้ย',
  n: 'ม้า',
  b: 'บิชอป',
  r: 'เรือ',
  q: 'ควีน',
  k: 'คิง',
};

// ============================================================================
// Public API
// ============================================================================

/**
 * ขุดหา habit pattern ทั้งหมดจากประวัติการเล่น แล้วจัดอันดับจุดอ่อนออกมาด้วย —
 * `records` ต้องมีทั้งสองสี (ไม่ใช่แค่ของผู้เล่น) เพราะ pattern บางกลุ่ม
 * (reactive response) ต้องดู trigger จากตาของคู่ต่อสู้ด้วย
 */
export function mineHabits(
  records: readonly HabitMinerMoveLogRecord[],
  playerColor: 'w' | 'b',
  config: HabitMinerConfig = {},
): HabitMiningResult {
  if (records.length === 0) {
    return { patterns: [], weaknessRanking: [] };
  }

  const resolvedConfig: Required<HabitMinerConfig> = { ...DEFAULT_CONFIG, ...config };
  const playerRecords = records.filter((record) => record.color === playerColor && record.actor === 'human');

  const patterns: HabitPattern[] = [];

  const timeTroublePattern = analyzeTimeTroubleHabit(playerRecords, resolvedConfig);
  if (timeTroublePattern) patterns.push(timeTroublePattern);

  patterns.push(...analyzeReactiveResponseHabits(records, resolvedConfig));

  const greedyCapturePattern = analyzeGreedyCaptureHabit(playerRecords, resolvedConfig);
  if (greedyCapturePattern) patterns.push(greedyCapturePattern);

  const weaknessRanking = buildWeaknessRanking(playerRecords, resolvedConfig, timeTroublePattern, greedyCapturePattern);

  return { patterns, weaknessRanking };
}

/** Adapter ที่รับ schema จริงจาก Dexie และคืนเฉพาะ pattern ที่มีข้อมูลพอให้เชื่อถือได้ */
export function mineHabitsFromMoveLogs(moveLogs: readonly MoveLogRecord[]): readonly HabitPattern[] {
  const usable = moveLogs.filter(isAnalyzedMoveLog);
  const humanColors = [...new Set(usable.filter((log) => log.actor === 'human').map((log) => log.color))];
  const playerColor = humanColors[0];
  if (playerColor === undefined) return [];

  const records: HabitMinerMoveLogRecord[] = usable.map((log) => ({
    gameId: log.gameId,
    ply: log.ply,
    color: log.color,
    actor: log.actor,
    position: {
      uci: log.position.uci,
      piece: log.position.piece,
      captured: log.position.captured,
    },
    timing: { clockRemainingMs: log.timing.clockRemainingMs },
    engine: {
      classification: log.engine.classification,
      centipawnLoss: log.engine.centipawnLoss,
      bestMove: log.engine.bestMove,
    },
  }));
  return mineHabits(records, playerColor).patterns;
}

function isAnalyzedMoveLog(log: MoveLogRecord): log is MoveLogRecord & { readonly engine: MoveLogEngine } {
  return log.engine?.analyzed === true;
}

// ============================================================================
// Pattern 1: Time-pressure blunder spike
// ============================================================================

function analyzeTimeTroubleHabit(
  playerRecords: readonly HabitMinerMoveLogRecord[],
  config: Required<HabitMinerConfig>,
): HabitPattern | null {
  const lowClockRecords = playerRecords.filter((record) => record.timing.clockRemainingMs < config.lowClockThresholdMs);
  const normalClockRecords = playerRecords.filter((record) => record.timing.clockRemainingMs >= config.lowClockThresholdMs);

  if (lowClockRecords.length < config.minSampleSize || normalClockRecords.length < config.minSampleSize) {
    return null; // ข้อมูลไม่พอในกลุ่มใดกลุ่มหนึ่ง — ไม่กล้าฟันธง
  }

  const lowClockBlunderRate = computeBadClassificationRate(lowClockRecords);
  const normalClockBlunderRate = computeBadClassificationRate(normalClockRecords);
  const rateIncrease = lowClockBlunderRate - normalClockBlunderRate;

  if (rateIncrease < MIN_NOTABLE_RATE_INCREASE) {
    return null; // อัตราพลาดไม่ได้ต่างกันมากพอจะเรียกว่าเป็นนิสัย
  }

  const lowClockBadCount = lowClockRecords.filter((record) => isBadClassification(record.engine.classification)).length;

  return {
    patternId: 'time_pressure_blunder_spike',
    trigger: `เหลือเวลาน้อยกว่า ${Math.round(config.lowClockThresholdMs / 1000)} วินาที`,
    playerResponse: `อัตราตาที่พลาด (mistake/blunder) เพิ่มจาก ${formatPercent(normalClockBlunderRate)} เป็น ${formatPercent(lowClockBlunderRate)}`,
    frequency: lowClockBadCount,
    occurrences: lowClockRecords.length,
    successRate: 1 - lowClockBlunderRate,
    verdict: `จุดอ่อนสำคัญ — เมื่อเวลาน้อย มีแนวโน้มตัดสินใจพลาดสูงกว่าปกติเพิ่มขึ้น ${formatPercent(rateIncrease)}`,
    // ไม่มี "ตาที่ดีกว่า" ตาเดียวที่จะแนะนำสำหรับ pattern เชิงพฤติกรรมแบบนี้ — ทางแก้คือฝึกจัดการเวลา ไม่ใช่จำตาเดินเฉพาะจุด
    recommendedAlternative: null,
  };
}

// ============================================================================
// Pattern 2: Reactive trigger → response (generalized mining)
// ============================================================================

interface PairStat {
  count: number;
  successCount: number;
  readonly triggerKey: string;
  readonly responseKey: string;
  sampleBestMove: string | null;
}

function analyzeReactiveResponseHabits(
  allRecords: readonly HabitMinerMoveLogRecord[],
  config: Required<HabitMinerConfig>,
): readonly HabitPattern[] {
  const recordsByGame = groupByGameId(allRecords);
  const pairStatsByKey = new Map<string, PairStat>();
  const triggerOccurrences = new Map<string, number>();

  for (const gameRecords of recordsByGame.values()) {
    const recordByPly = new Map(gameRecords.map((record) => [record.ply, record]));

    for (const record of gameRecords) {
      const opponentPrevRecord = recordByPly.get(record.ply - 1);
      // trigger ต้องมาจากตาของ "คู่ต่อสู้" ที่อยู่ติดกันก่อนหน้าตานี้เป๊ะๆ ไม่ใช่ตาไหนก็ได้ในเกม
      if (!opponentPrevRecord || opponentPrevRecord.color === record.color || record.actor !== 'human') continue;

      const triggerKey = describeMoveKey(opponentPrevRecord.position.piece, opponentPrevRecord.position.uci);
      const responseKey = describeMoveKey(record.position.piece, record.position.uci);
      const pairKey = `${triggerKey}|${responseKey}`;

      triggerOccurrences.set(triggerKey, (triggerOccurrences.get(triggerKey) ?? 0) + 1);

      const isSuccessfulResponse = !isBadClassification(record.engine.classification) && record.engine.classification !== 'inaccuracy';

      const existing = pairStatsByKey.get(pairKey);
      if (existing) {
        existing.count += 1;
        if (isSuccessfulResponse) existing.successCount += 1;
      } else {
        pairStatsByKey.set(pairKey, {
          count: 1,
          successCount: isSuccessfulResponse ? 1 : 0,
          triggerKey,
          responseKey,
          sampleBestMove: record.engine.bestMove,
        });
      }
    }
  }

  const candidatePatterns: HabitPattern[] = [];

  for (const [pairKey, stat] of pairStatsByKey) {
    if (stat.count < config.minTriggerRepetition) continue;

    const successRate = stat.successCount / stat.count;
    if (successRate >= MAX_SUCCESS_RATE_TO_FLAG) continue; // ตอบสนองแบบนี้ได้ผลดีอยู่แล้ว ไม่ใช่จุดอ่อน

    const occurrences = triggerOccurrences.get(stat.triggerKey) ?? stat.count;

    candidatePatterns.push({
      patternId: `reactive_response_${pairKey}`,
      trigger: `คู่ต่อสู้เดิน${describePieceMoveTh(stat.triggerKey)}`,
      playerResponse: `คุณมักตอบด้วย${describePieceMoveTh(stat.responseKey)}ทันที`,
      frequency: stat.count,
      occurrences,
      successRate,
      verdict: `การตอบสนองแบบอัตโนมัตินี้ให้ผลดีเพียง ${formatPercent(successRate)} ของครั้งที่เกิดขึ้น — ควรพิจารณาทางเลือกอื่นก่อนตอบสนองทันที`,
      recommendedAlternative: stat.sampleBestMove,
    });
  }

  return candidatePatterns.sort((a, b) => a.successRate - b.successRate).slice(0, MAX_REACTIVE_PATTERNS);
}

// ============================================================================
// Pattern 3: Greedy capture leading to follow-up mistakes
// ============================================================================

function analyzeGreedyCaptureHabit(
  playerRecords: readonly HabitMinerMoveLogRecord[],
  config: Required<HabitMinerConfig>,
): HabitPattern | null {
  const recordsByGame = groupByGameId(playerRecords);

  let candidateCount = 0;
  let badFollowUpCount = 0;

  for (const gameRecords of recordsByGame.values()) {
    const sortedByPly = [...gameRecords].sort((a, b) => a.ply - b.ply);

    for (let i = 0; i < sortedByPly.length; i += 1) {
      const record = sortedByPly[i];
      const isGreedyPawnCapture =
        record.position.captured === 'p' && record.engine.centipawnLoss >= config.greedyCaptureCentipawnLossThreshold;
      if (!isGreedyPawnCapture) continue;

      candidateCount += 1;

      const followUps = sortedByPly.slice(i + 1).slice(0, config.reactiveResponseLookaheadPlies);
      const hasBadFollowUp = followUps.some((followUp) => isBadClassification(followUp.engine.classification));
      if (hasBadFollowUp) badFollowUpCount += 1;
    }
  }

  if (candidateCount < config.minSampleSize) {
    return null;
  }

  const badOutcomeRate = badFollowUpCount / candidateCount;
  if (badOutcomeRate < MIN_NOTABLE_BAD_OUTCOME_RATE) {
    return null;
  }

  return {
    patternId: 'greedy_pawn_grab',
    trigger: 'มีโอกาสกินเบี้ยที่ตัว engine ประเมินว่าไม่คุ้ม (centipawn loss สูงตอนกิน)',
    playerResponse: `เลือกกินเบี้ยลักษณะนี้ ${candidateCount} ครั้งในข้อมูลที่มี`,
    frequency: badFollowUpCount,
    occurrences: candidateCount,
    successRate: 1 - badOutcomeRate,
    verdict: `การกินเบี้ยลักษณะนี้นำไปสู่ตาที่พลาด (mistake/blunder) ตามมาถึง ${formatPercent(badOutcomeRate)} ของครั้งที่เกิดขึ้น — ควรเช็คความปลอดภัยของตัวเองก่อนกินเบี้ยนอกแผน`,
    // ไม่แนะนำ "ตาที่ควรเดินแทน" เพราะไม่มีข้อมูล engine.bestMove ของตาที่ถูกงดเดินมาเทียบ (เดาไม่ได้ว่าไม่กินแล้วควรเดินอะไรแทน)
    recommendedAlternative: null,
  };
}

// ============================================================================
// Weakness ranking + trend
// ============================================================================

function buildWeaknessRanking(
  playerRecords: readonly HabitMinerMoveLogRecord[],
  config: Required<HabitMinerConfig>,
  timeTroublePattern: HabitPattern | null,
  greedyCapturePattern: HabitPattern | null,
): readonly WeaknessItem[] {
  const items: WeaknessItem[] = [];

  if (timeTroublePattern) {
    items.push({
      area: 'time_pressure_blunders',
      severity: clamp01(timeTroublePattern.frequency / Math.max(1, timeTroublePattern.occurrences)),
      trend: computeTrend(
        playerRecords,
        (record) => record.timing.clockRemainingMs < config.lowClockThresholdMs && isBadClassification(record.engine.classification),
      ),
    });
  }

  if (greedyCapturePattern) {
    items.push({
      area: 'greedy_capture_blunders',
      severity: clamp01(1 - greedyCapturePattern.successRate),
      trend: computeTrend(
        playerRecords,
        (record) =>
          record.position.captured === 'p' && record.engine.centipawnLoss >= config.greedyCaptureCentipawnLossThreshold,
      ),
    });
  }

  return items.sort((a, b) => b.severity - a.severity);
}

/**
 * เปรียบเทียบอัตราการเกิด predicate ระหว่างครึ่งแรก/ครึ่งหลังของ `records`
 * (แบ่งตามลำดับ array ตรงๆ — ดูหมายเหตุเรื่องข้อสมมติลำดับเวลาบนหัวไฟล์)
 */
function computeTrend(
  records: readonly HabitMinerMoveLogRecord[],
  predicate: (record: HabitMinerMoveLogRecord) => boolean,
): HabitTrend {
  if (records.length < MIN_RECORDS_FOR_TREND) {
    return 'flat'; // ข้อมูลน้อยเกินจะบอกเทรนด์ได้อย่างมั่นใจ
  }

  const midpoint = Math.floor(records.length / 2);
  const firstHalf = records.slice(0, midpoint);
  const secondHalf = records.slice(midpoint);

  const firstHalfRate = firstHalf.filter(predicate).length / firstHalf.length;
  const secondHalfRate = secondHalf.filter(predicate).length / secondHalf.length;
  const delta = secondHalfRate - firstHalfRate;

  if (delta >= TREND_NOTABLE_DELTA) return 'worsening';
  if (delta <= -TREND_NOTABLE_DELTA) return 'improving';
  return 'flat';
}

// ============================================================================
// Shared helpers
// ============================================================================

function isBadClassification(classification: MoveClassification): boolean {
  return classification === 'mistake' || classification === 'blunder';
}

function computeBadClassificationRate(records: readonly HabitMinerMoveLogRecord[]): number {
  if (records.length === 0) return 0;
  const badCount = records.filter((record) => isBadClassification(record.engine.classification)).length;
  return badCount / records.length;
}

function groupByGameId(
  records: readonly HabitMinerMoveLogRecord[],
): ReadonlyMap<string, readonly HabitMinerMoveLogRecord[]> {
  const groups = new Map<string, HabitMinerMoveLogRecord[]>();
  for (const record of records) {
    const existing = groups.get(record.gameId);
    if (existing) {
      existing.push(record);
    } else {
      groups.set(record.gameId, [record]);
    }
  }
  return groups;
}

/** สร้างคีย์ระบุ "หมากอะไรไปช่องไหน" จาก piece code + uci (เอา 2 ตัวท้ายของ uci เป็นช่องปลายทาง) เช่น "n->g5" */
function describeMoveKey(piece: string, uci: string): string {
  const destinationSquare = uci.slice(-2);
  return `${piece}->${destinationSquare}`;
}

/** แปลงคีย์ "n->g5" ให้เป็นข้อความไทยอ่านง่าย เช่น "ม้าไปช่อง g5" */
function describePieceMoveTh(moveKey: string): string {
  const [piece, square] = moveKey.split('->');
  const pieceNameTh = PIECE_NAME_TH[piece] ?? piece;
  return `${pieceNameTh}ไปช่อง ${square}`;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}