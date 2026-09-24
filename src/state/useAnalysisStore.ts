import { create } from 'zustand';
import { Chess } from 'chess.js';
import { GameAnalyzer } from '../core/analysis/GameAnalyzer';
import { OpeningBook } from '../core/pedagogy/OpeningBook';
import { enrichGameOpening } from '../core/pedagogy/OpeningEnrichment';
import { getEnginePool } from './useEngineStore';
import { db } from '../data/db';
import { syncGameSummary } from '../data/api/RemoteGameSync';
import { profileRepository } from '../data/repositories/ProfileRepository';
import type { MoveRecord, PieceColor, PromotionPiece } from '../core/chess/GameEngine';
import type {
  AccuracySummary as SchemaAccuracySummary,
  BehaviorSummary,
  GameSummaryRecord,
  MoveLogEngine,
  MoveLogRecord,
  PhaseAccuracy,
} from '../shared/types/schema';
import type { AccuracySummary, AnalyzedMove } from '../features/analysis/types';

export type AnalysisStatus = 'idle' | 'analyzing' | 'done' | 'error';

export type AnalysisCriticalMoments = GameSummaryRecord['criticalMoments'];

export interface AnalysisState {
  readonly status: AnalysisStatus;
  readonly progress: { readonly done: number; readonly total: number };
  readonly moves: readonly AnalyzedMove[];
  readonly accuracy: AccuracySummary | null;
  readonly criticalMoments: AnalysisCriticalMoments;
  readonly errorMessage: string | null;
  readonly gameId: string | null;
}

export interface AnalysisActions {
  readonly startAnalysis: (gameId: string) => Promise<void>;
  readonly cancelAnalysis: () => void;
}

export interface AnalysisStore {
  readonly state: AnalysisState;
  readonly actions: AnalysisActions;
}

const initialState: AnalysisState = {
  status: 'idle',
  progress: { done: 0, total: 0 },
  moves: [],
  accuracy: null,
  criticalMoments: [],
  errorMessage: null,
  gameId: null,
};

let activeController: AbortController | null = null;
// The repository currently has no ECO dataset; do not invent opening entries.
const openingBook = new OpeningBook([]);

function toUiMove(log: MoveLogRecord, engine: MoveLogEngine | null): AnalyzedMove {
  return {
    ply: log.ply,
    moveNumber: log.moveNumber,
    color: log.color,
    san: log.position.san,
    uci: log.position.uci,
    fenBefore: log.position.fenBefore,
    fenAfter: log.position.fenAfter,
    evalBefore: engine?.evalBefore ?? null,
    evalAfter: engine?.evalAfter ?? null,
    bestMoveUci: engine?.bestMove ?? null,
    classification: engine?.classification ?? null,
    centipawnLoss: engine?.centipawnLoss ?? null,
  };
}

function toUiAccuracy(accuracy: SchemaAccuracySummary): AccuracySummary {
  return {
    playerAccuracyPct: accuracy.playerAccuracyPct,
    avgCentipawnLoss: accuracy.avgCentipawnLoss,
    counts: accuracy.counts,
  };
}

function toUci(move: { readonly from: string; readonly to: string; readonly promotion?: string }): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

function toPromotionPiece(value: string | undefined): PromotionPiece | undefined {
  if (value === 'n' || value === 'b' || value === 'r' || value === 'q') return value;
  return undefined;
}

function reconstructMoveRecord(log: MoveLogRecord): MoveRecord {
  const chess = new Chess(log.position.fenBefore);
  const candidate = chess.moves({ verbose: true }).find((move) => toUci(move) === log.position.uci);
  if (!candidate) {
    throw new Error(`ไม่สามารถประกอบตาเดิน ply ${log.ply} จาก FEN/UCI ใน IndexedDB ได้`);
  }

  const played = chess.move({ from: candidate.from, to: candidate.to, promotion: toPromotionPiece(candidate.promotion) });
  return {
    ply: log.ply,
    moveNumber: log.moveNumber,
    color: log.color,
    piece: played.piece,
    from: played.from,
    to: played.to,
    san: played.san,
    uci: log.position.uci,
    captured: played.captured,
    promotion: toPromotionPiece(played.promotion),
    flags: played.flags,
    isCapture: played.captured !== undefined,
    isEnPassant: played.flags.includes('e'),
    isCastleKingside: played.flags.includes('k'),
    isCastleQueenside: played.flags.includes('q'),
    isPromotion: played.flags.includes('p'),
    isCheck: log.position.isCheck,
    isCheckmate: chess.isCheckmate(),
    fenBefore: log.position.fenBefore,
    fenAfter: log.position.fenAfter,
  };
}

function accuracyFromWinProb(before: number, after: number): number {
  const dropPercent = Math.max(0, (before - after) * 100);
  const raw = 103.1668 * Math.exp(-0.04354 * dropPercent) - 3.1669;
  return Math.min(100, Math.max(0, raw));
}

function buildPhaseAccuracy(
  logs: readonly MoveLogRecord[],
  engines: ReadonlyMap<number, MoveLogEngine>,
  playerColor: PieceColor,
): PhaseAccuracy {
  const totals: Record<'opening' | 'middlegame' | 'endgame', { sum: number; count: number }> = {
    opening: { sum: 0, count: 0 },
    middlegame: { sum: 0, count: 0 },
    endgame: { sum: 0, count: 0 },
  };
  for (const log of logs) {
    if (log.color !== playerColor) continue;
    const engine = engines.get(log.ply);
    if (!engine) continue;
    const bucket = totals[log.position.phase];
    bucket.sum += accuracyFromWinProb(engine.winProbBefore, engine.winProbAfter);
    bucket.count += 1;
  }
  return {
    opening: totals.opening.count ? totals.opening.sum / totals.opening.count : 0,
    middlegame: totals.middlegame.count ? totals.middlegame.sum / totals.middlegame.count : 0,
    endgame: totals.endgame.count ? totals.endgame.sum / totals.endgame.count : 0,
  };
}

function buildSchemaAccuracy(
  logs: readonly MoveLogRecord[],
  engines: ReadonlyMap<number, MoveLogEngine>,
  playerColor: PieceColor,
  playerAccuracyPct: number,
): SchemaAccuracySummary {
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
  let playerMoveCount = 0;
  for (const log of logs) {
    if (log.color !== playerColor) continue;
    const engine = engines.get(log.ply);
    if (!engine) continue;
    playerMoveCount += 1;
    totalLoss += engine.centipawnLoss;
    if (engine.classification !== 'forced') counts[engine.classification] += 1;
  }
  return {
    playerAccuracyPct,
    avgCentipawnLoss: playerMoveCount ? totalLoss / playerMoveCount : 0,
    counts,
    phaseAccuracy: buildPhaseAccuracy(logs, engines, playerColor),
  };
}

function buildBehaviorSummary(logs: readonly MoveLogRecord[]): BehaviorSummary {
  if (logs.length === 0) {
    return {
      avgThinkTimeMs: 0,
      thinkTimeStdDev: 0,
      totalHesitationEvents: 0,
      avgPanicScore: 0,
      peakPanicScore: 0,
      peakPanicPly: 0,
      movesUnder3Sec: 0,
      movesOver30Sec: 0,
      timeScrambleMoves: 0,
    };
  }
  const thinkTimes = logs.map((log) => log.timing.thinkTimeMs);
  const average = thinkTimes.reduce((sum, value) => sum + value, 0) / thinkTimes.length;
  const variance = thinkTimes.reduce((sum, value) => sum + (value - average) ** 2, 0) / thinkTimes.length;
  const peak = logs.reduce((best, log) => (log.psych.panicScore > best.psych.panicScore ? log : best), logs[0]);
  return {
    avgThinkTimeMs: average,
    thinkTimeStdDev: Math.sqrt(variance),
    totalHesitationEvents: logs.filter((log) => log.behavior.hesitationIndex > 0).length,
    avgPanicScore: logs.reduce((sum, log) => sum + log.psych.panicScore, 0) / logs.length,
    peakPanicScore: peak.psych.panicScore,
    peakPanicPly: peak.ply,
    movesUnder3Sec: logs.filter((log) => log.timing.thinkTimeMs < 3000).length,
    movesOver30Sec: logs.filter((log) => log.timing.thinkTimeMs > 30000).length,
    timeScrambleMoves: logs.filter((log) => log.timing.timePressureRatio >= 1).length,
  };
}

/** เกมถือว่า "วิเคราะห์แล้ว" เมื่อมี accuracy ใน games และทุกตาใน moveLogs มี engine.analyzed === true */
function isCached(game: GameSummaryRecord, logs: readonly MoveLogRecord[]): boolean {
  return game.accuracy !== null && logs.length > 0 && logs.every((log) => log.engine?.analyzed === true);
}

function collectAnalyzedEngines(logs: readonly MoveLogRecord[]): Map<number, MoveLogEngine> {
  const engines = new Map<number, MoveLogEngine>();
  for (const log of logs) {
    if (log.engine?.analyzed === true) engines.set(log.ply, log.engine);
  }
  return engines;
}

export const useAnalysisStore = create<AnalysisStore>()((set) => ({
  state: initialState,
  actions: {
    startAnalysis: async (gameId) => {
      activeController?.abort();
      activeController = new AbortController();
      const controller = activeController;

      try {
        // 1) Source of truth = IndexedDB (ทั้งเกมเพิ่งจบและเกมเก่า) ไม่พึ่ง useGameStore
        const [game, moveLogs] = await Promise.all([
          db.games.get(gameId),
          db.moveLogs.where('gameId').equals(gameId).sortBy('ply'),
        ]);
        if (controller.signal.aborted) return;
        if (!game || moveLogs.length === 0) {
          throw new Error('ไม่พบเกมหรือตาเดินใน IndexedDB สำหรับการวิเคราะห์');
        }

        // 2) Hydration: เคยวิเคราะห์แล้ว -> แมปเข้า Store ทันที ไม่เรียก EnginePool / Stockfish
        const cachedAccuracy = game.accuracy;
        if (isCached(game, moveLogs) && cachedAccuracy) {
          const engines = collectAnalyzedEngines(moveLogs);
          set(() => ({
            state: {
              status: 'done',
              progress: { done: moveLogs.length + 1, total: moveLogs.length + 1 },
              moves: moveLogs.map((log) => toUiMove(log, engines.get(log.ply) ?? null)),
              accuracy: toUiAccuracy(cachedAccuracy),
              criticalMoments: game.criticalMoments,
              errorMessage: null,
              gameId,
            },
          }));
          return;
        }

        const pool = getEnginePool();
        if (!pool) throw new Error('ยังไม่ได้เตรียม Engine สำหรับวิเคราะห์');

        // 3) ประกอบ MoveRecord[] จาก moveLogs (Reconstruct ผ่าน chess.js ให้ครบทุกฟิลด์ของ MoveRecord)
        const moveHistory: MoveRecord[] = moveLogs.map(reconstructMoveRecord);
        set(() => ({
          state: {
            ...initialState,
            status: 'analyzing',
            gameId,
            progress: { done: 0, total: moveHistory.length + 1 },
          },
        }));

        const result = await new GameAnalyzer(pool).analyzeGame(
          moveHistory,
          moveLogs,
          game.setup.playerColor,
          {},
          (done, total) =>
            set((current) => ({
              state: {
                ...current.state,
                progress: { done, total },
              },
            })),
          controller.signal,
        );
        if (controller.signal.aborted) return;

        const openingResult = await enrichGameOpening(
          openingBook,
          null,
          moveHistory.map((move) => ({
            ply: move.ply,
            fenBefore: move.fenBefore,
            fenAfter: move.fenAfter,
            uci: move.uci,
            san: move.san,
          })),
        );
        if (controller.signal.aborted) return;

        // 4) แมปผลจาก engineByPly กลับเข้าแต่ละตา (evalBefore / evalAfter มาจากค่าจริงของ engine)
        const updatedLogs: MoveLogRecord[] = moveLogs.map((log) => {
          const engine = result.engineByPly.get(log.ply);
          const context = openingResult.moveContexts[log.ply - 1] ?? log.context;
          return engine ? { ...log, engine, context } : { ...log, context };
        });
        const engines = collectAnalyzedEngines(updatedLogs);
        const schemaAccuracy = buildSchemaAccuracy(
          updatedLogs,
          result.engineByPly,
          game.setup.playerColor,
          result.accuracy.playerAccuracyPct,
        );

        // 5) Persistence: บันทึก engine ต่อตาลง moveLogs และ accuracy / criticalMoments ลง games (ใน transaction เดียว)
        await db.transaction('rw', db.games, db.moveLogs, async () => {
          await db.moveLogs.bulkPut(updatedLogs);
          await db.games.update(gameId, {
            accuracy: schemaAccuracy,
            criticalMoments: result.criticalMoments,
            behaviorSummary: buildBehaviorSummary(updatedLogs),
            openings: openingResult.summary,
          });
        });
        const updatedGame = await db.games.get(gameId);
        if (updatedGame) await syncGameSummary(updatedGame);
        await profileRepository.syncProfileFromGames();
        if (controller.signal.aborted) return;

        set(() => ({
          state: {
            status: 'done',
            progress: { done: moveLogs.length + 1, total: moveLogs.length + 1 },
            moves: updatedLogs.map((log) => toUiMove(log, engines.get(log.ply) ?? null)),
            accuracy: toUiAccuracy(schemaAccuracy),
            criticalMoments: result.criticalMoments,
            errorMessage: null,
            gameId,
          },
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        set((current) => ({
          state: {
            ...current.state,
            status: 'error',
            errorMessage: error instanceof Error ? error.message : String(error),
            gameId,
          },
        }));
      } finally {
        if (activeController === controller) activeController = null;
      }
    },

    cancelAnalysis: () => {
      activeController?.abort();
      activeController = null;
      set((current) => ({ state: { ...current.state, status: 'idle' } }));
    },
  },
}));

export function useAnalysisActions(): AnalysisActions {
  return useAnalysisStore((state) => state.actions);
}