/**
 * GameEngine.ts
 * ---------------------------------------------------------------------------
 * Wrapper ครอบ chess.js (v1.x) เพื่อ:
 *   1. ควบคุมไม่ให้โค้ดส่วนอื่นแตะ Chess instance ดิบโดยตรง (encapsulation) —
 *      กัน bug ประเภท "sandbox ไปแก้ instance ของเกมจริงโดยไม่ตั้งใจ"
 *      (ปัญหาที่ระบุไว้ใน Phase 0 §4.1 ว่าเป็นความผิดพลาดที่พบบ่อยที่สุด)
 *   2. แปลงผลลัพธ์ของ chess.js ให้เป็น domain type ของระบบเรา (MoveRecord,
 *      GameStatus) แทนที่จะกระจาย logic ตรวจจบเกมไปทั่วทั้งแอป
 *   3. ให้ UCI move string (สำหรับส่งให้ EnginePool) และ SAN (สำหรับแสดงผล)
 *      พร้อมกันเสมอ ไม่ต้องแปลงไปมาที่อื่น
 *
 * ไฟล์นี้ไม่ import React และไม่แตะ DOM — เป็นส่วนหนึ่งของ core/ ตามกฎ
 * dependency ในเอกสารสถาปัตยกรรม (features → hooks → state → core)
 * ---------------------------------------------------------------------------
 */

import { Chess, type Move as ChessJsMove, type Square } from 'chess.js';

// ============================================================================
// Types
// ============================================================================

export type PieceColor = 'w' | 'b';
export type PieceSymbol = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PromotionPiece = 'n' | 'b' | 'r' | 'q';

/** เหตุผลที่เกมจบ — ครอบเฉพาะเงื่อนไขที่ตรวจจับได้จากตัวกระดานเอง (ไม่รวม resignation/timeout ซึ่งเป็นเหตุการณ์ภายนอก) */
export type NaturalTermination =
  | 'checkmate'
  | 'stalemate'
  | 'threefold_repetition'
  | 'insufficient_material'
  | 'fifty_move_rule';

/** สถานะรวมของเกม ณ ตำแหน่งปัจจุบัน — discriminated union กัน "อ่าน winner ทั้งที่เกมยังไม่จบ" ตอน compile-time */
export type GameStatus =
  | { readonly isOver: false }
  | { readonly isOver: true; readonly termination: 'checkmate'; readonly winner: PieceColor }
  | {
      readonly isOver: true;
      readonly termination: Exclude<NaturalTermination, 'checkmate'>;
      readonly winner: 'draw';
    };

/** ข้อมูลตาเดินหนึ่งตา หลังแปลงจาก chess.js Move แล้ว — เป็น value object ที่ immutable */
export interface MoveRecord {
  readonly ply: number; // นับจาก 1, ทุกครึ่งตา (ขาว=คี่, ดำ=คู่)
  readonly moveNumber: number; // เลขตาแบบเต็ม (1 ตา = ขาว+ดำ)
  readonly color: PieceColor;
  readonly piece: PieceSymbol;
  readonly from: Square;
  readonly to: Square;
  readonly san: string; // "Nf3", "O-O", "exd5", "e8=Q#"
  readonly uci: string; // "g1f3", "e1g1", "e7d8q"
  readonly captured?: PieceSymbol;
  readonly promotion?: PromotionPiece;
  readonly flags: string; // raw flags จาก chess.js: "n","b","e","c","p","k","q"
  readonly isCapture: boolean;
  readonly isEnPassant: boolean;
  readonly isCastleKingside: boolean;
  readonly isCastleQueenside: boolean;
  readonly isPromotion: boolean;
  readonly isCheck: boolean;
  readonly isCheckmate: boolean;
  readonly fenBefore: string;
  readonly fenAfter: string;
}

/** input สำหรับสั่งเดิน — รองรับทั้ง SAN string, UCI string (from+to+promotion ต่อกัน) และ object แยกฟิลด์ */
export type MoveInput =
  | string // SAN เช่น "Nf3" หรือ UCI เช่น "g1f3" / "e7e8q"
  | { readonly from: Square; readonly to: Square; readonly promotion?: PromotionPiece };

export interface LegalMove {
  readonly san: string;
  readonly uci: string;
  readonly from: Square;
  readonly to: Square;
  readonly piece: PieceSymbol;
  readonly captured?: PieceSymbol;
  readonly promotion?: PromotionPiece;
  readonly isCapture: boolean;
}

export interface BoardSquareInfo {
  readonly square: Square;
  readonly piece: PieceSymbol;
  readonly color: PieceColor;
}

/** error เฉพาะทางของ GameEngine — แยกจาก error ของ chess.js เพื่อไม่ให้รายละเอียด implementation รั่วออกไปชั้นบน */
export class GameEngineError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'GameEngineError';
  }
}

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ============================================================================
// GameEngine
// ============================================================================

export class GameEngine {
  private readonly chess: Chess;
  /** ประวัติของเราเอง (ไม่ใช่ของ chess.js) — เก็บไว้เพราะเราแปลง Move เป็น MoveRecord ที่มีข้อมูลมากกว่า (fenBefore เป็นต้น) */
  private moveRecords: MoveRecord[] = [];

  constructor(fen: string = STARTING_FEN) {
    try {
      this.chess = new Chess(fen);
    } catch (err) {
      throw new GameEngineError(`Invalid starting FEN: "${fen}"`, err);
    }
  }

  /** สร้าง GameEngine จาก PGN ที่มีอยู่แล้ว (เช่น โหลดเกมเก่าจาก IndexedDB มาดู replay) */
  public static fromPgn(pgn: string): GameEngine {
    const engine = new GameEngine();
    try {
      engine.chess.loadPgn(pgn);
    } catch (err) {
      throw new GameEngineError('Failed to load PGN', err);
    }
    // สร้าง moveRecords ย้อนหลังจาก verbose history เพราะ loadPgn ไม่เรียก move() ของเราทีละตา
    engine.rebuildMoveRecordsFromHistory();
    return engine;
  }

  // --------------------------------------------------------------------------
  // Position accessors
  // --------------------------------------------------------------------------

  public getFen(): string {
    return this.chess.fen();
  }

  public getTurn(): PieceColor {
    return this.chess.turn();
  }

  /** ครึ่งตาปัจจุบัน (1-indexed) — เท่ากับจำนวนตาที่เดินไปแล้ว + 1 */
  public getPly(): number {
    return this.moveRecords.length + 1;
  }

  public getFullMoveNumber(): number {
    return Math.floor(this.moveRecords.length / 2) + 1;
  }

  public isCheck(): boolean {
    return this.chess.isCheck();
  }

  /** จำนวนครึ่งตาตั้งแต่การกินหมากหรือเดินเบี้ยครั้งล่าสุด — อ่านตรงจาก FEN field ที่ 5 ซึ่งเป็นแหล่งข้อมูลที่เชื่อถือได้ที่สุด ไม่พึ่งพาชื่อ method ของ library ที่อาจเปลี่ยนระหว่างเวอร์ชัน */
  public getHalfMoveClock(): number {
    const fenParts = this.chess.fen().split(' ');
    const halfMoveClockStr = fenParts[4];
    const value = halfMoveClockStr !== undefined ? Number.parseInt(halfMoveClockStr, 10) : NaN;
    return Number.isNaN(value) ? 0 : value;
  }

  /**
   * รายการหมากทั้งหมดบนกระดานพร้อมตำแหน่ง — เดินลูปเองผ่าน .get(square) ทีละช่อง
   * (แทนที่จะใช้ .board() ที่คืนเป็น 2D array ดิบซึ่งบาง build ของ chess.js ไม่แนบชื่อ
   * square มาให้ในแต่ละ cell) เพื่อให้ได้ชื่อ square ที่ถูกต้อง 100% เสมอ
   */
  public getBoard(): readonly BoardSquareInfo[] {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
    return this.collectOccupiedSquares(files);
  }

  private collectOccupiedSquares(files: readonly string[]): readonly BoardSquareInfo[] {
    const squares: BoardSquareInfo[] = [];
    for (let rank = 1; rank <= 8; rank += 1) {
      for (const file of files) {
        const square = `${file}${rank}` as Square;
        const piece = this.chess.get(square);
        if (piece) {
          squares.push({ square, piece: piece.type, color: piece.color });
        }
      }
    }
    return squares;
  }

  // --------------------------------------------------------------------------
  // Legal moves
  // --------------------------------------------------------------------------

  public getLegalMoves(fromSquare?: Square): readonly LegalMove[] {
    const verboseMoves: ChessJsMove[] = fromSquare
      ? this.chess.moves({ square: fromSquare, verbose: true })
      : this.chess.moves({ verbose: true });

    return verboseMoves.map(toLegalMove);
  }

  public getLegalMovesUci(fromSquare?: Square): readonly string[] {
    return this.getLegalMoves(fromSquare).map((m) => m.uci);
  }

  public isLegalMove(input: MoveInput): boolean {
    const normalized = normalizeMoveInputToUci(input);
    if (normalized === null) {
      // input เป็น SAN string ตรงๆ — เช็คด้วยการเทียบ san ในรายการ legal moves ทั้งหมด
      const sanInput = typeof input === 'string' ? input : null;
      if (sanInput === null) return false;
      return this.getLegalMoves().some((m) => m.san === sanInput);
    }
    return this.getLegalMoves().some((m) => m.uci === normalized);
  }

  // --------------------------------------------------------------------------
  // Making moves
  // --------------------------------------------------------------------------

  /**
   * เดินหนึ่งตา — throw GameEngineError ถ้าตาที่ส่งมาผิดกฎ
   * รับได้ทั้ง SAN ("Nf3"), UCI ("g1f3"/"e7e8q"), หรือ object { from, to, promotion }
   */
  public makeMove(input: MoveInput): MoveRecord {
    const fenBefore = this.chess.fen();
    const chessJsInput = toChessJsMoveInput(input);

    let result: ChessJsMove;
    try {
      result = this.chess.move(chessJsInput);
    } catch (err) {
      throw new GameEngineError(`Illegal move: ${describeMoveInput(input)} (position: ${fenBefore})`, err);
    }

    const fenAfter = this.chess.fen();
    const record = toMoveRecord(result, this.moveRecords.length + 1, fenBefore, fenAfter, this.chess.isCheckmate());
    this.moveRecords.push(record);
    return record;
  }

  /** ยกเลิกตาล่าสุด — คืน MoveRecord ที่ถูกยกเลิก หรือ null ถ้าไม่มีตาให้ยกเลิก */
  public undoLastMove(): MoveRecord | null {
    const undone = this.chess.undo();
    if (!undone) return null;
    return this.moveRecords.pop() ?? null;
  }

  public reset(): void {
    this.chess.reset();
    this.moveRecords = [];
  }

  /** โหลดตำแหน่งใหม่ทับของเดิมทั้งหมด (ใช้ตอน sandbox clone จาก FEN กลางเกม) — ล้าง moveRecords เพราะไม่รู้ประวัติก่อนหน้า FEN นี้ */
  public loadFen(fen: string): void {
    try {
      this.chess.load(fen);
    } catch (err) {
      throw new GameEngineError(`Invalid FEN: "${fen}"`, err);
    }
    this.moveRecords = [];
  }

  // --------------------------------------------------------------------------
  // History
  // --------------------------------------------------------------------------

  public getHistory(): readonly MoveRecord[] {
    return this.moveRecords;
  }

  /** รายการ UCI move ตั้งแต่ต้นเกม — ใช้ส่งให้ EnginePool.setPosition(fen, moves) โดยตรง */
  public getUciMoveList(): readonly string[] {
    return this.moveRecords.map((m) => m.uci);
  }

  public getPgn(): string {
    return this.chess.pgn();
  }

  private rebuildMoveRecordsFromHistory(): void {
    // ใช้ chess.js history(verbose) ไม่ได้ตรงๆ เพราะไม่มี fenBefore/fenAfter ต่อตา
    // ต้อง replay ทีละตาบน Chess instance ใหม่เพื่อเก็บ FEN แต่ละจุดให้ครบ
    const verboseHistory = this.chess.history({ verbose: true });
    const replay = new Chess();
    const records: MoveRecord[] = [];

    for (let i = 0; i < verboseHistory.length; i += 1) {
      const fenBefore = replay.fen();
      const applied = replay.move({
        from: verboseHistory[i].from,
        to: verboseHistory[i].to,
        promotion: verboseHistory[i].promotion,
      });
      const fenAfter = replay.fen();
      records.push(toMoveRecord(applied, i + 1, fenBefore, fenAfter, replay.isCheckmate()));
    }

    this.moveRecords = records;
  }

  // --------------------------------------------------------------------------
  // Game-over detection
  // --------------------------------------------------------------------------

  public isGameOver(): boolean {
    return this.getStatus().isOver;
  }

  /**
   * ตรวจสถานะจบเกมทุกแบบที่ตรวจจากตัวกระดานได้ — ลำดับการเช็คมีผล เพราะ
   * chess.js ให้ isCheckmate/isStalemate เป็น mutually exclusive อยู่แล้ว
   * แต่ threefold/insufficient-material/fifty-move อาจเป็นจริงพร้อมกันได้
   * ในบางตำแหน่ง จึงเช็คตามลำดับความสำคัญ (checkmate ต้องมาก่อนเสมอ)
   */
  public getStatus(): GameStatus {
    if (this.chess.isCheckmate()) {
      // ฝ่ายที่ถูกรุกฆาตคือฝ่ายที่ "กำลังจะเดิน" (turn()) ดังนั้นผู้ชนะคือฝ่ายตรงข้าม
      const winner: PieceColor = this.chess.turn() === 'w' ? 'b' : 'w';
      return { isOver: true, termination: 'checkmate', winner };
    }

    if (this.chess.isStalemate()) {
      return { isOver: true, termination: 'stalemate', winner: 'draw' };
    }

    if (this.chess.isInsufficientMaterial()) {
      return { isOver: true, termination: 'insufficient_material', winner: 'draw' };
    }

    if (this.chess.isThreefoldRepetition()) {
      return { isOver: true, termination: 'threefold_repetition', winner: 'draw' };
    }

    // 50-move rule = 100 ครึ่งตาโดยไม่มีการกินหมากหรือเดินเบี้ย — อ่านจาก FEN halfmove clock โดยตรง
    // (แข็งแรงกว่าการพึ่งชื่อ method ของ chess.js ที่เปลี่ยนไปมาระหว่างเวอร์ชัน)
    if (this.getHalfMoveClock() >= 100) {
      return { isOver: true, termination: 'fifty_move_rule', winner: 'draw' };
    }

    return { isOver: false };
  }

  // --------------------------------------------------------------------------
  // Cloning (สำคัญมากสำหรับ Sandbox State — ดู Phase 0 §4.1)
  // --------------------------------------------------------------------------

  /**
   * สร้าง GameEngine instance ใหม่ทั้งหมดที่มีตำแหน่งเดียวกัน แต่ "ไม่มีความสัมพันธ์"
   * กับตัวต้นฉบับอีกต่อไป — ห้ามใช้ reference เดียวกันเด็ดขาด เพราะ SandboxStore
   * ต้องลองเดินสายแยกได้โดยไม่กระทบ GameStore ของเกมจริง
   */
  public clone(): GameEngine {
    const cloned = new GameEngine(this.chess.fen());
    cloned.moveRecords = [...this.moveRecords];
    return cloned;
  }
}

// ============================================================================
// Conversion helpers (module-private, ไม่ export เพราะเป็น implementation detail)
// ============================================================================

function toLegalMove(move: ChessJsMove): LegalMove {
  return {
    san: move.san,
    uci: move.lan,
    from: move.from,
    to: move.to,
    piece: move.piece,
    captured: move.captured,
    promotion: move.promotion as PromotionPiece | undefined,
    isCapture: move.flags.includes('c') || move.flags.includes('e'),
  };
}

function toMoveRecord(
  move: ChessJsMove,
  ply: number,
  fenBefore: string,
  fenAfter: string,
  isCheckmateAfter: boolean,
): MoveRecord {
  const isEnPassant = move.flags.includes('e');
  const isCapture = move.flags.includes('c') || isEnPassant;
  const isCastleKingside = move.flags.includes('k');
  const isCastleQueenside = move.flags.includes('q');
  const isPromotion = move.flags.includes('p');
  const isCheck = move.san.includes('+') || move.san.includes('#');

  return {
    ply,
    moveNumber: Math.floor((ply - 1) / 2) + 1,
    color: move.color,
    piece: move.piece,
    from: move.from,
    to: move.to,
    san: move.san,
    uci: move.lan,
    captured: move.captured,
    promotion: move.promotion as PromotionPiece | undefined,
    flags: move.flags,
    isCapture,
    isEnPassant,
    isCastleKingside,
    isCastleQueenside,
    isPromotion,
    isCheck,
    isCheckmate: isCheckmateAfter,
    fenBefore,
    fenAfter,
  };
}

/** แปลง MoveInput ของเราเป็นรูปแบบที่ chess.js .move() ยอมรับ */
function toChessJsMoveInput(input: MoveInput): string | { from: Square; to: Square; promotion?: string } {
  if (typeof input === 'string') {
    // อาจเป็น SAN ("Nf3") หรือ UCI ("g1f3"/"e7e8q") — chess.js .move(string) รองรับเฉพาะ SAN
    // ดังนั้นถ้า string มีรูปแบบ UCI (4-5 ตัวอักษร, [a-h][1-8][a-h][1-8][qrbn]?) ให้แปลงเป็น object ก่อน
    const uciMatch = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(input);
    if (uciMatch) {
      const [, from, to, promotion] = uciMatch;
      return promotion ? { from: from as Square, to: to as Square, promotion } : { from: from as Square, to: to as Square };
    }
    return input; // ถือว่าเป็น SAN
  }
  return input.promotion ? { from: input.from, to: input.to, promotion: input.promotion } : { from: input.from, to: input.to };
}

/** คืน UCI string ถ้า input แปลงเป็น UCI ได้ตรงไปตรงมา (object หรือ UCI string) — คืน null ถ้าเป็น SAN ที่ต้องเทียบผ่าน legal moves แทน */
function normalizeMoveInputToUci(input: MoveInput): string | null {
  if (typeof input === 'object') {
    return input.promotion ? `${input.from}${input.to}${input.promotion}` : `${input.from}${input.to}`;
  }
  const uciMatch = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(input);
  return uciMatch ? input : null;
}

function describeMoveInput(input: MoveInput): string {
  if (typeof input === 'string') return input;
  return input.promotion ? `${input.from}-${input.to}=${input.promotion}` : `${input.from}-${input.to}`;
}
