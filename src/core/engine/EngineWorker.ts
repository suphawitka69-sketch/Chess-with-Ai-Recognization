/**
 * EngineWorker.ts
 * ---------------------------------------------------------------------------
 * ห่อหุ้ม Web Worker ที่รัน Stockfish (WASM) ให้เป็น Promise-based API
 * แทนที่จะยิง postMessage แล้วต้องคอย onmessage เองทุกที่ ไฟล์นี้แปลง
 * โปรโตคอลแบบ command/response ของ UCI ให้เป็น async/await ธรรมดา
 *
 * หลักการออกแบบ:
 * 1. คำสั่งที่มี "จุดจบชัดเจน" ตามสเปก UCI ("uci"→"uciok", "isready"→"readyok",
 *    "go"→"bestmove") จะถูกคิวเป็น pending request แยกกัน — ห้ามคำสั่งประเภทนี้
 *    ซ้อนกันเกิน 1 คำสั่งต่อครั้ง เพราะ Stockfish เป็น single-threaded command loop
 * 2. คำสั่งที่ไม่มี response ("position", "setoption", "ucinewgame") ยิงแบบ
 *    fire-and-forget แต่ยังคง "จองคิว" เพื่อการันตีลำดับการส่ง
 * 3. ระหว่าง "go" ทำงาน จะมี "info" หลายบรรทัดไหลเข้ามาก่อนถึง "bestmove" —
 *    ส่งผ่าน callback แยกต่างหาก ไม่ปนกับ Promise หลักที่ resolve ตอน bestmove
 * ---------------------------------------------------------------------------
 */

import { parseUciLine, type UciInfo, type UciBestMove, type UciOptionSpec } from './UciProtocol';

// ============================================================================
// Types
// ============================================================================

export interface GoParams {
  /** จำกัดความลึกการค้นหา (ply) */
  readonly depth?: number;
  /** จำกัดเวลาคิดแบบตายตัว (ms) — ใช้คู่กับ movetime */
  readonly movetimeMs?: number;
  /** เวลาคงเหลือของแต่ละฝ่าย (ms) — engine จะจัดสรรเวลาเอง */
  readonly wtimeMs?: number;
  readonly btimeMs?: number;
  readonly wincMs?: number;
  readonly bincMs?: number;
  /** จำกัดจำนวนโหนดที่ค้น */
  readonly nodes?: number;
  /** ให้ค้นหาเฉพาะตาที่ระบุ (สำหรับ puzzle/trap detection) */
  readonly searchMoves?: readonly string[];
  /** ค้นหาแบบไม่มีจุดจบ จนกว่าจะสั่ง stop (ไม่ใช้ในโหมดนี้ปกติ) */
  readonly infinite?: boolean;
}

export type EngineOptionValue = string | number | boolean;

/** สถานะของ worker หนึ่งตัว ใช้ตัดสินใจว่าจะยิงคำสั่งใหม่ได้หรือยัง */
export type EngineWorkerStatus = 'uninitialized' | 'initializing' | 'idle' | 'thinking' | 'terminated' | 'error';

/** error ที่เกิดขึ้นเฉพาะทางของ engine worker — แยกจาก error ทั่วไปเพื่อ catch ได้เจาะจง */
export class EngineWorkerError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'EngineWorkerError';
  }
}

export class EngineTimeoutError extends EngineWorkerError {
  constructor(command: string, timeoutMs: number) {
    super(`Engine timed out waiting for response to "${command}" after ${timeoutMs}ms`);
    this.name = 'EngineTimeoutError';
  }
}

interface PendingRequest {
  readonly command: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly onInfo?: (info: UciInfo) => void;
  readonly timeoutHandle?: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = 5_000;

// ============================================================================
// EngineWorker
// ============================================================================

export class EngineWorker {
  private worker: Worker | null = null;
  private status: EngineWorkerStatus = 'uninitialized';

  /** คิวคำสั่งที่รอ response แบบ synchronous handshake (uciok/readyok/bestmove) */
  private pending: PendingRequest | null = null;

  private readonly collectedOptions: UciOptionSpec[] = [];
  private engineName = '';
  private engineAuthor = '';

  /** ป้องกันสองคำสั่งยิงพร้อมกัน — serialize ผ่าน promise chain */
  private commandChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly workerScriptUrl: string | URL,
    private readonly options: { readonly timeoutMs?: number; readonly label?: string } = {},
  ) {}

  public getStatus(): EngineWorkerStatus {
    return this.status;
  }

  public getEngineInfo(): { readonly name: string; readonly author: string; readonly options: readonly UciOptionSpec[] } {
    return { name: this.engineName, author: this.engineAuthor, options: this.collectedOptions };
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * สร้าง Worker จริง + ทำ UCI handshake ("uci" → รวบรวม id/option → "uciok")
   * แล้วยืนยันความพร้อมด้วย "isready" → "readyok"
   */
  public async init(): Promise<readonly UciOptionSpec[]> {
    if (this.status !== 'uninitialized') {
      throw new EngineWorkerError(`Cannot init(): worker is already in status "${this.status}"`);
    }

    this.status = 'initializing';

    try {
      this.worker = new Worker(this.workerScriptUrl, { type: 'classic' });
      this.worker.onmessage = this.handleMessage;
      this.worker.onerror = this.handleWorkerError;

      await this.sendAndWait<void>('uci', (msg) => {
        if (msg.type === 'id') {
          if (msg.key === 'name') this.engineName = msg.value;
          else this.engineAuthor = msg.value;
        } else if (msg.type === 'option') {
          this.collectedOptions.push(msg.option);
        } else if (msg.type === 'uciok') {
          return { done: true, value: undefined };
        }
        return { done: false };
      });

      await this.isReady();
      this.status = 'idle';
      return this.collectedOptions;
    } catch (err) {
      this.status = 'error';
      throw err instanceof EngineWorkerError ? err : new EngineWorkerError('Failed to initialize engine worker', err);
    }
  }

  /** ส่ง "isready" และรอ "readyok" — ใช้ sync คิวคำสั่งก่อนหน้าให้เสร็จจริง */
  public async isReady(): Promise<void> {
    await this.sendAndWait<void>(
      'isready',
      (msg) => (msg.type === 'readyok' ? { done: true, value: undefined } : { done: false }),
      READY_TIMEOUT_MS,
    );
  }

  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.pending) {
      this.pending.reject(new EngineWorkerError('Worker terminated while a command was pending'));
      this.clearPending();
    }
    this.status = 'terminated';
  }

  // --------------------------------------------------------------------------
  // Setup commands (fire-and-forget แต่เรียงคิวผ่าน commandChain)
  // --------------------------------------------------------------------------

  public setOption(name: string, value?: EngineOptionValue): Promise<void> {
    return this.enqueue(async () => {
      const valueStr = value === undefined ? '' : ` value ${String(value)}`;
      this.postRaw(`setoption name ${name}${valueStr}`);
    });
  }

  public newGame(): Promise<void> {
    return this.enqueue(async () => {
      this.postRaw('ucinewgame');
      await this.isReady(); // สเปก UCI กำหนดว่าต้องรอ readyok หลัง ucinewgame ก่อนสั่งอะไรต่อ
    });
  }

  public setPosition(fen: string, moves?: readonly string[]): Promise<void> {
    return this.enqueue(async () => {
      const movesPart = moves && moves.length > 0 ? ` moves ${moves.join(' ')}` : '';
      const fenPart = fen === 'startpos' ? 'startpos' : `fen ${fen}`;
      this.postRaw(`position ${fenPart}${movesPart}`);
    });
  }

  // --------------------------------------------------------------------------
  // Search
  // --------------------------------------------------------------------------

  /**
   * สั่งให้ engine คิดตา — resolve เมื่อได้ "bestmove"
   * onInfo จะถูกเรียกทุกครั้งที่มีบรรทัด "info" ไหลเข้ามาระหว่างคิด (สำหรับ live eval bar)
   */
  public go(params: GoParams, onInfo?: (info: UciInfo) => void): Promise<UciBestMove> {
    return this.enqueue(async () => {
      this.status = 'thinking';
      const cmd = buildGoCommand(params);

      try {
        const result = await this.sendAndWait<UciBestMove>(
          cmd,
          (msg) => {
            if (msg.type === 'info') {
              onInfo?.(msg.info);
              return { done: false };
            }
            if (msg.type === 'bestmove') {
              return { done: true, value: msg.bestMove };
            }
            return { done: false };
          },
          resolveGoTimeout(params, this.options.timeoutMs),
        );
        return result;
      } finally {
        this.status = 'idle';
      }
    });
  }

  /** สั่งหยุดคิดกลางคัน (engine จะรีบส่ง bestmove ของสิ่งที่ดีที่สุด ณ ตอนนั้นออกมา) */
  public stop(): void {
    // "stop" เป็นคำสั่งพิเศษที่ต้อง "แซงคิว" ได้ทันทีแม้ commandChain จะติด go() อยู่
    // เพราะจุดประสงค์คือไปเร่งให้ go() ที่ค้างอยู่จบเร็วขึ้น ไม่ใช่คำสั่งใหม่ที่ต้องรอคิว
    this.postRaw('stop');
  }

  // --------------------------------------------------------------------------
  // Internal: command queue
  // --------------------------------------------------------------------------

  /** ทำให้ทุกคำสั่งเรียงตามลำดับการเรียก แม้ผู้เรียกจะไม่ await กันเอง */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.commandChain.then(task, task);
    // ผูก commandChain ต่อจาก run เสมอ (แม้ task จะ throw) เพื่อไม่ให้คิวค้าง
    this.commandChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * ส่งคำสั่งดิบ 1 คำสั่งแล้วรอผลผ่าน parser callback
   * @param matcher เรียกทุกครั้งที่ parse บรรทัดใหม่ได้ — คืน { done:true, value } เมื่อถือว่าคำสั่งนี้จบ
   */
  private sendAndWait<T>(
    command: string,
    matcher: (msg: ReturnType<typeof parseUciLine>) => { done: false } | { done: true; value: T },
    timeoutMs: number = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    if (!this.worker) {
      return Promise.reject(new EngineWorkerError('Worker is not initialized'));
    }
    if (this.pending) {
      return Promise.reject(new EngineWorkerError(`Cannot send "${command}": another command is still pending`));
    }

    return new Promise<T>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.clearPending();
        reject(new EngineTimeoutError(command, timeoutMs));
      }, timeoutMs);

      this.pending = {
        command,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutHandle,
        onInfo: undefined,
      };

      // เก็บ matcher ไว้ใน closure ผ่าน handleMessage โดยอ้อม — ใช้ WeakMap-like trick
      // ด้วยการแนบ matcher เข้ากับ instance field ชั่วคราว
      this.currentMatcher = matcher as (msg: ReturnType<typeof parseUciLine>) => { done: boolean; value?: unknown };

      this.postRaw(command);
    });
  }

  // matcher ของ pending request ปัจจุบัน (ใช้คู่กับ this.pending)
  private currentMatcher: ((msg: ReturnType<typeof parseUciLine>) => { done: boolean; value?: unknown }) | null =
    null;

  private clearPending(): void {
    if (this.pending?.timeoutHandle) clearTimeout(this.pending.timeoutHandle);
    this.pending = null;
    this.currentMatcher = null;
  }

  private postRaw(command: string): void {
    if (!this.worker) throw new EngineWorkerError('Worker is not initialized');
    this.worker.postMessage(command);
  }

  // --------------------------------------------------------------------------
  // Internal: message handling
  // --------------------------------------------------------------------------

  private readonly handleMessage = (event: MessageEvent<string>): void => {
    // stockfish.js ส่งข้อมูลมาเป็น string ดิบทีละบรรทัด (บาง build ส่งมาเป็น { data: string })
    const line = typeof event.data === 'string' ? event.data : String(event.data);
    const msg = parseUciLine(line);

    if (!this.pending || !this.currentMatcher) return; // ข้อความที่ไม่มีใครรอ (log/debug) — ทิ้งเงียบๆ

    let result: { done: boolean; value?: unknown };
    try {
      result = this.currentMatcher(msg);
    } catch (err) {
      const p = this.pending;
      this.clearPending();
      p.reject(new EngineWorkerError('Matcher threw while parsing engine output', err));
      return;
    }

    if (msg.type === 'info' && result.done === false) {
      this.pending.onInfo?.(msg.info);
    }

    if (result.done) {
      const p = this.pending;
      this.clearPending();
      p.resolve(result.value);
    }
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    const err = new EngineWorkerError(
      `Worker "${this.options.label ?? this.workerScriptUrl.toString()}" crashed: ${event.message}`,
      event.error,
    );
    this.status = 'error';
    if (this.pending) {
      const p = this.pending;
      this.clearPending();
      p.reject(err);
    }
  };
}

// ============================================================================
// Helpers
// ============================================================================

function buildGoCommand(params: GoParams): string {
  const parts: string[] = ['go'];

  if (params.searchMoves && params.searchMoves.length > 0) {
    parts.push('searchmoves', params.searchMoves.join(' '));
  }
  if (params.infinite) {
    parts.push('infinite');
  }
  if (params.depth !== undefined) {
    parts.push('depth', String(params.depth));
  }
  if (params.nodes !== undefined) {
    parts.push('nodes', String(params.nodes));
  }
  if (params.movetimeMs !== undefined) {
    parts.push('movetime', String(params.movetimeMs));
  }
  if (params.wtimeMs !== undefined) parts.push('wtime', String(params.wtimeMs));
  if (params.btimeMs !== undefined) parts.push('btime', String(params.btimeMs));
  if (params.wincMs !== undefined) parts.push('winc', String(params.wincMs));
  if (params.bincMs !== undefined) parts.push('binc', String(params.bincMs));

  return parts.join(' ');
}

/** timeout ของ go() ต้องยืดหยุ่นตาม movetime/depth ที่ขอ ไม่ใช่ค่าคงที่เดียว มิฉะนั้นการวิเคราะห์ depth สูงจะ timeout ก่อนเสร็จ */
function resolveGoTimeout(params: GoParams, baseTimeoutMs: number | undefined): number {
  const base = baseTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (params.movetimeMs !== undefined) return params.movetimeMs + 10_000; // เผื่อ buffer เพิ่ม
  if (params.depth !== undefined && params.depth >= 18) return Math.max(base, 60_000);
  return base;
}
