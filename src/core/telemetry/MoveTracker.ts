/**
 * src/core/telemetry/MoveTracker.ts
 * ---------------------------------------------------------------------------
 * ตัวบันทึกและรวบรวมพฤติกรรมการเดินหมากของผู้เล่น "ระหว่างตา" (Canonical version)
 *
 * คุณสมบัติ:
 * - เก็บข้อมูลลงใน Mutable memory ธรรมดา (ไม่กระตุก React render)
 * - มีเมธอด getLiveCounts() สำหรับส่งข้อมูลสดให้ PanicMeter ระหว่างคิดตา
 * - มีเมธอด flushMoveTelemetry() เพื่อปิดยอดพฤติกรรมตอนปล่อยหมาก (ตรงกับ Schema 1)
 * ---------------------------------------------------------------------------
 */

import type { Square } from 'chess.js';

// ============================================================================
// Types
// ============================================================================

export interface PieceSelectionEvent {
  readonly square: Square;
  readonly atMs: number;
  readonly cancelled: boolean;
}

export interface MoveTelemetrySnapshot {
  readonly pieceSelections: readonly PieceSelectionEvent[];
  readonly totalClicks: number;
  readonly distinctPiecesTouched: number;
  readonly repeatClickSamePiece: number;
  readonly selectionCancelCount: number;
  readonly hoverHeatmap: Readonly<Record<string, number>>;
  readonly dragDistancePx: number;
  readonly tabBlurCount: number;
  readonly hesitationIndex: number; // 0.00 - 1.00
}

export interface MoveTelemetryResult {
  readonly behavior: MoveTelemetrySnapshot;
  readonly idleBeforeFirstTouchMs: number;
}

export interface LiveTelemetryCounts {
  readonly selectionCancelCount: number;
  readonly repeatClickSamePiece: number;
  readonly totalClicks: number;
  readonly hesitationIndex: number;
  readonly idleBeforeFirstTouchMs: number;
}

export class MoveTrackerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoveTrackerError';
  }
}

// ============================================================================
// MoveTracker
// ============================================================================

export class MoveTracker {
  private turnStartedAtMs: number | null = null;
  private clockRemainingAtTurnStartMs: number | null = null;

  private pieceSelections: PieceSelectionEvent[] = [];
  private pendingIndex: number | null = null;
  private hoverHeatmap: Record<string, number> = {};
  private dragDistancePx = 0;
  private tabBlurCount = 0;
  private firstTouchAtMs: number | null = null;

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  public startMoveTurn(clockRemainingMs: number): void {
    this.turnStartedAtMs = now();
    this.clockRemainingAtTurnStartMs = clockRemainingMs;
    this.pieceSelections = [];
    this.pendingIndex = null;
    this.hoverHeatmap = {};
    this.dragDistancePx = 0;
    this.tabBlurCount = 0;
    this.firstTouchAtMs = null;
  }

  /** ดึงสถิติตัวเลขสดระหว่างกำลังคิดตา เพื่อส่งให้ PanicCalculator คำนวณแบบ Real-time */
  public getLiveCounts(currentThinkTimeMs: number = 0): LiveTelemetryCounts {
    const totalClicks = this.pieceSelections.length;
    const repeatClickSamePiece = countAdjacentRepeats(this.pieceSelections);
    const selectionCancelCount = this.pieceSelections.filter((s) => s.cancelled).length;
    const idleBeforeFirstTouchMs = this.firstTouchAtMs ?? currentThinkTimeMs;

    const hesitationIndex = this.computeHesitationIndex({
      selectionCancelCount,
      repeatClickSamePiece,
      idleBeforeFirstTouchMs,
      thinkTimeMs: currentThinkTimeMs,
    });

    return {
      selectionCancelCount,
      repeatClickSamePiece,
      totalClicks,
      hesitationIndex,
      idleBeforeFirstTouchMs,
    };
  }

  /** ปิดยอดตานี้และสรุปผลพฤติกรรมทั้งหมดออกมา พร้อมรีเซ็ต Buffer เตรียมรับตาถัดไป */
  public flushMoveTelemetry(thinkTimeMs: number, clockRemainingMs: number): MoveTelemetryResult {
    this.ensureTurnStarted('flushMoveTelemetry');

    const totalClicks = this.pieceSelections.length;
    const distinctPiecesTouched = new Set(this.pieceSelections.map((s) => s.square)).size;
    const repeatClickSamePiece = countAdjacentRepeats(this.pieceSelections);
    const selectionCancelCount = this.pieceSelections.filter((s) => s.cancelled).length;

    const idleBeforeFirstTouchMs = this.firstTouchAtMs ?? thinkTimeMs;
    const hesitationIndex = this.computeHesitationIndex({
      selectionCancelCount,
      repeatClickSamePiece,
      idleBeforeFirstTouchMs,
      thinkTimeMs,
    });

    const result: MoveTelemetryResult = {
      behavior: {
        pieceSelections: [...this.pieceSelections],
        totalClicks,
        distinctPiecesTouched,
        repeatClickSamePiece,
        selectionCancelCount,
        hoverHeatmap: { ...this.hoverHeatmap },
        dragDistancePx: Math.round(this.dragDistancePx),
        tabBlurCount: this.tabBlurCount,
        hesitationIndex,
      },
      idleBeforeFirstTouchMs,
    };

    void clockRemainingMs; // กัน unused parameter
    this.resetBuffer();
    return result;
  }

  public reset(): void {
    this.turnStartedAtMs = null;
    this.clockRemainingAtTurnStartMs = null;
    this.resetBuffer();
  }

  // --------------------------------------------------------------------------
  // Recording
  // --------------------------------------------------------------------------

  public recordSelect(square: Square): void {
    this.ensureTurnStarted('recordSelect');
    this.markPendingCancelled();

    const atMs = this.elapsedSinceTurnStart();
    this.pieceSelections.push({ square, atMs, cancelled: false });
    this.pendingIndex = this.pieceSelections.length - 1;
    if (this.firstTouchAtMs === null) this.firstTouchAtMs = atMs;
  }

  public recordCancel(square: Square): void {
    this.ensureTurnStarted('recordCancel');

    if (this.pendingIndex !== null) {
      this.markPendingCancelled();
      return;
    }

    const atMs = this.elapsedSinceTurnStart();
    this.pieceSelections.push({ square, atMs, cancelled: true });
    if (this.firstTouchAtMs === null) this.firstTouchAtMs = atMs;
  }

  public recordHover(square: Square, ms: number): void {
    this.ensureTurnStarted('recordHover');
    if (ms <= 0) return;
    this.hoverHeatmap[square] = (this.hoverHeatmap[square] ?? 0) + ms;
  }

  public recordBlur(): void {
    this.ensureTurnStarted('recordBlur');
    this.tabBlurCount += 1;
  }

  public recordDragDistance(px: number): void {
    this.ensureTurnStarted('recordDragDistance');
    if (px <= 0) return;
    this.dragDistancePx += px;
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private computeHesitationIndex(input: {
    readonly selectionCancelCount: number;
    readonly repeatClickSamePiece: number;
    readonly idleBeforeFirstTouchMs: number;
    readonly thinkTimeMs: number;
  }): number {
    const cancelPart = clamp01(input.selectionCancelCount / 4);
    const repeatPart = clamp01(input.repeatClickSamePiece / 3);
    const idleRatio = input.thinkTimeMs > 0 ? input.idleBeforeFirstTouchMs / input.thinkTimeMs : 0;
    const idlePart = clamp01(idleRatio / 0.5);

    return Math.round((0.45 * cancelPart + 0.3 * repeatPart + 0.25 * idlePart) * 100) / 100;
  }

  private markPendingCancelled(): void {
    if (this.pendingIndex === null) return;
    const prev = this.pieceSelections[this.pendingIndex];
    this.pieceSelections[this.pendingIndex] = { ...prev, cancelled: true };
    this.pendingIndex = null;
  }

  private resetBuffer(): void {
    this.pieceSelections = [];
    this.pendingIndex = null;
    this.hoverHeatmap = {};
    this.dragDistancePx = 0;
    this.tabBlurCount = 0;
    this.firstTouchAtMs = null;
    this.turnStartedAtMs = now();
  }

  private ensureTurnStarted(methodName: string): void {
    if (this.turnStartedAtMs === null) {
      this.turnStartedAtMs = now();
    }
  }

  private elapsedSinceTurnStart(): number {
    if (this.turnStartedAtMs === null) return 0;
    return Math.max(0, now() - this.turnStartedAtMs);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function countAdjacentRepeats(selections: readonly PieceSelectionEvent[]): number {
  let count = 0;
  for (let i = 1; i < selections.length; i += 1) {
    if (selections[i].square === selections[i - 1].square) count += 1;
  }
  return count;
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}