/**
 * schema.ts
 * ---------------------------------------------------------------------------
 * Type ที่ตรงกับ JSON Schema ใน Phase 0 §3.1 (Per-Move Log), §3.2A (Game
 * Summary), §3.2B (Player Profile) แบบ field-ต่อ-field เพื่อให้ Dexie table
 * กับข้อมูลจริงที่ orchestrator (GameAnalyzer, ProfileRepository ฯลฯ) สร้าง
 * ไม่เพี้ยนไปจากพิมพ์เขียว
 *
 * อยู่ที่ `shared/types/` ตามกฎ dependency ในเอกสารสถาปัตยกรรม (§2):
 * ทุกชั้น (core, data, state, features) import จากที่นี่ได้ แต่ไฟล์นี้เอง
 * ห้าม import อะไรจากชั้นอื่นเด็ดขาด (ไม่มี React, ไม่มี Dexie, ไม่มีอะไรทั้งนั้น)
 *
 * หมายเหตุจุดที่ตัดสินใจเบี่ยงจาก JSON ตัวอย่างในเอกสารเล็กน้อย:
 * - `MoveLogRecord.engine` เป็น optional/nullable แม้ตัวอย่างใน §3.1 จะโชว์
 *   เต็มทุก field เสมอ — เพราะ roadmap §5 Phase 2 ระบุชัดว่า "เล่นแล้วข้อมูล
 *   ครบทุก field ของ Schema 1 (ยกเว้น engine.*)" คือ engine.* ถูก backfill
 *   เข้ามาทีหลังโดย GameAnalyzer ใน Phase 3 เท่านั้น
 * - `GameResultRecord.termination` ใช้ค่าเดียวกับ `AnyEndReason` ใน
 *   `state/useGameStore.ts` (checkmate/stalemate/threefold_repetition/
 *   insufficient_material/fifty_move_rule/resignation/timeout) แทนคำย่อ
 *   ("resign", "draw_*") ที่โผล่ในตัวอย่าง JSON §3.2A — เพื่อให้ทั้งแอปใช้
 *   คำศัพท์เดียวกันตั้งแต่ state ไปจนถึง persistence ไม่ต้องมี mapping
 *   ระหว่างทาง ควรพิจารณาย้าย `AnyEndReason` มาไว้ที่นี่แล้วให้
 *   useGameStore.ts import กลับไปแทน เพื่อไม่ให้มี 2 นิยามที่ต้อง sync มือ
 * ---------------------------------------------------------------------------
 */

// ============================================================================
// Shared primitives
// ============================================================================

export type PieceColor = 'w' | 'b';
export type GamePhaseLabel = 'opening' | 'middlegame' | 'endgame';
export type ActorType = 'human' | 'engine' | 'ghost';

export type MoveClassification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'forced';

/** ดู หมายเหตุ ด้านบนของไฟล์ — ตั้งใจให้ตรงกับ AnyEndReason ของ state/useGameStore.ts */
export type GameTermination =
  | 'checkmate'
  | 'stalemate'
  | 'threefold_repetition'
  | 'insufficient_material'
  | 'fifty_move_rule'
  | 'resignation'
  | 'timeout';

export interface EvalScore {
  readonly type: 'cp' | 'mate';
  readonly value: number;
}

// ============================================================================
// Schema 1 — Per-Move Behavioral & Engine Log (Phase 0 §3.1)
// ============================================================================

export interface PieceSelectionLogEntry {
  readonly square: string;
  readonly atMs: number;
  readonly cancelled: boolean;
}

export interface MoveAlternative {
  readonly uci: string;
  readonly san: string;
  readonly cp: number;
  readonly loss: number;
  readonly consequence: string | null; // <--- แก้จุดนี้
}

export interface MoveLogPosition {
  readonly fenBefore: string;
  readonly fenAfter: string;
  readonly san: string;
  readonly uci: string;
  readonly piece: string;
  readonly captured: string | null;
  readonly isCheck: boolean;
  readonly phase: GamePhaseLabel;
  readonly materialBalance: number;
  readonly legalMoveCount: number;
}

export interface MoveLogTiming {
  readonly thinkTimeMs: number;
  readonly clockRemainingMs: number;
  readonly incrementMs: number;
  readonly timePressureRatio: number;
  readonly deviationFromPersonalAvg: number;
  readonly idleBeforeFirstTouchMs: number;
}

/** ตรงกับ MoveTelemetrySnapshot ของ core/telemetry/MoveTracker.ts เป๊ะ — จงใจแยก type เพราะไฟล์นี้ไม่ควร import จาก core/ (ทิศทาง dependency คือ core → shared เท่านั้น ไม่ใช่กลับกัน) */
export interface MoveLogBehavior {
  readonly pieceSelections: readonly PieceSelectionLogEntry[];
  readonly totalClicks: number;
  readonly distinctPiecesTouched: number;
  readonly repeatClickSamePiece: number;
  readonly selectionCancelCount: number;
  readonly hoverHeatmap: Readonly<Record<string, number>>;
  readonly dragDistancePx: number;
  readonly tabBlurCount: number;
  readonly hesitationIndex: number;
}

export interface MoveLogEngine {
  readonly analyzed: true;
  readonly depth: number;
  readonly evalBefore: EvalScore;
  readonly evalAfter: EvalScore;
  readonly bestMove: string;
  readonly bestLinePv: readonly string[];
  readonly playedRank: number | null; // <--- แก้จุดนี้
  readonly centipawnLoss: number;
  readonly winProbBefore: number;
  readonly winProbAfter: number;
  readonly classification: MoveClassification;
  readonly alternatives: readonly MoveAlternative[];
  readonly tacticalMotifs: readonly string[];
}

export interface MoveLogPsych {
  readonly panicScore: number;
  readonly panicDelta: number;
  readonly confidenceProxy: number;
  readonly triggerFlags: readonly string[];
}

export interface MoveLogContext {
  readonly ecoCode: string | null;
  readonly openingName: string | null;
  readonly inBook: boolean;
  readonly masterFrequency: number | null;
  readonly opponentPrevMoveUci: string | null;
  readonly opponentIntent: string | null;
}

export interface MoveLogRecord {
  readonly moveId: string; // {gameId}_{color}_{ply}
  readonly gameId: string;
  readonly ply: number;
  readonly moveNumber: number;
  readonly color: PieceColor;
  readonly actor: ActorType;
  readonly position: MoveLogPosition;
  readonly timing: MoveLogTiming;
  readonly behavior: MoveLogBehavior;
  /** undefined/null จนกว่า Phase 3 GameAnalyzer จะ backfill — ดูหมายเหตุบนสุดของไฟล์ */
  readonly engine?: MoveLogEngine | null;
  readonly psych: MoveLogPsych;
  readonly context: MoveLogContext;
}

// ============================================================================
// Schema 2A — Game Summary (Phase 0 §3.2)
// ============================================================================

export type OpponentType = 'stockfish' | 'ghost_self';

export interface OpponentConfigRecord {
  readonly type: OpponentType;
  /** ระดับตาม Strength Ladder (§4.4) — null สำหรับ ghost_self ที่ไม่ได้อิงระดับตายตัว */
  readonly level: number | null;
  readonly label: string;
  readonly uciElo: number | null;
  readonly skillLevel: number | null;
  readonly moveTimeMs: number | null;
  /** เก็บเป็น JSON string ของ PlayerProfileRecord ณ ตอนสร้าง ghost — null ถ้าไม่ใช่ ghost_self */
  readonly ghostSourceProfileSnapshot: string | null;
}

export interface TimeControlRecord {
  readonly baseMs: number;
  readonly incrementMs: number;
  readonly label: string;
}

export interface GameSetupRecord {
  readonly playerColor: PieceColor;
  readonly opponent: OpponentConfigRecord;
  readonly timeControl: TimeControlRecord;
}

export interface GameResultRecord {
  readonly outcome: 'win' | 'loss' | 'draw';
  readonly termination: GameTermination;
  readonly totalPlies: number;
  readonly finalFen: string;
}

export interface AccuracyCounts {
  readonly brilliant: number;
  readonly great: number;
  readonly best: number;
  readonly good: number;
  readonly inaccuracy: number;
  readonly mistake: number;
  readonly blunder: number;
}

export interface PhaseAccuracy {
  readonly opening: number;
  readonly middlegame: number;
  readonly endgame: number;
}

/** null จนกว่า Phase 3 GameAnalyzer จะรันวิเคราะห์ทั้งเกมเสร็จ (ตอนบันทึกเกมครั้งแรกยังไม่มี) */
export interface AccuracySummary {
  readonly playerAccuracyPct: number;
  readonly avgCentipawnLoss: number;
  readonly counts: AccuracyCounts;
  readonly phaseAccuracy: PhaseAccuracy;
}

export interface CriticalMomentBehaviorSnapshot {
  readonly thinkTimeMs: number;
  readonly panicScore: number;
  readonly repeatClickSamePiece: number;
}

export interface CriticalMoment {
  readonly ply: number;
  readonly type: MoveClassification;
  readonly centipawnLoss: number;
  readonly fenBefore: string;
  readonly playedSan: string;
  readonly bestSan: string;
  readonly winProbSwing: number;
  readonly behaviorSnapshot: CriticalMomentBehaviorSnapshot;
  readonly lessonId: string | null;
  readonly rootCause: string | null; // <--- แก้จุดนี้
}


export interface BehaviorSummary {
  readonly avgThinkTimeMs: number;
  readonly thinkTimeStdDev: number;
  readonly totalHesitationEvents: number;
  readonly avgPanicScore: number;
  readonly peakPanicScore: number;
  readonly peakPanicPly: number;
  readonly movesUnder3Sec: number;
  readonly movesOver30Sec: number;
  readonly timeScrambleMoves: number;
}

export interface OpeningSummary {
  readonly ecoCode: string | null;
  readonly name: string | null;
  readonly bookDepthPlies: number;
  readonly firstDeviationPly: number | null;
  readonly deviationQuality: string | null;
}

export interface TrapFallenInto {
  readonly ply: number;
  readonly name: string;
  readonly warnedByRadar: boolean;
  readonly ignoredWarning: boolean;
}

export interface TrapMissed {
  readonly ply: number;
  readonly name: string;
}

/** shape ของ `trapsSet` ยังไม่ถูกกำหนดชัดเจนในเอกสาร Phase 0 (Phase 3 TrapDetector จะนิยามภายหลัง) จึงปล่อยเป็น unknown[] ไปก่อน */
export interface TrapsSummary {
  readonly trapsFallenInto: readonly TrapFallenInto[];
  readonly trapsSet: readonly unknown[];
  readonly trapsMissed: readonly TrapMissed[];
}

export interface GameSummaryRecord {
  readonly gameId: string;
  readonly schemaVersion: number;
  readonly startedAt: string; // ISO 8601
  readonly endedAt: string; // ISO 8601
  readonly setup: GameSetupRecord;
  readonly result: GameResultRecord;
  readonly pgn: string;
  /** null ตอนบันทึกครั้งแรกหลังจบเกม — Phase 3 batch analysis จะเติมทีหลัง */
  readonly accuracy: AccuracySummary | null;
  readonly criticalMoments: readonly CriticalMoment[];
  readonly behaviorSummary: BehaviorSummary;
  readonly openings: OpeningSummary | null;
  readonly traps: TrapsSummary | null;
}

// ============================================================================
// Schema 2B — Player Profile singleton (Phase 0 §3.2)
// ============================================================================

export interface WinLossDrawRecord {
  readonly w: number;
  readonly l: number;
  readonly d: number;
}

export interface AggregateStats {
  readonly gamesPlayed: number;
  readonly record: WinLossDrawRecord;
  readonly estimatedElo: number;
  readonly eloConfidence: number;
  readonly totalMoves: number;
}

/** ทุกแกน 0-100 — ยังไม่ถูกคำนวณจริงจนกว่าจะถึง Phase 5 StyleExtractor เริ่มที่ 0 ทั้งหมดสำหรับ default profile */
export interface StyleVector {
  readonly aggression: number;
  readonly positional: number;
  readonly tacticalSharpness: number;
  readonly defensiveResilience: number;
  readonly timeManagement: number;
  readonly riskTolerance: number;
  readonly prophylaxis: number;
  readonly endgameTechnique: number;
}

export interface GrandmasterSimilarityEntry {
  readonly name: string;
  readonly score: number;
  readonly sharedTraits: readonly string[];
  readonly divergence: readonly string[];
}

export interface HabitPattern {
  readonly patternId: string;
  readonly trigger: string;
  readonly playerResponse: string;
  readonly frequency: number;
  readonly occurrences: number;
  readonly successRate: number;
  readonly verdict: string;
  readonly recommendedAlternative: string | null;
}

export interface OpponentReading {
  readonly commonOpeningsFaced: readonly string[];
  readonly opponentTrapsUsed: readonly string[];
  readonly yourFallRate: Readonly<Record<string, number>>;
}

export interface ProgressionPoint {
  readonly date: string; // YYYY-MM-DD
  readonly gameId: string;
  readonly accuracy: number;
  readonly avgCpl: number;
  readonly estimatedElo: number;
  readonly avgPanic: number;
  readonly blunders: number;
}

export interface WeaknessRankingEntry {
  readonly area: string;
  readonly severity: number;
  readonly trend: 'worsening' | 'improving' | 'flat';
}

export interface PlayerProfileRecord {
  readonly profileId: 'local_player';
  readonly schemaVersion: number;
  readonly updatedAt: string; // ISO 8601
  readonly aggregate: AggregateStats;
  readonly styleVector: StyleVector;
  readonly grandmasterSimilarity: readonly GrandmasterSimilarityEntry[];
  readonly habitPatterns: readonly HabitPattern[];
  /** key = opponent bucket เช่น "vsLevel6" */
  readonly opponentReadings: Readonly<Record<string, OpponentReading>>;
  readonly progression: readonly ProgressionPoint[];
  readonly weaknessRanking: readonly WeaknessRankingEntry[];
}

// ============================================================================
// Lessons table — provisional shape (Phase 4 PromptBuilder จะเป็นตัวกำหนดจริง)
// ============================================================================

/** โครงคำอธิบาย 5 ส่วนตามที่ระบุใน Phase 0 §5 Phase 4 roadmap — provisional จนกว่าจะพัฒนา PromptBuilder.ts จริง */
export interface LessonSections {
  readonly whatHappened: string;
  readonly whyYouPlayedThatWay: string;
  readonly whyOpponentPlayedThatWay: string;
  readonly whatToPlayInstead: string;
  readonly principleLearned: string;
}

export interface LessonRecord {
  readonly lessonId: string;
  readonly gameId: string;
  readonly ply: number;
  readonly generatedAt: string; // ISO 8601
  readonly source: 'llm' | 'template_fallback';
  readonly sections: LessonSections;
}

// ============================================================================
// Book cache table — cache ผลจาก ECO + Lichess Masters API (§1.3 ข้อ 2)
// ============================================================================

export interface BookCacheRecord {
  /** FEN ที่ตัด halfmove clock กับ fullmove number ออกแล้ว ตามที่ระบุใน §1.3 ข้อ 2 (กัน cache miss จากเลขที่ไม่เกี่ยวกับตำแหน่งจริง) */
  readonly fenKey: string;
  readonly fetchedAt: string; // ISO 8601
  readonly ecoCode: string | null;
  readonly openingName: string | null;
  readonly masterFrequency: number | null;
  /** payload ดิบจาก Lichess Masters API เก็บสำรองไว้เผื่อต้องใช้ field อื่นที่ยังไม่ได้ normalize ตอนนี้ */
  readonly raw: unknown;
}
