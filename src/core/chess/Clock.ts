/**
 * Clock.ts
 * ---------------------------------------------------------------------------
 * นาฬิกาหมากรุกแบบ timestamp-based — อ้างอิง performance.now() (Monotonic clock)
 * คำนวณเวลาคงเหลือสดทุกครั้ง ปลอดบั๊ก Double-Subtraction และรองรับ Fischer increment
 * ---------------------------------------------------------------------------
 */

// ============================================================================
// Types
// ============================================================================

export type ClockColor = 'w' | 'b';

export type ClockPhase = 'not_started' | 'running' | 'paused' | 'flagged' | 'stopped';

/** ค่าตั้งต้นของนาฬิกา — รองรับ Fischer increment (เช่น "10+5" = base 10 นาที, increment 5 วินาที) */
export interface ClockConfig {
  readonly baseMs: number;
  readonly incrementMs: number;
  readonly incrementMode?: 'fischer';
}

/** สแนปช็อตของเวลาคงเหลือ ณ ขณะที่ถูกอ่าน — คำนวณสดทุกครั้ง ไม่ cache */
export interface ClockSnapshot {
  readonly whiteRemainingMs: number;
  readonly blackRemainingMs: number;
  readonly activeColor: ClockColor | null; // null เมื่อยังไม่เริ่มหรือหยุดแล้ว
  readonly phase: ClockPhase;
  /** เวลา (ms) ที่ฝ่าย active ใช้ไปแล้วในตานี้ ณ ขณะนี้ — สำหรับ telemetry thinkTimeMs */
  readonly elapsedInCurrentTurnMs: number;
}

export type FlagFallListener = (color: ClockColor) => void;
export type TickListener = (snapshot: ClockSnapshot) => void;

const DEFAULT_TICK_INTERVAL_MS = 100;

export class ClockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClockError';
  }
}

// ============================================================================
// Clock
// ============================================================================

export class Clock {
  private readonly config: ClockConfig;

  private whiteRemainingMs: number;
  private blackRemainingMs: number;

  private phase: ClockPhase = 'not_started';
  private activeColor: ClockColor | null = null;

  /** timestamp (จาก performance.now()) ที่ฝ่าย active เริ่มคิดตาปัจจุบัน — null เมื่อ paused/not_started/flagged/stopped */
  private turnStartedAtMs: number | null = null;

  private tickIntervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly tickIntervalMs: number;

  private readonly tickListeners = new Set<TickListener>();
  private readonly flagFallListeners = new Set<FlagFallListener>();

  constructor(config: ClockConfig, options: { readonly tickIntervalMs?: number } = {}) {
    if (config.baseMs <= 0) {
      throw new ClockError(`baseMs must be positive, got ${config.baseMs}`);
    }
    if (config.incrementMs < 0) {
      throw new ClockError(`incrementMs must not be negative, got ${config.incrementMs}`);
    }

    this.config = config;
    this.whiteRemainingMs = config.baseMs;
    this.blackRemainingMs = config.baseMs;
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /** เริ่มนาฬิกาครั้งแรกของเกม — ฝ่ายที่ระบุจะเริ่มถูกนับเวลาทันที (ปกติคือฝ่ายขาว) */
  public start(startingColor: ClockColor = 'w'): void {
    if (this.phase !== 'not_started') {
      throw new ClockError(`Cannot start(): clock is already in phase "${this.phase}"`);
    }
    this.activeColor = startingColor;
    this.turnStartedAtMs = now();
    this.phase = 'running';
    this.startTicking();
  }

  /**
   * แจ้งว่าฝ่าย active เดินเสร็จแล้ว — หักเวลาที่ใช้ไปจริงออกจากฝ่ายนั้น บวก
   * increment กลับให้ (Fischer) แล้วสลับตาไปอีกฝ่าย พร้อม reset จุดเริ่มนับใหม่
   */
  public commitMove(): void {
    this.assertRunning('commitMove');
    const color = this.activeColor as ClockColor;

    // getRemainingMsFor หักลบ elapsed ให้แล้ว นำมาบวก increment ได้ทันที (ปลอดบั๊ก Double-Subtraction)
    const remaining = this.getRemainingMsFor(color) + this.config.incrementMs;
    this.setRemainingMsFor(color, Math.max(0, remaining));

    if (remaining <= 0) {
      this.triggerFlagFall(color);
      return;
    }

    const nextColor: ClockColor = color === 'w' ? 'b' : 'w';
    this.activeColor = nextColor;
    this.turnStartedAtMs = now();
    this.emitTick();
  }

  /** พักนาฬิกาทั้งคู่ — freeze เวลาคงเหลือสด ณ วินาทีนั้นไว้ */
  public pause(): void {
    if (this.phase !== 'running') {
      throw new ClockError(`Cannot pause(): clock is in phase "${this.phase}", expected "running"`);
    }
    const color = this.activeColor as ClockColor;

    // Freeze ค่าเวลาที่คำนวณสด
    this.setRemainingMsFor(color, this.getRemainingMsFor(color));

    this.phase = 'paused';
    this.turnStartedAtMs = null;
    this.stopTicking();
    this.emitTick();

    if (this.getRemainingMsFor(color) <= 0) {
      this.triggerFlagFall(color);
    }
  }

  /** เดินนาฬิกาต่อจากจุดที่ pause ไว้ — ฝ่ายเดิมยังคงเป็นฝ่าย active */
  public resume(): void {
    if (this.phase !== 'paused') {
      throw new ClockError(`Cannot resume(): clock is in phase "${this.phase}", expected "paused"`);
    }
    this.turnStartedAtMs = now();
    this.phase = 'running';
    this.startTicking();
  }

  /** หยุดนาฬิกาถาวร (เกมจบแล้วด้วยเหตุผลอื่นที่ไม่ใช่หมดเวลา เช่น checkmate/resign) */
  public stop(): void {
    if (this.phase === 'running') {
      const color = this.activeColor as ClockColor;
      this.setRemainingMsFor(color, this.getRemainingMsFor(color));
    }
    this.phase = 'stopped';
    this.turnStartedAtMs = null;
    this.stopTicking();
    this.emitTick();
  }

  public dispose(): void {
    this.stopTicking();
    this.tickListeners.clear();
    this.flagFallListeners.clear();
  }

  // --------------------------------------------------------------------------
  // Reading state
  // --------------------------------------------------------------------------

  public getSnapshot(): ClockSnapshot {
    return {
      whiteRemainingMs: this.getRemainingMsFor('w'),
      blackRemainingMs: this.getRemainingMsFor('b'),
      activeColor: this.activeColor,
      phase: this.phase,
      elapsedInCurrentTurnMs: this.getElapsedInCurrentTurnMs(),
    };
  }

  /** เวลาคงเหลือของฝ่ายที่ระบุ ณ ขณะนี้ — ถ้าเป็นฝ่าย active และนาฬิกากำลังเดิน จะหักเวลาที่ผ่านไปแล้วให้อัตโนมัติ */
  public getRemainingMsFor(color: ClockColor): number {
    const base = color === 'w' ? this.whiteRemainingMs : this.blackRemainingMs;
    if (this.phase === 'running' && this.activeColor === color) {
      return Math.max(0, base - this.getElapsedInCurrentTurnMs());
    }
    return base;
  }

  private setRemainingMsFor(color: ClockColor, value: number): void {
    if (color === 'w') this.whiteRemainingMs = value;
    else this.blackRemainingMs = value;
  }

  /** เวลาที่ฝ่าย active ใช้ไปแล้วในตาปัจจุบัน — คำนวณสดจาก performance.now() เสมอ ไม่มี accumulated drift */
  public getElapsedInCurrentTurnMs(): number {
    if (this.turnStartedAtMs === null) return 0;
    return Math.max(0, now() - this.turnStartedAtMs);
  }

  public getPhase(): ClockPhase {
    return this.phase;
  }

  public getActiveColor(): ClockColor | null {
    return this.activeColor;
  }

  public getConfig(): ClockConfig {
    return this.config;
  }

  // --------------------------------------------------------------------------
  // Listeners
  // --------------------------------------------------------------------------

  public onTick(listener: TickListener): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  public onFlagFall(listener: FlagFallListener): () => void {
    this.flagFallListeners.add(listener);
    return () => this.flagFallListeners.delete(listener);
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private assertRunning(methodName: string): void {
    if (this.phase !== 'running' || this.activeColor === null) {
      throw new ClockError(`Cannot ${methodName}(): clock is in phase "${this.phase}", expected "running"`);
    }
  }

  private startTicking(): void {
    this.stopTicking();
    this.tickIntervalHandle = setInterval(() => {
      this.checkFlagFallDuringTick();
      this.emitTick();
    }, this.tickIntervalMs);
  }

  private stopTicking(): void {
    if (this.tickIntervalHandle !== null) {
      clearInterval(this.tickIntervalHandle);
      this.tickIntervalHandle = null;
    }
  }

  private checkFlagFallDuringTick(): void {
    if (this.phase !== 'running' || this.activeColor === null) return;
    if (this.getRemainingMsFor(this.activeColor) <= 0) {
      const color = this.activeColor;
      this.setRemainingMsFor(color, 0);
      this.triggerFlagFall(color);
    }
  }

  private triggerFlagFall(color: ClockColor): void {
    this.phase = 'flagged';
    this.turnStartedAtMs = null;
    this.stopTicking();
    this.emitTick();
    for (const listener of this.flagFallListeners) {
      listener(color);
    }
  }

  private emitTick(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.tickListeners) {
      listener(snapshot);
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

// ============================================================================
// Preset helper
// ============================================================================

export function parseTimeControlNotation(notation: string): ClockConfig {
  const match = /^(\d+)\+(\d+)$/.exec(notation.trim());
  if (!match) {
    throw new ClockError(`Invalid time control notation: "${notation}" (expected format like "10+5")`);
  }
  const baseMinutes = Number.parseInt(match[1], 10);
  const incrementSeconds = Number.parseInt(match[2], 10);
  return {
    baseMs: baseMinutes * 60_000,
    incrementMs: incrementSeconds * 1000,
    incrementMode: 'fischer',
  };
}