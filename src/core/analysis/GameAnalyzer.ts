/**
 * GameAnalyzer.ts
 * ---------------------------------------------------------------------------
 * ตัวประมวลผลระดับ "ทั้งเกม" — รับ `MoveRecord[]` จาก GameEngine และ
 * `MoveLogRecord[]` (พฤติกรรมที่บันทึกไว้ใน Dexie) ไปวิเคราะห์ทุกตำแหน่งด้วย
 * analysisEngine ของ EnginePool แบบ batch แล้วประกอบผลเป็น:
 *   - MoveLogEngine ต่อหนึ่งตาเดิน (คีย์ด้วย MoveRecord.ply) ตรงตาม schema
 *   - CriticalMoment[] (เฉพาะตาของผู้เล่น) พร้อม behaviorSnapshot จาก MoveLogRecord จริง
 *   - AccuracySummary ของผู้เล่น
 *
 * กลยุทธ์ความเร็ว: "ตำแหน่งหลังตา N" กับ "ตำแหน่งก่อนตา N+1" คือตำแหน่งเดียวกัน
 * เกมที่มี N ตาจึงต้องวิเคราะห์แค่ N+1 ตำแหน่ง (ไม่ใช่ 2N) โดยส่ง FEN ตรงๆ
 *
 * ขอบเขต Phase 3: ไม่มีข้อความสอน/LLM — ฟิลด์ที่ต้องรอ Phase 4 ใส่ null / [] เสมอ
 *   - MoveAlternative.consequence = null
 *   - CriticalMoment.rootCause = null, lessonId = null
 *   - MoveLogEngine.tacticalMotifs = []
 *   - MoveLogEngine.playedRank = null ถ้าตาที่เล่นอยู่นอก top-N MultiPV
 *
 * Convention เรื่อง perspective (สำคัญ):
 *   - UCI score ดิบเป็น "relative-to-side-to-move" เสมอ
 *   - evalBefore/evalAfter และ MoveAlternative.cp เก็บเป็น "มุมมองฝ่ายขาว" (ขาวบวก ดำลบ)
 *   - winProbBefore/After, centipawnLoss มาจาก classifyMove() ซึ่งเป็น mover-relative
 * ---------------------------------------------------------------------------
 */

import { Chess } from 'chess.js';
import type { MoveRecord, PieceColor } from '../chess/GameEngine';
import { EnginePool } from '../engine/EnginePool';
import type { UciInfo } from '../engine/UciProtocol';
import { classifyMove, type MoveClassification } from './classifier';
import { flipScorePerspective, type EngineScore } from './winProbability';
import type {
  CriticalMoment,
  EvalScore,
  AccuracySummary,
  MoveAlternative,
  MoveLogEngine,
  MoveLogRecord,
} from '../../shared/types/schema';

// ============================================================================
// Types
// ============================================================================

export interface GameAnalyzerConfig {
  /** ความลึกการวิเคราะห์ต่อตำแหน่ง (ค่าเริ่มต้น 18, ปรับเป็น 20 ได้ถ้ายอมรอนานขึ้น) */
  readonly depth?: number;
  /** win probability drop ขั้นต่ำ (0-1) ที่นับเป็น "จุดเปลี่ยนสำคัญ" นอกเหนือจาก blunder/brilliant */
  readonly criticalMomentWinProbDrop?: number;
}

export type AnalysisWarningKind =
  /** engine ไม่รายงาน score ของตำแหน่งก่อน/หลังตานี้ — ข้ามตานี้ทั้งตา */
  | 'no-engine-score'
  /** ตานี้เข้าเกณฑ์ critical moment แต่ไม่พบ MoveLogRecord ที่ ply ตรงกัน (ไม่ fake behaviorSnapshot) */
  | 'missing-move-log'
  /** แปลง bestMove (UCI) เป็น SAN ไม่สำเร็จ (ไม่ fake ค่า) */
  | 'best-san-unresolvable';

export interface AnalysisWarning {
  readonly ply: number;
  readonly kind: AnalysisWarningKind;
}

export interface GameAnalysisResult {
  readonly playerColor: PieceColor;
  /** MoveLogEngine ของทุกตาที่วิเคราะห์สำเร็จ (ทั้งสองสี) คีย์ = MoveRecord.ply — เอาไปเขียนลง Dexie ที่ moveLog.engine */
  readonly engineByPly: ReadonlyMap<number, MoveLogEngine>;
  readonly accuracy: AccuracySummary;
  /** เฉพาะตาของ playerColor เรียงตามลำดับในเกม */
  readonly criticalMoments: readonly CriticalMoment[];
  readonly warnings: readonly AnalysisWarning[];
  /** true ถ้าถูกยกเลิกกลางคัน (AbortSignal) — ผลลัพธ์ที่ได้ยังใช้ได้ เป็นข้อมูลบางส่วน */
  readonly wasAborted: boolean;
  readonly analyzedPlyCount: number;
  readonly totalPlyCount: number;
}

interface PositionToAnalyze {
  readonly fen: string;
  readonly movesFromStart: readonly string[];
  readonly ply: number;
}

type RawUciScore = NonNullable<UciInfo['score']>;

const DEFAULT_DEPTH = 18;
const DEFAULT_CRITICAL_WIN_PROB_DROP = 0.15;

// ============================================================================
// GameAnalyzer
// ============================================================================

export class GameAnalyzer {
  constructor(private readonly enginePool: EnginePool) {}

  /**
   * วิเคราะห์ทั้งเกม — ต้องเรียก `enginePool.initialize()` ให้เสร็จก่อน
   * (EnginePool.getAnalysisEngine() จะ throw เองถ้ายังไม่พร้อม)
   *
   * @param moveLogs MoveLogRecord ที่บันทึกไว้ใน Dexie — จับคู่กับ MoveRecord ด้วย `ply`
   */
  public async analyzeGame(
    moveHistory: readonly MoveRecord[],
    moveLogs: readonly MoveLogRecord[],
    playerColor: PieceColor,
    config: GameAnalyzerConfig = {},
    onProgress?: (current: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<GameAnalysisResult> {
    if (moveHistory.length === 0) {
      return emptyResult(playerColor);
    }

    const depth = config.depth ?? DEFAULT_DEPTH;
    const criticalThreshold = config.criticalMomentWinProbDrop ?? DEFAULT_CRITICAL_WIN_PROB_DROP;

    const moveLogByPly = new Map<number, MoveLogRecord>();
    for (const log of moveLogs) {
      moveLogByPly.set(log.ply, log);
    }

    const positions = buildPositionsToAnalyze(moveHistory);
    const results = await this.enginePool.analyzeGameBatch(positions, depth, onProgress, signal);

    const engineByPly = new Map<number, MoveLogEngine>();
    const criticalMoments: CriticalMoment[] = [];
    const warnings: AnalysisWarning[] = [];
    const classificationCounts = createEmptyClassificationCounts();
    const playerWinProbs: Array<{ before: number; after: number }> = [];

    let analyzedCount = 0;
    let wasAborted = false;

    for (let i = 0; i < moveHistory.length; i += 1) {
      const beforeResult = results.get(i);
      const afterResult = results.get(i + 1);
      if (!beforeResult || !afterResult) {
        wasAborted = true; // ไม่มีผลของตำแหน่งนี้ = ถูกยกเลิกกลางคัน หยุดวิเคราะห์ต่อ
        break;
      }

      const move = moveHistory[i];
      const beforeLine1 = beforeResult.finalLinesByMultiPv.get(1);
      const afterLine1 = afterResult.finalLinesByMultiPv.get(1);
      if (!beforeLine1?.score || !afterLine1?.score) {
        warnings.push({ ply: move.ply, kind: 'no-engine-score' });
        continue;
      }

      // ก่อนตาเดิน ฝ่ายที่จะเดินคือ move.color / หลังตาเดินสลับเป็นอีกสี
      const sideToMoveAfter: PieceColor = move.color === 'w' ? 'b' : 'w';
      const scoreBeforeMove = toWhitePovScore(beforeLine1.score, move.color);
      const scoreAfterMove = toWhitePovScore(afterLine1.score, sideToMoveAfter);

      const legalMoveCount = countLegalMoves(move.fenBefore);
      const isMaterialSacrifice = wasPieceImmediatelyRecaptured(moveHistory, i);
      const playedRank = findPlayedMoveRank(beforeResult.finalLinesByMultiPv, move.uci);

      const result = classifyMove({
        moverColor: move.color,
        scoreBeforeMove,
        scoreAfterMove,
        isOnlyLegalMove: legalMoveCount === 1,
        playedMoveRank: playedRank ?? undefined, // classifier รับ undefined = ไม่ทราบอันดับ
        sacrificesMaterial: isMaterialSacrifice,
      });

      const bestUci = beforeResult.bestMove.bestMove;
      const evalBefore = toEvalScore(beforeLine1.score, move.color);
      const evalAfter = toEvalScore(afterLine1.score, sideToMoveAfter);

      const engineLog: MoveLogEngine = {
        analyzed: true,
        depth: beforeLine1.depth ?? depth,
        evalBefore,
        evalAfter,
        bestMove: bestUci,
        bestLinePv: beforeLine1.pv && beforeLine1.pv.length > 0 ? beforeLine1.pv : [bestUci],
        playedRank,
        centipawnLoss: result.centipawnLoss,
        winProbBefore: result.winProbBefore,
        winProbAfter: result.winProbAfter,
        classification: result.classification,
        alternatives: buildAlternatives(move.fenBefore, beforeResult.finalLinesByMultiPv, move.color),
        tacticalMotifs: [],
      };
      engineByPly.set(move.ply, engineLog);
      analyzedCount += 1;

      if (move.color !== playerColor) continue;

      classificationCounts[result.classification] += 1;
      playerWinProbs.push({ before: result.winProbBefore, after: result.winProbAfter });

      // ติดลบ = แย่ลงสำหรับผู้เดิน, บวก = ดีขึ้น (classifyMove คืน winProb แบบ mover-relative)
      const winProbSwing = result.winProbAfter - result.winProbBefore;
      const isNotableGrade = result.classification === 'blunder' || result.classification === 'brilliant';
      if (!isNotableGrade && -winProbSwing < criticalThreshold) continue;

      const moveLog = moveLogByPly.get(move.ply);
      if (!moveLog) {
        warnings.push({ ply: move.ply, kind: 'missing-move-log' });
        continue;
      }

      const bestSan = uciToSan(move.fenBefore, bestUci);
      if (bestSan === null) {
        warnings.push({ ply: move.ply, kind: 'best-san-unresolvable' });
        continue;
      }

      criticalMoments.push({
        ply: move.ply,
        type: result.classification,
        centipawnLoss: result.centipawnLoss,
        fenBefore: move.fenBefore,
        playedSan: move.san,
        bestSan,
        winProbSwing,
        behaviorSnapshot: {
          thinkTimeMs: moveLog.timing.thinkTimeMs,
          panicScore: moveLog.psych.panicScore,
          repeatClickSamePiece: moveLog.behavior.repeatClickSamePiece,
        },
        lessonId: null,
        rootCause: null,
      });
    }

    return {
      playerColor,
      engineByPly,
      accuracy: buildAccuracySummary(moveHistory, moveLogs, engineByPly, playerColor, playerWinProbs),
      criticalMoments,
      warnings,
      wasAborted,
      analyzedPlyCount: analyzedCount,
      totalPlyCount: moveHistory.length,
    };
  }
}

// ============================================================================
// Score conversion helpers
// ============================================================================

/**
 * จุดเดียวที่อ่าน shape ของ UciInfo.score (ตาม SOURCE CONTRACT: `{ type, value }`)
 * ถ้า UciProtocol.ts จริงใช้ชื่อ field อื่น (เช่น `kind`) แก้เฉพาะฟังก์ชันนี้ + scoreToCp()
 */
function toEngineScore(score: RawUciScore): EngineScore {
  return score.kind === 'mate' ? { type: 'mate', value: score.value } : { type: 'cp', value: score.value };
}

function toEvalScore(score: RawUciScore, sideToMove: PieceColor): EvalScore {
  const engineScore = toEngineScore(score);
  const whiteScore = sideToMove === 'w' ? engineScore : flipScorePerspective(engineScore);
  return { type: whiteScore.type, value: whiteScore.value };
}

/**
 * UCI score ดิบเป็น relative-to-side-to-move → แปลงเป็นมุมมองฝ่ายขาว (ขาวบวก ดำลบ)
 * โดยรับ `sideToMove` ของตำแหน่งนั้นเป็น parameter
 *
 * ข้อจำกัดที่ทราบ: ตำแหน่งที่ถูกรุกฆาตแล้ว (Stockfish รายงาน `mate 0`) เครื่องหมายของ 0
 * ไม่มีความหมาย การ flip จึงสูญเสียข้อมูลว่าใครชนะ — ตานั้นจะขึ้นอยู่กับว่า
 * classifier/winProbability จัดการ mate 0 อย่างไร
 */
function toWhitePovScore(rawScore: RawUciScore, sideToMove: PieceColor): EngineScore {
  const engineScore = toEngineScore(rawScore);
  return sideToMove === 'w' ? engineScore : flipScorePerspective(engineScore);
}

/** แปลงคะแนน (รวม mate) เป็น cp ตามสูตรที่กำหนดไว้ — ค่าที่ได้ยังเป็น POV เดียวกับ score ที่ส่งเข้ามา */
function scoreToCp(score: RawUciScore): number {
  return score.kind === 'mate'
    ? score.value > 0
      ? 10000 - score.value * 100
      : -10000 - score.value * 100
    : score.value;
}

/**
 * หาอันดับ (1-indexed) ของตาที่เล่นจริงใน MultiPV ของ engine ด้วยการเทียบ pv[0]
 * คืน null ถ้าอยู่นอก top-N (ตรงกับ MoveLogEngine.playedRank: number | null)
 */
function findPlayedMoveRank(finalLinesByMultiPv: ReadonlyMap<number, UciInfo>, playedUci: string): number | null {
  for (const [rank, info] of finalLinesByMultiPv) {
    if (info.pv?.[0] === playedUci) {
      return rank;
    }
  }
  return null;
}

// ============================================================================
// Move / alternatives helpers
// ============================================================================

/**
 * แปลง UCI → SAN จริงด้วย chess.js จาก FEN ก่อนเดิน — คืน null ถ้าแปลงไม่ได้
 * (ตาผิดกติกา/UCI รูปแบบผิด) ไม่สร้างค่าปลอมขึ้นมาแทน
 * รองรับทั้ง chess.js v1 (throw เมื่อผิดกติกา) และเวอร์ชันเก่า (คืน null)
 */
function uciToSan(fen: string, uci: string): string | null {
  if (uci.length < 4) return null;
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    return move?.san ?? null;
  } catch {
    return null;
  }
}

function countLegalMoves(fen: string): number {
  return new Chess(fen).moves().length;
}

/**
 * สร้าง alternatives จากทุก MultiPV line ที่มี pv[0] และ score:
 *  - cp: มุมมองฝ่ายขาว (สอดคล้องกับ evalBefore/evalAfter), แปลง mate ตามสูตรที่กำหนด
 *  - loss: ระยะห่างจาก line 1 ในมุมมองผู้เดิน (≥ 0 เสมอ, line 1 = 0)
 *  - consequence: null (รอ Phase 4)
 * line ที่แปลง SAN ไม่ได้จะถูกข้าม ไม่ใส่ค่าปลอม
 */
function buildAlternatives(
  fenBefore: string,
  lines: ReadonlyMap<number, UciInfo>,
  moverColor: PieceColor,
): readonly MoveAlternative[] {
  const bestScore = lines.get(1)?.score;
  if (!bestScore) return [];
  const bestCpForMover = scoreToCp(bestScore);

  const alternatives: MoveAlternative[] = [];
  const sortedLines = [...lines.entries()].sort((a, b) => a[0] - b[0]);

  for (const [, info] of sortedLines) {
    const uci = info.pv?.[0];
    if (!uci || !info.score) continue;

    const san = uciToSan(fenBefore, uci);
    if (san === null) continue;

    // score ดิบของตำแหน่งก่อนเดินเป็น relative-to-mover; สูตร mate→cp สมมาตรเมื่อกลับเครื่องหมาย
    const cpForMover = scoreToCp(info.score);
    alternatives.push({
      uci,
      san,
      cp: moverColor === 'w' ? cpForMover : 0 - cpForMover, // 0 - x เลี่ยง -0
      loss: Math.max(0, bestCpForMover - cpForMover),
      consequence: null,
    });
  }

  return alternatives;
}

// ============================================================================
// Internal helpers
// ============================================================================

function buildPositionsToAnalyze(moveHistory: readonly MoveRecord[]): readonly PositionToAnalyze[] {
  const positions: PositionToAnalyze[] = moveHistory.map((move, index) => ({
    fen: move.fenBefore,
    movesFromStart: [],
    ply: index, // positionIndex i = ตำแหน่งก่อนตาที่ i (0-indexed ตาม array ไม่ใช่ MoveRecord.ply)
  }));

  const lastMove = moveHistory[moveHistory.length - 1];
  positions.push({ fen: lastMove.fenAfter, movesFromStart: [], ply: moveHistory.length });

  return positions;
}

/**
 * proxy ของ "เสียสละวัสดุ": หมากที่เพิ่งย้ายถูกคู่ต่อสู้กินคืนทันทีในตาถัดไปหรือไม่
 * จับได้เฉพาะกรณีถูกกินคืนทันทีเท่านั้น
 */
function wasPieceImmediatelyRecaptured(moveHistory: readonly MoveRecord[], moveIndex: number): boolean {
  const move = moveHistory[moveIndex];
  const nextMove = moveHistory[moveIndex + 1];
  if (!nextMove || nextMove.color === move.color) return false;
  return nextMove.isCapture && nextMove.to === move.to;
}

function createEmptyClassificationCounts(): Record<MoveClassification, number> {
  return {
    brilliant: 0,
    great: 0,
    best: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
    forced: 0,
  };
}

function buildAccuracySummary(
  moveHistory: readonly MoveRecord[],
  moveLogs: readonly MoveLogRecord[],
  engines: ReadonlyMap<number, MoveLogEngine>,
  playerColor: PieceColor,
  playerWinProbs: ReadonlyArray<{ before: number; after: number }>,
): AccuracySummary {
  const moveLogByPly = new Map(moveLogs.map((log) => [log.ply, log]));
  const counts = {
    brilliant: 0,
    great: 0,
    best: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  };
  let totalLoss = 0;
  let analyzedPlayerMoves = 0;
  const phaseScores: Record<'opening' | 'middlegame' | 'endgame', Array<{ before: number; after: number }>> = {
    opening: [],
    middlegame: [],
    endgame: [],
  };

  for (const move of moveHistory) {
    if (move.color !== playerColor) continue;
    const engine = engines.get(move.ply);
    if (!engine) continue;
    analyzedPlayerMoves += 1;
    totalLoss += engine.centipawnLoss;
    if (engine.classification !== 'forced') counts[engine.classification] += 1;
    const phase = moveLogByPly.get(move.ply)?.position.phase;
    if (phase) phaseScores[phase].push({ before: engine.winProbBefore, after: engine.winProbAfter });
  }

  return {
    playerAccuracyPct: computeAccuracyPercent(playerWinProbs),
    avgCentipawnLoss: analyzedPlayerMoves ? totalLoss / analyzedPlayerMoves : 0,
    counts,
    phaseAccuracy: {
      opening: computeAccuracyPercent(phaseScores.opening),
      middlegame: computeAccuracyPercent(phaseScores.middlegame),
      endgame: computeAccuracyPercent(phaseScores.endgame),
    },
  };
}

function emptyResult(playerColor: PieceColor): GameAnalysisResult {
  return {
    playerColor,
    engineByPly: new Map(),
    accuracy: {
      playerAccuracyPct: 100,
      avgCentipawnLoss: 0,
      counts: {
        brilliant: 0,
        great: 0,
        best: 0,
        good: 0,
        inaccuracy: 0,
        mistake: 0,
        blunder: 0,
      },
      phaseAccuracy: { opening: 0, middlegame: 0, endgame: 0 },
    },
    criticalMoments: [],
    warnings: [],
    wasAborted: false,
    analyzedPlyCount: 0,
    totalPlyCount: 0,
  };
}

/**
 * แปลง win% drop ต่อตาเป็นคะแนน accuracy 0-100 แล้วเฉลี่ย — ใช้สูตรที่ชุมชน
 * reverse-engineer จาก Lichess (`103.1668 * e^(-0.04354x) - 3.1669`, x = win% drop 0-100)
 *
 * ⚠️ ไม่มีเอกสารทางการจาก Lichess ยืนยัน 100% — ควรเทียบกับผลจริงก่อนใช้ใน production
 */
function computeAccuracyPercent(playerMoves: ReadonlyArray<{ before: number; after: number }>): number {
  if (playerMoves.length === 0) return 100;

  const perMoveAccuracies = playerMoves.map((m) => {
    const winProbDropPercent = Math.max(0, (m.before - m.after) * 100);
    const raw = 103.1668 * Math.exp(-0.04354 * winProbDropPercent) - 3.1669;
    return Math.min(100, Math.max(0, raw));
  });

  const average = perMoveAccuracies.reduce((sum, v) => sum + v, 0) / perMoveAccuracies.length;
  return Math.round(average * 10) / 10;
}