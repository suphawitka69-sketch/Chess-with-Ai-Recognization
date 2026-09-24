/**
 * useGameStore.ts  (v4 — เพิ่ม waitForPendingPersist() กัน race ระหว่าง
 * background persist หลังจบเกม กับการ rebuild profile ที่ตามมาทันที)
 * ---------------------------------------------------------------------------
 * ⚠️ สิ่งที่ยังเป็นสมมติฐาน (ยังไม่เห็นไฟล์จริง):
 *
 *   import { db } from '../data/db';
 *   สมมติว่ามี Dexie database instance ชื่อ `db` export จากไฟล์นี้ ตาม pattern
 *   เดียวกับที่ MoveLogRepository.ts / GameRepository.ts ใช้ภายใน และมี table
 *   ชื่อ `moveLogs` ที่เก็บ MoveLogRecord[] ตรงตาม Schema — ถ้า path หรือชื่อ
 *   table ต่างจากนี้ แก้แค่บรรทัด import นี้บรรทัดเดียว ไม่ต้องแตะโครงสร้างอื่น
 *
 *   import { PanicCalculator } from '../core/analysis/PanicCalculator';
 *   สมมติว่า PanicCalculator เป็น class ที่มี static method `calculate(...)`
 *   ตรงตาม signature ที่ให้มา — ถ้า path จริงต่างจากนี้ แก้แค่บรรทัด import นี้
 *
 * เปลี่ยนจาก v3:
 *   - [ใหม่] เพิ่ม module-scope `pendingPersistPromise` ที่เก็บ Promise ของ
 *     background persist job ที่ finishGame() ยิงออกไปตอนจบเกม (save summary
 *     ลง db.games + save moveLogs ลง db.moveLogs) — เดิมงานนี้เป็น "fire and
 *     forget" ไม่มีใครรอได้เลย ทำให้ถ้าผู้เล่นกดไปหน้าโปรไฟล์หรือเริ่ม Ghost
 *     mode ทันทีหลังเกมจบ มีโอกาสสูงที่ ProfileRepository.syncProfileFromGames()
 *     จะอ่าน db.games/db.moveLogs ไปก่อนที่เกมล่าสุดจะเขียนเสร็จจริง ทำให้
 *     habitPatterns/estimatedElo ที่คำนวณได้ "หาย" เกมล่าสุดไป 1 เกม ขัดกับกฎ
 *     ที่ว่าทุกครั้งที่ sync ต้อง rebuild จาก all-history จริงเสมอ
 *   - [ใหม่] เพิ่ม action `waitForPendingPersist()` ใน GameActions ให้ผู้เรียก
 *     ภายนอก (เช่น ProfileScreen, App.tsx ก่อนเรียก syncProfileFromGames())
 *     await ได้ว่างานเขียนของเกมล่าสุด (ถ้ามี) เสร็จแล้วจริงๆ ก่อนไปคำนวณต่อ —
 *     ยังคงเป็น "ไม่บล็อก UI ตอนจบเกม" เหมือนเดิมทุกประการ (finishGame() เอง
 *     ยังไม่ await เหมือนก่อน) เปลี่ยนแค่ว่ามีจุดให้ "เช็คทีหลังว่าเสร็จหรือยัง"
 *     เพิ่มเข้ามาเท่านั้น ไม่กระทบ flow ระหว่างเล่นเกมเลย
 * ---------------------------------------------------------------------------
 */

import { create } from 'zustand';
import { Chess } from 'chess.js';
import {
  GameEngine,
  GameEngineError,
  type BoardSquareInfo,
  type GameStatus,
  type LegalMove,
  type MoveInput,
  type MoveRecord,
  type PieceColor,
} from '../core/chess/GameEngine';
import { Clock, type ClockColor, type ClockConfig, type ClockSnapshot } from '../core/chess/Clock';
import { getEnginePool, useEngineStore } from './useEngineStore';
import { gameRepository } from '../data/repositories/GameRepository';
import { syncGameSummary } from '../data/api/RemoteGameSync';
import { profileRepository } from '../data/repositories/ProfileRepository';
import { db } from '../data/db';
import { PanicCalculator } from '../core/telemetry/PanicCalculator';
import { OpeningBook, buildLiveMoveContext } from '../core/pedagogy/OpeningBook';
import { GhostEngine, type EngineMoveProvider } from '../core/profiling/GhostEngine';
import type { GameSummaryRecord, MoveLogRecord, GamePhaseLabel as MoveGamePhase, PlayerProfileRecord } from '../shared/types/schema';

// ============================================================================
// Types
// ============================================================================

export type GamePhase = 'idle' | 'initializing' | 'playing' | 'paused' | 'ended';

type ExtractTermination<T> = T extends { readonly termination: infer U } ? U : never;

export type GameEndReason = ExtractTermination<GameStatus>;
export type ExternalEndReason = 'resignation' | 'timeout';
export type AnyEndReason = GameEndReason | ExternalEndReason;

export interface GameOutcome {
  readonly termination: AnyEndReason;
  readonly winner: PieceColor | 'draw';
}

export interface OpponentConfig {
  readonly type: 'stockfish' | 'ghost_self';
  readonly strengthLevel: number;
  readonly uciElo: number | null;
  readonly label: string;
  readonly ghostSourceProfileSnapshot: string | null;
  readonly profileSnapshot: PlayerProfileRecord | null;
}

export interface InitGameConfig {
  readonly playerColor: PieceColor;
  readonly strengthLevel: number;
  readonly timeControl: ClockConfig;
  readonly startFen?: string;
  readonly opponent?: OpponentConfig;
}

export interface GameState {
  readonly phase: GamePhase;
  readonly gameId: string | null;
  readonly playerColor: PieceColor | null;
  readonly opponentConfig: OpponentConfig | null;
  /** base time (ms) ของ time control ปัจจุบัน — เก็บแยกจาก ClockSnapshot เพราะ PanicCalculator ต้องใช้ค่านี้ตรงๆ (ClockSnapshot มีแค่ remaining ไม่มี base) */
  readonly baseTimeMs: number | null;
  readonly fen: string;
  readonly turn: PieceColor | null;
  readonly history: readonly MoveRecord[];
  readonly lastMove: MoveRecord | null;
  readonly clock: ClockSnapshot | null;
  readonly isEngineThinking: boolean;
  readonly outcome: GameOutcome | null;
  readonly errorMessage: string | null;
}

export interface GameActions {
  readonly initGame: (config: InitGameConfig) => Promise<void>;
  /** telemetry มาจาก useMoveTelemetry().flushForMove() — optional เพื่อให้ debug mode / โค้ดที่ยังไม่ต่อ telemetry เรียกได้โดยไม่พัง */
  readonly makePlayerMove: (
    input: MoveInput,
    telemetry?: MoveLogRecord['behavior'] & Pick<MoveLogRecord['timing'], 'idleBeforeFirstTouchMs'>,
  ) => Promise<void>;
  readonly triggerEngineMove: () => Promise<void>;
  readonly pauseGame: () => void;
  readonly resumeGame: () => void;
  readonly resign: () => void;
  readonly reset: () => void;
  readonly clearError: () => void;
  readonly getLegalMovesFrom: (square: string) => readonly LegalMove[];
  readonly getPieceAt: (square: string) => BoardSquareInfo | null;
  /** ดึง ClockSnapshot ที่คำนวณสดที่สุด ณ ตอนเรียก (ไม่ใช่ค่าใน state ที่อัปเดตทุก tick interval เท่านั้น) — ให้ useMoveTelemetry ใช้ตอน startTurn/flushForMove */
  readonly getClockSnapshot: () => ClockSnapshot | null;
  /**
   * รอให้ background persist ของเกมล่าสุด (ถ้ามีค้างอยู่) เขียนลง
   * db.games/db.moveLogs เสร็จจริงก่อน — เรียกทันทีก่อนเรียก
   * ProfileRepository.syncProfileFromGames() ทุกครั้งที่มีโอกาสว่าเกมเพิ่ง
   * จบไปหมาดๆ (เช่นตอนเปิดหน้าโปรไฟล์ หรือก่อนเริ่ม Ghost mode) เพื่อกันไม่ให้
   * เกมล่าสุดหายไปจากการ rebuild profile รอบนั้น คืน Promise ที่ resolve ทันที
   * ถ้าไม่มีงาน persist ค้างอยู่
   */
  readonly waitForPendingPersist: () => Promise<void>;
}

export interface GameStore {
  readonly state: GameState;
  readonly actions: GameActions;
  /** ประวัติทุกตาเดินของเกมปัจจุบัน (ยังไม่ persist) — ล้างค่าตอน initGame/reset, บันทึกลง Dexie จริงตอนจบเกมใน finishGame() */
  readonly pendingMoveLogs: readonly MoveLogRecord[];
}

// ============================================================================
// Module-scope singletons
// ============================================================================

let gameEngineInstance: GameEngine | null = null;
let clockInstance: Clock | null = null;
let unsubscribeTick: (() => void) | null = null;
let unsubscribeFlagFall: (() => void) | null = null;

let gameStartedAtIso: string | null = null;
const panicCalculator = new PanicCalculator();
// ECO data is not bundled yet; keep the integration active without inventing entries.
const openingBook = new OpeningBook([]);

/**
 * Promise ของงาน persist หลังจบเกมที่กำลังรันอยู่ (ถ้ามี) — ตั้งค่าใน
 * finishGame() และล้างกลับเป็น null เมื่องานเสร็จ (สำเร็จหรือ error ก็ตาม)
 * ดู waitForPendingPersist() ใน actions
 */
let pendingPersistPromise: Promise<void> | null = null;

function teardownInstances(): void {
  unsubscribeTick?.();
  unsubscribeFlagFall?.();
  unsubscribeTick = null;
  unsubscribeFlagFall = null;
  clockInstance?.dispose();
  clockInstance = null;
  gameEngineInstance = null;
  gameStartedAtIso = null;
}

// ============================================================================
// Domain calculation helpers (กระดาน / เวลา / เฟสเกม)
// ============================================================================

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** ผลต่างแต้มหมากบนกระดาน ณ ตำแหน่งของ chess instance ที่ส่งเข้ามา (ขาวเป็นบวก, ดำเป็นลบ) */
function getMaterialBalance(chess: Chess): number {
  let balance = 0;
  for (const row of chess.board()) {
    for (const square of row) {
      if (!square) continue;
      const value = PIECE_VALUES[square.type] ?? 0;
      balance += square.color === 'w' ? value : -value;
    }
  }
  return balance;
}

function countPieces(chess: Chess): number {
  return chess.board().reduce((total, row) => total + row.filter((sq) => sq !== null).length, 0);
}

function isQueenless(chess: Chess): boolean {
  return chess.board().every((row) => row.every((sq) => sq === null || sq.type !== 'q'));
}

/**
 * เฟสของเกม ณ ply/จำนวนหมากที่เหลือที่กำหนด
 * หมายเหตุ: เงื่อนไข endgame ของสเปค ("ทั้งสองฝั่งไม่มี Queen") ต้องอาศัยข้อมูล
 * เกินกว่าที่ signature (ply, totalPiecesRemaining) ให้มาได้ — จึงเพิ่มพารามิเตอร์
 * ที่ 3 แบบ optional (default false) ไว้ท้ายสุด เพื่อให้ยังเรียกด้วย 2 argument
 * ตามสเปคเดิมได้ปกติ แต่จุดเรียกจริงในไฟล์นี้ส่งค่าที่คำนวณจาก chess instance เข้ามาด้วย
 */
function getGamePhase(ply: number, totalPiecesRemaining: number, bothSidesQueenless = false): MoveGamePhase {
  if (totalPiecesRemaining <= 6 || bothSidesQueenless) return 'endgame';
  if (ply <= 20 && totalPiecesRemaining >= 12) return 'opening';
  return 'middlegame';
}

/** จำนวน legal move ทั้งหมดของฝ่ายที่กำลังจะเดิน ณ ตำแหน่งของ chess instance (เรียกก่อนเดินจริง) */
function getLegalMoveCount(chess: Chess): number {
  return chess.moves().length;
}

// ============================================================================
// Helpers
// ============================================================================

function generateGameId(): string {
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `g_${timePart}${randomPart}`;
}

function buildMoveId(gameId: string, color: PieceColor, ply: number): string {
  return `${gameId}_${color}_${String(ply).padStart(3, '0')}`;
}

const EMPTY_BEHAVIOR: MoveLogRecord['behavior'] = {
  pieceSelections: [],
  totalClicks: 0,
  distinctPiecesTouched: 0,
  repeatClickSamePiece: 0,
  selectionCancelCount: 0,
  hoverHeatmap: {},
  dragDistancePx: 0,
  tabBlurCount: 0,
  hesitationIndex: 0,
};

const DEFAULT_PSYCH: MoveLogRecord['psych'] = {
  panicScore: 0,
  panicDelta: 0,
  confidenceProxy: 1,
  triggerFlags: [],
};

/**
 * ประกอบ MoveLogRecord จาก MoveRecord (GameEngine) + telemetry (ถ้ามี, จาก
 * useMoveTelemetry) ให้ครบทุก field ตาม Schema 100% โดยไม่ใช้ Type Assertion
 * ใดๆ — sub-object "engine" ตั้งใจใส่ null เสมอระหว่างเล่นสด (วิเคราะห์ย้อนหลัง
 * ทีเดียวหลังจบเกมใน Phase 3) และ "context" ใส่ {} ไว้ก่อน (ECO/master
 * frequency มาเติมทีหลังจาก GameAnalyzer)
 */
function buildMoveLogRecord(params: {
  readonly gameId: string;
  readonly move: MoveRecord;
  readonly actor: 'human' | 'engine' | 'ghost';
  readonly clockSnapshotBeforeCommit: ClockSnapshot | null;
  readonly incrementMs: number;
  readonly baseTimeMs: number | null;
  readonly telemetry?: MoveLogRecord['behavior'] & Pick<MoveLogRecord['timing'], 'idleBeforeFirstTouchMs'>;
  readonly previousMoveLog?: MoveLogRecord;
}): MoveLogRecord {
  const { gameId, move, actor, clockSnapshotBeforeCommit, incrementMs, baseTimeMs, telemetry, previousMoveLog } = params;

  const thinkTimeMs = clockSnapshotBeforeCommit?.elapsedInCurrentTurnMs ?? 0;
  const clockRemainingMs =
    move.color === 'w'
      ? clockSnapshotBeforeCommit?.whiteRemainingMs ?? 0
      : clockSnapshotBeforeCommit?.blackRemainingMs ?? 0;
  const timePressureRatio = thinkTimeMs / Math.max(clockRemainingMs, 1);

  // สร้าง chess.js instance จาก fenBefore เพื่อคำนวณ material/phase/legal-move-count
  // ของตำแหน่ง "ก่อนเดิน" โดยไม่ต้องพึ่งพา internal state ของ GameEngine
  const chessBeforeMove = new Chess(move.fenBefore);
  const totalPiecesRemaining = countPieces(chessBeforeMove);
  const phase = getGamePhase(move.ply, totalPiecesRemaining, isQueenless(chessBeforeMove));

  const behavior: MoveLogRecord['behavior'] = telemetry
    ? {
        pieceSelections: telemetry.pieceSelections,
        totalClicks: telemetry.totalClicks,
        distinctPiecesTouched: telemetry.distinctPiecesTouched,
        repeatClickSamePiece: telemetry.repeatClickSamePiece,
        selectionCancelCount: telemetry.selectionCancelCount,
        hoverHeatmap: telemetry.hoverHeatmap,
        dragDistancePx: telemetry.dragDistancePx,
        tabBlurCount: telemetry.tabBlurCount,
        hesitationIndex: telemetry.hesitationIndex,
      }
    : EMPTY_BEHAVIOR;

  // Psych: ตาเดินของ human คำนวณผ่าน PanicCalculator จริง (ถ้ามี telemetry — debug
  // mode ที่เรียกโดยไม่มี telemetry จะ fallback เป็นค่า default เดียวกับ engine
  // เพื่อไม่ให้พัง) ตาเดินของ engine ใส่ default เสมอตามสเปค
  const psych: MoveLogRecord['psych'] =
    actor === 'human' && telemetry
      ? (() => {
          const panicResult = panicCalculator.calculate({
            telemetry: {
              ply: move.ply,
              color: move.color,
              pieceSelections: [],
              totalClicks: telemetry.totalClicks,
              distinctPiecesTouched: telemetry.distinctPiecesTouched,
              repeatClickSamePiece: telemetry.repeatClickSamePiece,
              selectionCancelCount: telemetry.selectionCancelCount,
              hoverHeatmap: telemetry.hoverHeatmap,
              dragDistancePx: telemetry.dragDistancePx,
              tabBlurCount: telemetry.tabBlurCount,
              hesitationIndex: telemetry.hesitationIndex,
              idleBeforeFirstTouchMs: telemetry.idleBeforeFirstTouchMs,
              turnEndedAtEpochMs: Date.now(),
            },
            clockRemainingMs,
            baseTimeMs: baseTimeMs ?? 0,
          });
          return {
            panicScore: panicResult.panicScore,
            panicDelta: panicResult.panicDelta,
            confidenceProxy: panicResult.confidenceProxy,
            triggerFlags: panicResult.triggerFlags,
          };
        })()
      : DEFAULT_PSYCH;

  const record: MoveLogRecord = {
    moveId: buildMoveId(gameId, move.color, move.ply),
    gameId,
    ply: move.ply,
    moveNumber: move.moveNumber,
    color: move.color,
    actor,

    position: {
      fenBefore: move.fenBefore,
      fenAfter: move.fenAfter,
      san: move.san,
      uci: move.uci,
      piece: move.piece,
      captured: move.captured ?? null,
      isCheck: move.isCheck,
      phase,
      materialBalance: getMaterialBalance(chessBeforeMove),
      legalMoveCount: getLegalMoveCount(chessBeforeMove),
    },

    timing: {
      thinkTimeMs,
      clockRemainingMs,
      incrementMs,
      timePressureRatio,
      deviationFromPersonalAvg: 0,
      idleBeforeFirstTouchMs: telemetry?.idleBeforeFirstTouchMs ?? 0,
    },

    behavior,

    // engine field ระหว่างเกม (live) ให้เป็น null เสมอ — GameAnalyzer (Phase 3)
    // จะวิเคราะห์ย้อนหลังทีเดียวหลังจบเกม แล้วค่อย update record นี้ใน Dexie
    engine: null,

    psych,

    // ECO/master frequency ฯลฯ มาเติมทีหลังจาก GameAnalyzer (Phase 3/4)
    context: buildLiveMoveContext(openingBook, {
      fenAfter: move.fenAfter,
      previous: previousMoveLog?.context ?? null,
      opponentPrevMoveUci: previousMoveLog?.color !== move.color ? previousMoveLog?.position.uci ?? null : null,
    }),
  };

  return record;
}

function buildGameSummaryRecord(params: {
  readonly gameId: string;
  readonly startedAtIso: string;
  readonly playerColor: PieceColor;
  readonly opponentConfig: OpponentConfig;
  readonly timeControl: ClockConfig;
  readonly history: readonly MoveRecord[];
  readonly outcome: GameOutcome;
  readonly pgn: string;
}): GameSummaryRecord {
  const { gameId, startedAtIso, playerColor, opponentConfig, timeControl, history, outcome, pgn } = params;
  const lastMove = history[history.length - 1];

  return {
    gameId,
    schemaVersion: 1,
    startedAt: startedAtIso,
    endedAt: new Date().toISOString(),

    setup: {
      playerColor,
      opponent: { type: opponentConfig.type, level: opponentConfig.strengthLevel },
      timeControl: {
        baseMs: timeControl.baseMs,
        incrementMs: timeControl.incrementMs,
        label: `${Math.round(timeControl.baseMs / 60_000)}+${Math.round(timeControl.incrementMs / 1000)}`,
      },
    },

    result: {
      outcome: outcome.winner === 'draw' ? 'draw' : outcome.winner === playerColor ? 'win' : 'loss',
      termination: outcome.termination,
      totalPlies: history.length,
      finalFen: lastMove?.fenAfter ?? '',
    },

    pgn,
    accuracy: null,
    criticalMoments: [],
    behaviorSummary: {
      avgThinkTimeMs: 0,
      thinkTimeStdDev: 0,
      totalHesitationEvents: 0,
      avgPanicScore: 0,
      peakPanicScore: 0,
      peakPanicPly: 0,
      movesUnder3Sec: 0,
      movesOver30Sec: 0,
      timeScrambleMoves: 0,
    },
    openings: null,
    traps: null,
  } satisfies GameSummaryRecord;
}

// ============================================================================
// Initial state
// ============================================================================

const initialGameState: GameState = {
  phase: 'idle',
  gameId: null,
  playerColor: null,
  opponentConfig: null,
  baseTimeMs: null,
  fen: '',
  turn: null,
  history: [],
  lastMove: null,
  clock: null,
  isEngineThinking: false,
  outcome: null,
  errorMessage: null,
};

// ============================================================================
// Store
// ============================================================================

export const useGameStore = create<GameStore>()((set, get) => {
  function finishGame(outcome: GameOutcome): void {
    const clock = clockInstance;
    const engine = gameEngineInstance;
    if (clock && (clock.getPhase() === 'running' || clock.getPhase() === 'paused')) {
      clock.stop();
    }

    const current = get().state;

    set((s) => ({
      state: {
        ...s.state,
        phase: 'ended',
        isEngineThinking: false,
        outcome,
        clock: clockInstance?.getSnapshot() ?? s.state.clock,
      },
    }));

    // --- Persist แบบ background job: ไม่ await ไม่บล็อก UI ---------------------
    // ผู้เรียกที่ต้องการรู้ว่างานนี้เขียนเสร็จจริงหรือยัง (เช่นก่อน rebuild
    // profile) ใช้ actions.waitForPendingPersist() แทนการ await ตรงนี้
    if (current.gameId && engine && current.playerColor && current.opponentConfig && gameStartedAtIso) {
      const gameId = current.gameId;
      const summary = buildGameSummaryRecord({
        gameId,
        startedAtIso: gameStartedAtIso,
        playerColor: current.playerColor,
        opponentConfig: current.opponentConfig,
        timeControl: clock?.getConfig() ?? { baseMs: 0, incrementMs: 0 },
        history: engine.getHistory(),
        outcome,
        pgn: engine.getPgn(),
      });

      pendingPersistPromise = (async () => {
        try {
          await gameRepository.saveGame(summary);
          await syncGameSummary(summary);
          // บันทึกประวัติทุกตาเดินลง Dexie จริงก่อนรีเซ็ตหรือ freeze state ต่อไป
          await db.moveLogs.bulkPut(get().pendingMoveLogs);

          // ทำให้ snapshot ประวัติการเล่นที่ใช้สำหรับ self mode / ghost mode
          // ถูก rebuild จาก all-history จริงทุกครั้งหลังเกมจบเพื่อให้ habit,
          // aggregation, และ Elo ของ profile ตรงกับเกมล่าสุดเสมอ
          await profileRepository.syncProfileFromGames();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[useGameStore] Failed to persist game ${gameId}:`, err);
        } finally {
          pendingPersistPromise = null;
        }
      })();
    }
  }

  function handleFlagFall(color: ClockColor): void {
    const winner: PieceColor = color === 'w' ? 'b' : 'w';
    finishGame({ termination: 'timeout', winner });
  }

  return {
    state: initialGameState,
    pendingMoveLogs: [],

    actions: {
      initGame: async (config) => {
        teardownInstances();

        const gameId = generateGameId();
        gameStartedAtIso = new Date().toISOString();
        const opponentConfig: OpponentConfig = config.opponent ?? {
          type: 'stockfish',
          strengthLevel: config.strengthLevel,
          uciElo: null,
          label: 'Stockfish',
          ghostSourceProfileSnapshot: null,
          profileSnapshot: null,
        };

        set(() => ({
          state: {
            ...initialGameState,
            phase: 'initializing',
            gameId,
            playerColor: config.playerColor,
            opponentConfig,
            baseTimeMs: config.timeControl.baseMs,
          },
          pendingMoveLogs: [],
        }));

        const pool = getEnginePool();
        if (!pool) {
          set((s) => ({
            state: { ...s.state, phase: 'idle', errorMessage: 'ยังไม่ได้เตรียม engine — กรุณาเริ่มต้น engine ก่อนเริ่มเกม' },
          }));
          return;
        }

        try {
          await useEngineStore.getState().actions.setStrengthLevel(config.strengthLevel);
        } catch (err) {
          set((s) => ({
            state: { ...s.state, phase: 'idle', errorMessage: err instanceof Error ? err.message : String(err) },
          }));
          return;
        }

        const engine = new GameEngine(config.startFen);
        const clock = new Clock(config.timeControl);

        gameEngineInstance = engine;
        clockInstance = clock;

        unsubscribeTick = clock.onTick((snapshot) => {
          set((s) => ({ state: { ...s.state, clock: snapshot } }));
        });
        unsubscribeFlagFall = clock.onFlagFall(handleFlagFall);

        set((s) => ({
          state: {
            ...s.state,
            phase: 'playing',
            fen: engine.getFen(),
            turn: engine.getTurn(),
            history: engine.getHistory(),
            lastMove: null,
            clock: clock.getSnapshot(),
            isEngineThinking: false,
            outcome: null,
            errorMessage: null,
          },
        }));

        clock.start('w');

        if (engine.getTurn() !== config.playerColor) {
          await get().actions.triggerEngineMove();
        }
      },

      makePlayerMove: async (input, telemetry) => {
        const current = get().state;
        const engine = gameEngineInstance;
        const clock = clockInstance;

        if (current.phase !== 'playing' || !engine || !clock) {
          set((s) => ({ state: { ...s.state, errorMessage: 'เกมยังไม่เริ่ม หรือจบไปแล้ว' } }));
          return;
        }
        if (current.isEngineThinking) {
          set((s) => ({ state: { ...s.state, errorMessage: 'กรุณารอให้ engine คิดตาให้เสร็จก่อน' } }));
          return;
        }
        if (engine.getTurn() !== current.playerColor) {
          set((s) => ({ state: { ...s.state, errorMessage: 'ยังไม่ถึงตาของคุณ' } }));
          return;
        }

        const clockBeforeCommit = clock.getSnapshot();

        let record: MoveRecord;
        try {
          record = engine.makeMove(input);
        } catch (err) {
          const message = err instanceof GameEngineError ? err.message : `เดินไม่ได้: ${String(err)}`;
          set((s) => ({ state: { ...s.state, errorMessage: message } }));
          return;
        }

        clock.commitMove();

        if (current.gameId) {
          const pendingLogs = get().pendingMoveLogs;
          const logRecord = buildMoveLogRecord({
            gameId: current.gameId,
            move: record,
            actor: 'human',
            clockSnapshotBeforeCommit: clockBeforeCommit,
            incrementMs: clock.getConfig().incrementMs,
            baseTimeMs: current.baseTimeMs,
            telemetry,
            previousMoveLog: pendingLogs[pendingLogs.length - 1],
          });
          set((s) => ({ pendingMoveLogs: [...s.pendingMoveLogs, logRecord] }));
        }

        set((s) => ({
          state: {
            ...s.state,
            fen: engine.getFen(),
            turn: engine.getTurn(),
            history: engine.getHistory(),
            lastMove: record,
            clock: clock.getSnapshot(),
            errorMessage: null,
          },
        }));

        const status = engine.getStatus();
        if (status.isOver) {
          finishGame(status);
          return;
        }

        if (clock.getPhase() === 'flagged') {
          return;
        }

        if (engine.getTurn() !== current.playerColor) {
          await get().actions.triggerEngineMove();
        }
      },

      triggerEngineMove: async () => {
        const current = get().state;
        const engine = gameEngineInstance;
        const clock = clockInstance;

        if (current.phase !== 'playing' || !engine || !clock) return;
        if (current.isEngineThinking) return;
        if (engine.getTurn() === current.playerColor) return;

        const pool = getEnginePool();
        if (!pool) {
          set((s) => ({ state: { ...s.state, errorMessage: 'ไม่พบ engine pool ที่พร้อมใช้งาน' } }));
          return;
        }

        set((s) => ({ state: { ...s.state, isEngineThinking: true, errorMessage: null } }));

        try {
          if (current.opponentConfig?.type === 'ghost_self' && current.opponentConfig.profileSnapshot) {
            const ghostProvider: EngineMoveProvider = {
              selectMoveAtStrength: async (fen, legalMoveUcis, estimatedElo) => {
                const ladder = pool.getStrengthLadder();
                const preset = ladder.reduce((closest, candidate) =>
                  Math.abs((candidate.uciElo ?? 3000) - estimatedElo) < Math.abs((closest.uciElo ?? 3000) - estimatedElo)
                    ? candidate
                    : closest,
                ladder[0]);
                await useEngineStore.getState().actions.setStrengthLevel(preset.level);

                const response = await pool.requestPlayMove(fen, engine.getUciMoveList());
                return response.bestMove.bestMove;
              },
            };
            const ghost = new GhostEngine(ghostProvider);
            const ghostSelection = await ghost.selectMove({
              profileSnapshot: {
                estimatedEloAtSnapshot: current.opponentConfig.uciElo ?? current.opponentConfig.profileSnapshot.aggregate.estimatedElo,
                habitSignals: [],
                habitPatterns: current.opponentConfig.profileSnapshot.habitPatterns,
              },
              fen: engine.getFen(),
              opponentLastMoveUci: engine.getHistory()[engine.getHistory().length - 1]?.uci ?? null,
            });

            if (get().state.phase !== 'playing') {
              return;
            }

            const clockBeforeCommit = clock.getSnapshot();
            const record = engine.makeMove(ghostSelection.moveUci);
            clock.commitMove();
            if (current.gameId) {
              const pendingLogs = get().pendingMoveLogs;
              const logRecord = buildMoveLogRecord({
                gameId: current.gameId,
                move: record,
                actor: 'ghost',
                clockSnapshotBeforeCommit: clockBeforeCommit,
                incrementMs: clock.getConfig().incrementMs,
                baseTimeMs: current.baseTimeMs,
                previousMoveLog: pendingLogs[pendingLogs.length - 1],
              });
              set((s) => ({ pendingMoveLogs: [...s.pendingMoveLogs, logRecord] }));
            }
            set((s) => ({
              state: {
                ...s.state,
                fen: engine.getFen(),
                turn: engine.getTurn(),
                history: engine.getHistory(),
                lastMove: record,
                clock: clock.getSnapshot(),
                isEngineThinking: false,
                errorMessage: null,
              },
            }));
            const ghostStatus = engine.getStatus();
            if (ghostStatus.isOver) finishGame(ghostStatus);
            return;
          }

          const wtimeMs = clock.getRemainingMsFor('w');
          const btimeMs = clock.getRemainingMsFor('b');
          const incrementMs = clock.getConfig().incrementMs;

          const { bestMove } = await pool.requestPlayMove(engine.getFen(), engine.getUciMoveList(), {
            wtimeMs,
            btimeMs,
            wincMs: incrementMs,
            bincMs: incrementMs,
          });

          if (get().state.phase !== 'playing') {
            return;
          }

          if (bestMove.bestMove === '(none)') {
            const status = engine.getStatus();
            set((s) => ({ state: { ...s.state, isEngineThinking: false } }));
            if (status.isOver) finishGame(status);
            return;
          }

          const clockBeforeCommit = clock.getSnapshot();
          const record = engine.makeMove(bestMove.bestMove);
          clock.commitMove();

          if (current.gameId) {
            const pendingLogs = get().pendingMoveLogs;
            const logRecord = buildMoveLogRecord({
              gameId: current.gameId,
              move: record,
              actor: 'engine',
              clockSnapshotBeforeCommit: clockBeforeCommit,
              incrementMs,
              baseTimeMs: current.baseTimeMs,
              previousMoveLog: pendingLogs[pendingLogs.length - 1],
            });
            set((s) => ({ pendingMoveLogs: [...s.pendingMoveLogs, logRecord] }));
          }

          set((s) => ({
            state: {
              ...s.state,
              fen: engine.getFen(),
              turn: engine.getTurn(),
              history: engine.getHistory(),
              lastMove: record,
              clock: clock.getSnapshot(),
              isEngineThinking: false,
              errorMessage: null,
            },
          }));

          const status = engine.getStatus();
          if (status.isOver) {
            finishGame(status);
          }
        } catch (err) {
          set((s) => ({
            state: { ...s.state, isEngineThinking: false, errorMessage: err instanceof Error ? err.message : String(err) },
          }));
        }
      },

      pauseGame: () => {
        const current = get().state;
        const clock = clockInstance;
        if (current.phase !== 'playing' || !clock) return;
        if (current.isEngineThinking) {
          set((s) => ({ state: { ...s.state, errorMessage: 'ไม่สามารถหยุดเกมขณะ engine กำลังคิดอยู่ได้' } }));
          return;
        }

        clock.pause();
        set((s) => ({ state: { ...s.state, phase: 'paused', errorMessage: null } }));
      },

      resumeGame: () => {
        const current = get().state;
        const clock = clockInstance;
        if (current.phase !== 'paused' || !clock) return;

        clock.resume();
        set((s) => ({ state: { ...s.state, phase: 'playing', errorMessage: null } }));
      },

      resign: () => {
        const current = get().state;
        if (current.phase !== 'playing' || current.playerColor === null) return;

        const winner: PieceColor = current.playerColor === 'w' ? 'b' : 'w';
        finishGame({ termination: 'resignation', winner });
      },

      reset: () => {
        teardownInstances();
        set(() => ({ state: initialGameState, pendingMoveLogs: [] }));
      },

      clearError: () => {
        set((s) => ({ state: { ...s.state, errorMessage: null } }));
      },

      getLegalMovesFrom: (square) => {
        if (!gameEngineInstance) return [];
        return gameEngineInstance.getLegalMoves(square as never);
      },

      getPieceAt: (square) => {
        if (!gameEngineInstance) return null;
        return gameEngineInstance.getBoard().find((b) => b.square === square) ?? null;
      },

      getClockSnapshot: () => {
        return clockInstance?.getSnapshot() ?? null;
      },

      waitForPendingPersist: () => {
        return pendingPersistPromise ?? Promise.resolve();
      },
    },
  };
});

// ============================================================================
// Selector helpers
// ============================================================================

export function useGameActions(): GameActions {
  return useGameStore((s) => s.actions);
}

export function useGamePhase(): GamePhase {
  return useGameStore((s) => s.state.phase);
}

export function useGameId(): string | null {
  return useGameStore((s) => s.state.gameId);
}

export function useGameFen(): string {
  return useGameStore((s) => s.state.fen);
}

export function useGameTurn(): PieceColor | null {
  return useGameStore((s) => s.state.turn);
}

export function useGamePlayerColor(): PieceColor | null {
  return useGameStore((s) => s.state.playerColor);
}

export function useGameBaseTimeMs(): number | null {
  return useGameStore((s) => s.state.baseTimeMs);
}

export function useGameClock(): ClockSnapshot | null {
  return useGameStore((s) => s.state.clock);
}

export function useIsEngineThinking(): boolean {
  return useGameStore((s) => s.state.isEngineThinking);
}

export function useGameOutcome(): GameOutcome | null {
  return useGameStore((s) => s.state.outcome);
}

export function useGameHistory(): readonly MoveRecord[] {
  return useGameStore((s) => s.state.history);
}

export function useGameError(): string | null {
  return useGameStore((s) => s.state.errorMessage);
}

export function usePendingMoveLogs(): readonly MoveLogRecord[] {
  return useGameStore((s) => s.pendingMoveLogs);
}