/**
 * UciProtocol.ts
 * ---------------------------------------------------------------------------
 * Parser บริสุทธิ์สำหรับข้อความโปรโตคอล UCI (Universal Chess Interface)
 * ที่ Stockfish (หรือ engine ที่รองรับ UCI ตัวอื่น) ส่งออกมาทาง stdout
 *
 * ไฟล์นี้ "ไม่มี" side effect ใดๆ ทั้งสิ้น — ไม่แตะ Worker, ไม่แตะ DOM
 * รับ string เข้า คืน object ที่ type-safe ออก ทดสอบได้ล้วนๆ ด้วย unit test
 *
 * อ้างอิงสเปก: https://www.chessprogramming.org/UCI
 * ---------------------------------------------------------------------------
 */

// ============================================================================
// Types
// ============================================================================

/** คะแนนประเมินตำแหน่ง — เป็นได้ทั้ง centipawn หรือ mate-in-N */
export type UciScore =
  | { readonly kind: 'cp'; readonly value: number }
  | { readonly kind: 'mate'; readonly value: number };

/** หนึ่งบรรทัดข้อมูล "info" ที่ engine รายงานระหว่างคิด (อาจมาหลายบรรทัดต่อ 1 ตา) */
export interface UciInfo {
  readonly depth?: number;
  readonly seldepth?: number;
  /** ลำดับสายใน MultiPV (1 = สายหลัก/ดีที่สุด) */
  readonly multipv?: number;
  readonly score?: UciScore;
  /** true เมื่อ engine บอกว่าคะแนนนี้เป็นขอบล่าง (lowerbound) หรือขอบบน (upperbound) ของการค้นหาที่ยังไม่เสร็จ */
  readonly scoreBound?: 'lowerbound' | 'upperbound';
  readonly nodes?: number;
  readonly nps?: number;
  readonly hashfull?: number;
  readonly tbhits?: number;
  readonly timeMs?: number;
  /** Principal Variation — ลำดับตาที่ engine คาดว่าจะเกิดขึ้น (UCI notation เช่น "e2e4") */
  readonly pv?: readonly string[];
  /** ข้อความอิสระ เช่น "currmove e2e4 currmovenumber 3" ที่ parse เจาะจงไม่ได้ */
  readonly currMove?: string;
  readonly currMoveNumber?: number;
  readonly string?: string;
  /** บรรทัดดิบต้นฉบับ เผื่อ debug หรือ log */
  readonly raw: string;
}

/** ข้อความ "bestmove" — engine ตัดสินใจแล้วว่าจะเดินตัวไหน */
export interface UciBestMove {
  readonly bestMove: string; // UCI move เช่น "e2e4" หรือ "e7e8q" (promotion) หรือ "(none)"
  /** ตาที่ engine คาดว่าฝ่ายตรงข้ามจะตอบ (ถ้ามี) */
  readonly ponderMove?: string;
  readonly raw: string;
}

/** ตัวเลือก UCI option หนึ่งตัวที่ engine ประกาศตอน "uciok" (จาก "option name ... type ...") */
export interface UciOptionSpec {
  readonly name: string;
  readonly type: 'check' | 'spin' | 'combo' | 'button' | 'string';
  readonly default?: string;
  readonly min?: number;
  readonly max?: number;
  readonly vars?: readonly string[];
  readonly raw: string;
}

/** ผลลัพธ์การ parse หนึ่งบรรทัด — discriminated union ให้ exhaustive switch ได้ */
export type UciMessage =
  | { readonly type: 'id'; readonly key: 'name' | 'author'; readonly value: string; readonly raw: string }
  | { readonly type: 'uciok'; readonly raw: string }
  | { readonly type: 'readyok'; readonly raw: string }
  | { readonly type: 'option'; readonly option: UciOptionSpec; readonly raw: string }
  | { readonly type: 'info'; readonly info: UciInfo; readonly raw: string }
  | { readonly type: 'bestmove'; readonly bestMove: UciBestMove; readonly raw: string }
  | { readonly type: 'unknown'; readonly raw: string };

// ============================================================================
// Tokenizer helper
// ============================================================================

/** แตก string ด้วย whitespace แบบไม่มี empty token ปนมา */
function tokenize(line: string): string[] {
  return line.trim().split(/\s+/).filter((t) => t.length > 0);
}

// ============================================================================
// Parser: "info ..."
// ============================================================================

/**
 * Parse บรรทัด "info depth 18 seldepth 24 multipv 1 score cp 34 nodes 1234567
 *   nps 987654 hashfull 234 tbhits 0 time 1250 pv e2e4 e7e5 g1f3 ..."
 *
 * โครงสร้างของ UCI "info" เป็นแบบ key-driven ที่ลำดับไม่ตายตัว และ token สุดท้าย
 * ของ key บางตัว (โดยเฉพาะ "pv" และ "string") กินทุก token ที่เหลือทั้งหมด
 * จึงต้อง parse แบบ stateful เดินหน้าไปทีละ token
 */
function parseInfo(line: string, raw: string): UciInfo | null {
  const tokens = tokenize(line);
  // tokens[0] === "info"
  if (tokens[0] !== 'info') return null;

  let depth: number | undefined;
  let seldepth: number | undefined;
  let multipv: number | undefined;
  let score: UciScore | undefined;
  let scoreBound: 'lowerbound' | 'upperbound' | undefined;
  let nodes: number | undefined;
  let nps: number | undefined;
  let hashfull: number | undefined;
  let tbhits: number | undefined;
  let timeMs: number | undefined;
  let pv: string[] | undefined;
  let currMove: string | undefined;
  let currMoveNumber: number | undefined;
  let infoString: string | undefined;

  let i = 1;
  while (i < tokens.length) {
    const key = tokens[i];

    switch (key) {
      case 'depth':
        depth = toIntOrUndefined(tokens[i + 1]);
        i += 2;
        break;

      case 'seldepth':
        seldepth = toIntOrUndefined(tokens[i + 1]);
        i += 2;
        break;

      case 'multipv':
        multipv = toIntOrUndefined(tokens[i + 1]);
        i += 2;
        break;

      case 'score': {
        // รูปแบบ: "score cp <n>" หรือ "score mate <n>" ตามด้วย "lowerbound"/"upperbound" ได้ (optional)
        const kind = tokens[i + 1];
        const value = toIntOrUndefined(tokens[i + 2]);
        if ((kind === 'cp' || kind === 'mate') && value !== undefined) {
          score = { kind, value };
        }
        i += 3;
        // เช็ค bound ต่อท้ายทันที
        if (tokens[i] === 'lowerbound' || tokens[i] === 'upperbound') {
          scoreBound = tokens[i] as 'lowerbound' | 'upperbound';
          i += 1;
        }
        break;
      }

      case 'nodes':
        nodes = toIntOrUndefined(tokens[i + 1]);
        i += 2;
        break;

      case 'nps':
        nps = toIntOrUndefined(tokens[i + 1]);
        i += 2;
        break;

      case 'hashfull':
        hashfull = toIntOrUndefined(tokens[i + 1]);
        i += 2;
        break;

      case 'tbhits':
        tbhits = toIntOrUndefined(tokens[i + 1]);
        i += 2;
        break;

      case 'time':
        timeMs = toIntOrUndefined(tokens[i + 1]);
        i += 2;
        break;

      case 'currmove':
        currMove = tokens[i + 1];
        i += 2;
        break;

      case 'currmovenumber':
        currMoveNumber = toIntOrUndefined(tokens[i + 1]);
        i += 2;
        break;

      case 'pv':
        // "pv" กิน token ที่เหลือทั้งหมดจนจบบรรทัด
        pv = tokens.slice(i + 1);
        i = tokens.length;
        break;

      case 'string':
        // "string" กิน token ที่เหลือทั้งหมดเป็นข้อความอิสระ (เช่น debug message)
        infoString = tokens.slice(i + 1).join(' ');
        i = tokens.length;
        break;

      default:
        // key ที่ไม่รู้จัก (เช่น "cpuload", "refutation", "currline" ที่พบน้อย) — ข้ามไป 1 token กันลูปค้าง
        i += 1;
        break;
    }
  }

  return {
    depth,
    seldepth,
    multipv,
    score,
    scoreBound,
    nodes,
    nps,
    hashfull,
    tbhits,
    timeMs,
    pv,
    currMove,
    currMoveNumber,
    string: infoString,
    raw,
  };
}

function toIntOrUndefined(token: string | undefined): number | undefined {
  if (token === undefined) return undefined;
  const n = Number.parseInt(token, 10);
  return Number.isNaN(n) ? undefined : n;
}

// ============================================================================
// Parser: "bestmove ..."
// ============================================================================

function parseBestMove(line: string, raw: string): UciBestMove | null {
  const tokens = tokenize(line);
  if (tokens[0] !== 'bestmove') return null;

  const bestMove = tokens[1];
  if (bestMove === undefined) return null;

  let ponderMove: string | undefined;
  const ponderIdx = tokens.indexOf('ponder');
  if (ponderIdx !== -1 && tokens[ponderIdx + 1] !== undefined) {
    ponderMove = tokens[ponderIdx + 1];
  }

  return { bestMove, ponderMove, raw };
}

// ============================================================================
// Parser: "option name ... type ..."
// ============================================================================

function parseOption(line: string, raw: string): UciOptionSpec | null {
  const tokens = tokenize(line);
  if (tokens[0] !== 'option') return null;

  let name = '';
  let type: UciOptionSpec['type'] | undefined;
  let def: string | undefined;
  let min: number | undefined;
  let max: number | undefined;
  const vars: string[] = [];

  let i = 1;
  while (i < tokens.length) {
    const key = tokens[i];
    switch (key) {
      case 'name': {
        // "name" กินทุก token จนกว่าจะเจอ "type" (ชื่อ option อาจมีเว้นวรรคได้ เช่น "Skill Level")
        const nameTokens: string[] = [];
        let j = i + 1;
        while (j < tokens.length && tokens[j] !== 'type') {
          nameTokens.push(tokens[j]);
          j += 1;
        }
        name = nameTokens.join(' ');
        i = j;
        break;
      }
      case 'type':
        type = tokens[i + 1] as UciOptionSpec['type'];
        i += 2;
        break;
      case 'default': {
        // default อาจว่างเปล่า (เช่น type string ที่ default เป็น "<empty>") หรือมีเว้นวรรค
        // เก็บจนกว่าจะเจอ keyword ถัดไปที่รู้จัก
        const stopKeys = new Set(['min', 'max', 'var']);
        const defTokens: string[] = [];
        let j = i + 1;
        while (j < tokens.length && !stopKeys.has(tokens[j])) {
          defTokens.push(tokens[j]);
          j += 1;
        }
        def = defTokens.join(' ');
        i = j;
        break;
      }
      case 'min':
        min = toIntOrUndefined(tokens[i + 1]);
        i += 2;
        break;
      case 'max':
        max = toIntOrUndefined(tokens[i + 1]);
        i += 2;
        break;
      case 'var':
        if (tokens[i + 1] !== undefined) vars.push(tokens[i + 1]);
        i += 2;
        break;
      default:
        i += 1;
        break;
    }
  }

  if (!type) return null;

  return {
    name,
    type,
    default: def,
    min,
    max,
    vars: vars.length > 0 ? vars : undefined,
    raw,
  };
}

// ============================================================================
// Public API: parseUciLine
// ============================================================================

/**
 * จุดเข้าเดียวของ parser — รับ 1 บรรทัดดิบจาก engine คืน UciMessage ที่ type-safe
 * ไม่โยน exception แม้บรรทัดจะผิดรูปแบบ (คืน { type: 'unknown' } แทน)
 */
export function parseUciLine(rawLine: string): UciMessage {
  const raw = rawLine; // เก็บต้นฉบับไว้เผื่อ debug ก่อน trim
  const line = rawLine.trim();

  if (line.length === 0) {
    return { type: 'unknown', raw };
  }

  if (line === 'uciok') {
    return { type: 'uciok', raw };
  }

  if (line === 'readyok') {
    return { type: 'readyok', raw };
  }

  if (line.startsWith('id name ')) {
    return { type: 'id', key: 'name', value: line.slice('id name '.length).trim(), raw };
  }

  if (line.startsWith('id author ')) {
    return { type: 'id', key: 'author', value: line.slice('id author '.length).trim(), raw };
  }

  if (line.startsWith('option ')) {
    const option = parseOption(line, raw);
    return option ? { type: 'option', option, raw } : { type: 'unknown', raw };
  }

  if (line.startsWith('info ')) {
    const info = parseInfo(line, raw);
    return info ? { type: 'info', info, raw } : { type: 'unknown', raw };
  }

  if (line.startsWith('bestmove')) {
    const bestMove = parseBestMove(line, raw);
    return bestMove ? { type: 'bestmove', bestMove, raw } : { type: 'unknown', raw };
  }

  return { type: 'unknown', raw };
}

// ============================================================================
// Utility: แปลง UciScore → win probability (0-1) ด้วยสูตร sigmoid มาตรฐานของ Lichess/Stockfish
// ============================================================================

/**
 * แปลงคะแนน centipawn/mate เป็นความน่าจะเป็นชนะของฝ่ายที่กำลังจะเดิน (side to move)
 * ใช้สูตร sigmoid ที่ Lichess ใช้จริง: winPct = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
 * mate-in-N ถูกปัดเป็นคะแนน cp สุดขั้ว (บวก/ลบตามทิศทาง) เพื่อให้กราฟไม่มีค่า infinite
 */
export function scoreToWinProbability(score: UciScore): number {
  if (score.kind === 'mate') {
    // mate เป็นบวก = ฝ่ายที่กำลังเดินจะรุกฆาตได้ → เกือบ 1.0
    // mate เป็นลบ = กำลังจะโดนรุกฆาต → เกือบ 0.0
    return score.value > 0 ? 0.99 : 0.01;
  }
  const cp = clampNumber(score.value, -1000, 1000);
  const winPct = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  return clampNumber(winPct / 100, 0, 1);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * คะแนน UciScore ที่มาจากมุมมอง "ฝ่ายที่กำลังจะเดิน" (side to move ตาม UCI spec)
 * ต้องกลับเครื่องหมายถ้าอยากได้มุมมองของฝ่ายขาวเสมอ — ฟังก์ชันนี้ช่วยทำให้ตรงไปตรงมา
 */
export function normalizeScoreToWhitePerspective(score: UciScore, sideToMove: 'w' | 'b'): UciScore {
  if (sideToMove === 'w') return score;
  return { kind: score.kind, value: -score.value } as UciScore;
}
