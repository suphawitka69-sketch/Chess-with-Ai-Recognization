/**
 * src/data/repositories/ProfileRepository.ts
 * ---------------------------------------------------------------------------
 * จัดการแถวเดียวของตาราง `profile` (profileId: 'local_player')
 * แก้ไขบั๊กแครช: ใส่ ?. ป้องกัน TypeError จาก behaviorSummary ที่เป็น undefined ตอนจบเกม
 *
 * [แก้แล้ว] เดิมมีเมธอด `updateAfterGame()` ที่อัปเดต profile แบบ "บวกสะสม
 * ทีละเกม" (incremental) — ไม่มีใครเรียกใช้งานจริงในโค้ดเบสอยู่แล้ว แต่ทิ้งไว้
 * เป็นความเสี่ยง: มันอัปเดตแค่ aggregate/progression แต่ไม่ rebuild
 * habitPatterns / styleVector / weaknessRanking เลย ถ้ามีใครในอนาคตเผลอเรียก
 * มันแทน syncProfileFromGames() จะได้ profile ที่ "ดูเหมือนอัปเดตแล้ว" แต่
 * patterns/style จริงๆ ค้างจากรอบ sync ก่อนหน้า — ขัดกับกฎเหล็กของระบบที่ว่า
 * "ทุกครั้งที่เกมจบหรือ sync profile ต้อง rebuild จาก all-history" ตรงๆ จึงลบ
 * เมธอดนี้ออก ทางเดียวที่ควรมีในการอัปเดต profile คือ syncProfileFromGames()
 * (full rebuild จาก db.games + db.moveLogs ทั้งหมด) เท่านั้น
 * ---------------------------------------------------------------------------
 */

import { db } from '../db';
import { GmSimilarity } from '../../core/profiling/GmSimilarity';
import { mineHabits, mineHabitsFromMoveLogs } from '../../core/profiling/HabitMiner';
import type { BehaviorSummary, GameSummaryRecord, MoveLogRecord, PlayerProfileRecord, StyleVector } from '../../shared/types/schema';

export class ProfileRepositoryError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ProfileRepositoryError';
  }
}

export const LOCAL_PLAYER_PROFILE_ID = 'local_player' as const;
const SCHEMA_VERSION = 1;
const DEFAULT_ESTIMATED_ELO = 1200;

function createDefaultProfile(): PlayerProfileRecord {
  return {
    profileId: LOCAL_PLAYER_PROFILE_ID,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    aggregate: {
      gamesPlayed: 0,
      record: { w: 0, l: 0, d: 0 },
      estimatedElo: DEFAULT_ESTIMATED_ELO,
      eloConfidence: 0,
      totalMoves: 0,
    },
    styleVector: {
      aggression: 0,
      positional: 0,
      tacticalSharpness: 0,
      defensiveResilience: 0,
      timeManagement: 0,
      riskTolerance: 0,
      prophylaxis: 0,
      endgameTechnique: 0,
    },
    grandmasterSimilarity: [],
    habitPatterns: [],
    opponentReadings: {},
    progression: [],
    weaknessRanking: [],
  };
}

function safeBehaviorSummary(game: Partial<GameSummaryRecord> | null | undefined): BehaviorSummary {
  const behavior = game?.behaviorSummary;
  return {
    avgThinkTimeMs: behavior?.avgThinkTimeMs ?? 0,
    thinkTimeStdDev: behavior?.thinkTimeStdDev ?? 0,
    totalHesitationEvents: behavior?.totalHesitationEvents ?? 0,
    avgPanicScore: behavior?.avgPanicScore ?? 0,
    peakPanicScore: behavior?.peakPanicScore ?? 0,
    peakPanicPly: behavior?.peakPanicPly ?? 0,
    movesUnder3Sec: behavior?.movesUnder3Sec ?? 0,
    movesOver30Sec: behavior?.movesOver30Sec ?? 0,
    timeScrambleMoves: behavior?.timeScrambleMoves ?? 0,
  };
}

export class ProfileRepository {
  /**
   * แหล่งเดียวที่อัปเดต db.profile — คำนวณใหม่ทั้งก้อนจาก db.games +
   * db.moveLogs "ทั้งหมด" ทุกครั้ง (ไม่ใช่บวกสะสมจากค่าเดิม) เพื่อไม่ให้
   * habitPatterns/styleVector/weaknessRanking ค้างหรือ drift ไปจากประวัติ
   * เกมจริง ผู้เรียกที่ต้องการ profile ล่าสุด (ProfileScreen, Ghost mode)
   * ต้องเรียกเมธอดนี้เสมอ ไม่ควรอ่าน db.profile ตรงๆ
   */
  public async syncProfileFromGames(): Promise<PlayerProfileRecord> {
    try {
      const [games, moveLogs] = await Promise.all([db.games.toArray(), db.moveLogs.toArray()]);
      const validGames = games.filter((game): game is GameSummaryRecord => !!game && typeof game === 'object' && typeof game.gameId === 'string');
      if (validGames.length === 0) {
        const fresh = createDefaultProfile();
        await db.profile.put(fresh);
        return fresh;
      }

      const orderedGames = [...validGames].sort((left, right) => (left.startedAt ?? '').localeCompare(right.startedAt ?? ''));
      const logsByGame = groupMoveLogsByGame(moveLogs.filter((log) => !!log && typeof log === 'object' && typeof log.gameId === 'string'));
      const habits = mineHabitsFromMoveLogs(moveLogs.filter((log) => !!log && typeof log === 'object' && typeof log.gameId === 'string'));
      const record = { w: 0, l: 0, d: 0 };
      let estimatedElo = DEFAULT_ESTIMATED_ELO;
      let totalMoves = 0;
      const progression: Array<PlayerProfileRecord['progression'][number]> = [];

      for (const game of orderedGames) {
        const outcome = game.result?.outcome ?? 'draw';
        if (outcome === 'win') record.w += 1;
        if (outcome === 'loss') record.l += 1;
        if (outcome === 'draw') record.d += 1;
        totalMoves += game.result?.totalPlies ?? 0;
        estimatedElo += eloDeltaForGame(game);
        const behavior = safeBehaviorSummary(game);
        progression.push({
          date: game.startedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
          gameId: game.gameId,
          accuracy: game.accuracy?.playerAccuracyPct ?? 0,
          avgCpl: game.accuracy?.avgCentipawnLoss ?? 0,
          estimatedElo,
          avgPanic: behavior.avgPanicScore,
          blunders: game.accuracy?.counts?.blunder ?? 0,
        });
      }

      const styleVector = buildStyleVector(orderedGames, logsByGame);
      const grandmasterSimilarity = new GmSimilarity()
        .findTopMatches(styleVector)
        .map((match) => ({
          name: match.name,
          score: match.score,
          sharedTraits: [...match.sharedTraits],
          divergence: [...match.divergence],
        }));

      const validMoveLogs = moveLogs.filter((log): log is MoveLogRecord => !!log && typeof log === 'object' && typeof log.gameId === 'string');
      const humanColors = [...new Set(validMoveLogs.filter((log) => log.actor === 'human').map((log) => log.color))];
      const playerColor = humanColors[0] ?? 'w';
      const habitInsight = mineHabits(
        validMoveLogs
          .filter((log) => log.actor === 'human' || log.actor === 'engine' || log.actor === 'ghost')
          .map((log) => ({
            gameId: log.gameId,
            ply: log.ply,
            color: log.color,
            actor: log.actor,
            position: {
              uci: log.position?.uci ?? '',
              piece: log.position?.piece ?? 'p',
              captured: log.position?.captured ?? null,
            },
            timing: { clockRemainingMs: log.timing?.clockRemainingMs ?? 0 },
            engine: {
              classification: log.engine?.classification ?? 'good',
              centipawnLoss: log.engine?.centipawnLoss ?? 0,
              bestMove: log.engine?.bestMove ?? null,
            },
          })),
        playerColor,
      );

      const updated: PlayerProfileRecord = {
        profileId: LOCAL_PLAYER_PROFILE_ID,
        schemaVersion: SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
        aggregate: {
          gamesPlayed: orderedGames.length,
          record,
          estimatedElo,
          eloConfidence: Math.min(1, orderedGames.length / 20),
          totalMoves,
        },
        styleVector,
        grandmasterSimilarity,
        habitPatterns: habits,
        opponentReadings: {},
        progression,
        weaknessRanking: habitInsight.weaknessRanking,
      };
      await db.profile.put(updated);
      return updated;
    } catch (err) {
      console.error('[ProfileRepository] Failed to sync player profile from games:', err);
      const fallback = createDefaultProfile();
      try {
        await db.profile.put(fallback);
      } catch {
        // Best-effort fallback: never let the UI fail to load because a stale IndexedDB row is malformed.
      }
      return fallback;
    }
  }

  public async getProfile(): Promise<PlayerProfileRecord> {
    try {
      const existing = await db.profile.get(LOCAL_PLAYER_PROFILE_ID);
      if (existing) return existing;

      const fresh = createDefaultProfile();
      await db.profile.put(fresh);
      return fresh;
    } catch (err) {
      throw new ProfileRepositoryError('Failed to load or initialize player profile', err);
    }
  }

  public async resetProfile(): Promise<void> {
    try {
      await db.profile.put(createDefaultProfile());
    } catch (err) {
      throw new ProfileRepositoryError('Failed to reset player profile', err);
    }
  }
}

function isValidGameSummaryRecord(game: unknown): game is GameSummaryRecord {
  if (!game || typeof game !== 'object') return false;
  const candidate = game as Partial<GameSummaryRecord>;
  return typeof candidate.gameId === 'string' && typeof candidate.startedAt === 'string';
}

function isValidMoveLogRecord(log: unknown): log is MoveLogRecord {
  if (!log || typeof log !== 'object') return false;
  const candidate = log as Partial<MoveLogRecord>;
  return typeof candidate.gameId === 'string' && typeof candidate.color === 'string';
}

function groupMoveLogsByGame(logs: readonly MoveLogRecord[]): ReadonlyMap<string, readonly MoveLogRecord[]> {
  const grouped = new Map<string, MoveLogRecord[]>();
  for (const log of logs) {
    const gameLogs = grouped.get(log.gameId);
    if (gameLogs) gameLogs.push(log);
    else grouped.set(log.gameId, [log]);
  }
  return grouped;
}

function eloDeltaForGame(game: Partial<GameSummaryRecord> | GameSummaryRecord): number {
  const level = game.setup?.opponent?.level ?? 0;
  const winDelta = 20 + Math.min(10, level);
  const lossDelta = 15 + Math.min(10, level);
  const outcome = game.result?.outcome ?? 'draw';
  if (outcome === 'win') return winDelta;
  if (outcome === 'loss') return -lossDelta;
  return 0;
}

function clamp100(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildStyleVector(
  games: readonly GameSummaryRecord[],
  logsByGame: ReadonlyMap<string, readonly MoveLogRecord[]>,
): StyleVector {
  const validGames = games.filter((game) => game && typeof game === 'object');
  const playerLogs = validGames.flatMap((game) =>
    (logsByGame.get(game.gameId) ?? []).filter(
      (log) => log.color === (game.setup?.playerColor ?? log.color) && log.actor === 'human',
    ),
  );
  const playerGames = validGames.filter((game) => game.accuracy !== null && game.accuracy !== undefined);
  const accuracies = playerGames.map((game) => game.accuracy?.playerAccuracyPct ?? 0);
  const averageAccuracy = average(accuracies);
  const averagePanic = average(validGames.map((game) => safeBehaviorSummary(game).avgPanicScore));
  const captures = playerLogs.filter((log) => log.position?.captured !== null && log.position?.captured !== undefined).length;
  const checks = playerLogs.filter((log) => log.position?.isCheck === true).length;
  const aggressiveActions = captures + checks;
  const aggression = playerLogs.length === 0 ? 0 : clamp100((aggressiveActions / playerLogs.length) * 100);
  const criticalMoments = validGames.flatMap((game) => game.criticalMoments ?? []);
  const criticalAccuracy = criticalMoments.length === 0
    ? averageAccuracy
    : clamp100(100 - average(criticalMoments.map((moment) => moment.centipawnLoss)) / 4);
  const endgameLogs = playerLogs.filter((log) => log.position?.phase === 'endgame');
  const endgameAccuracy = average(
    validGames.flatMap((game) => (game.accuracy && endgameLogs.some((log) => log.gameId === game.gameId) ? [game.accuracy.playerAccuracyPct] : [])),
  );

  return {
    aggression,
    positional: clamp100(averageAccuracy * 0.75 + (100 - aggression) * 0.25),
    tacticalSharpness: clamp100(criticalAccuracy),
    defensiveResilience: clamp100(averageAccuracy * 0.7 + (100 - averagePanic) * 0.3),
    timeManagement: clamp100(100 - averagePanic),
    riskTolerance: aggression,
    prophylaxis: clamp100(averageAccuracy * 0.6 + (100 - aggression) * 0.4),
    endgameTechnique: endgameLogs.length === 0 ? 0 : clamp100(endgameAccuracy),
  };
}

export const profileRepository = new ProfileRepository();