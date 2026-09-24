/**
 * MindMeltCalculator.ts
 * ---------------------------------------------------------------------------
 * คำนวณข้อมูลสำหรับ "Grandmaster Mind-Melting Mode" — โหมดที่แสดงให้ผู้เล่นเห็น
 * ว่ากระดานหน้าตาเป็นอย่างไรในสายตาของ engine ระดับสูง: (1) heatmap ว่าช่องไหน
 * ถูกคุม/ปะทะกันเข้มข้นแค่ไหน และ (2) "ghost pieces" — ภาพจางๆ ของตัวหมากที่
 * engine มองว่าจะไปประจำการในอีก 2-3 ตาข้างหน้าตาม PV ที่ลึกที่สุด
 *
 * ไฟล์นี้เป็น pure calculator — ไม่แตะ DOM/React ตามกฎ dependency ของ core/
 * และไม่เรียก engine เอง (รับ candidateLines ที่ EnginePool วิเคราะห์มาแล้วเข้ามา
 * เป็น input เท่านั้น)
 *
 * ⚠️ แก้ import ที่ระบุมาในโจทย์: `Square` **ไม่ได้ถูก export จาก
 * `../chess/GameEngine`** จริง (ไฟล์นั้น import `Square` มาจาก chess.js ใช้
 * ภายในเท่านั้น ไม่มีบรรทัด `export type { Square }`) — ไฟล์นี้จึง import
 * `Square` ตรงจาก `chess.js` แทน ส่วน `PieceSymbol` ยัง import จาก
 * `../chess/GameEngine` ได้ตามเดิมเพราะเป็น export จริงของไฟล์นั้น
 *
 * ⚠️ ข้อสมมติเรื่อง chess.js API: `calculateSquareControl()` ใช้เมธอด
 * `.attackers(square, color)` ซึ่งมีอยู่จริงใน chess.js v1.x (คืนรายชื่อช่องของ
 * หมากสี color ทั้งหมดที่ปะทะช่องที่ระบุ) ถ้าเวอร์ชัน chess.js ที่ติดตั้งจริงใน
 * โปรเจกต์ไม่มีเมธอดนี้ (เช่นถูก downgrade ต่ำกว่า 1.0) ต้องแก้เฉพาะฟังก์ชัน
 * `countAttackers()` ด้านล่างจุดเดียว ส่วนอื่นของไฟล์ไม่กระทบ
 * ---------------------------------------------------------------------------
 */

import { Chess, type Square } from 'chess.js';
import type { PieceSymbol } from '../chess/GameEngine';
import type { UciInfo } from '../engine/UciProtocol';

// ============================================================================
// Types
// ============================================================================

export interface SquareControlValue {
  readonly square: Square;
  /** 0.0 (ไม่มีใครคุมเลย) ถึง 1.0 (ถูกคุม/ปะทะเข้มข้นที่สุดในกระดานนี้) — normalize เทียบกับช่องอื่นบนกระดานเดียวกันเสมอ ไม่ใช่ค่าตายตัวข้ามตำแหน่ง */
  readonly controlIntensity: number;
  /** +1.0 = ขาวคุมเบ็ดเสร็จ, -1.0 = ดำคุมเบ็ดเสร็จ, 0 = สมดุลกันพอดี */
  readonly controlBalance: number;
  readonly whiteAttackerCount: number;
  readonly blackAttackerCount: number;
  /** true ถ้าช่องนี้ปรากฏเป็นช่องปลายทางของตาใดตาหนึ่งในช่วงต้นของ PV อย่างน้อยหนึ่งสาย — บ่งบอกว่า engine มองว่าเป็นช่องยุทธศาสตร์สำคัญ ไม่ใช่แค่คำนวณ geometry ผิวเผิน */
  readonly appearsInEngineLines: boolean;
}

/** map ครบ 64 ช่องเสมอ — ใช้ Record คู่กับ Square (union literal ของ chess.js) เพื่อการันตีความครบถ้วนตอน compile time */
export type SquareControlMap = Readonly<Record<Square, SquareControlValue>>;

export interface GhostPiece {
  readonly from: Square;
  readonly to: Square;
  readonly piece: PieceSymbol;
  /** ลำดับความลึกของตานี้ในสาย PV เริ่มที่ 1 (ตาถัดไปตามสายนี้) */
  readonly plyOffset: number;
  /** 0.0-1.0 ความเข้มของภาพ ghost — ลดหลั่นตามความลึก (ยิ่งลึกยิ่งไม่แน่นอน) และอันดับของ candidate line (สายที่ engine มั่นใจกว่าเข้มกว่า) */
  readonly intensity: number;
}

export interface MindMeltCalculatorConfig {
  /** จำนวนครึ่งตาแรกของแต่ละ PV ที่นับเป็น "ช่องสำคัญตามสายตา engine" สำหรับ heatmap — ค่าเริ่มต้น 4 */
  readonly engineHighlightLookaheadPlies?: number;
  /** สัดส่วน (0-1) ที่ intensity ของช่องซึ่งปรากฏใน engine PV จะถูกยกขึ้นเพิ่มจาก baseline ทาง geometry — ค่าเริ่มต้น 0.35 */
  readonly engineHighlightBoost?: number;
  /** จำนวนตาสูงสุดที่จะสร้างเป็น ghost piece ต่อหนึ่งสาย PV (ตามสเปก "2-3 ตา") — ค่าเริ่มต้น 3 */
  readonly ghostMaxPlies?: number;
  /** จำนวน candidate line สูงสุดที่จะนำมาสร้าง ghost piece พร้อมกัน — ค่าเริ่มต้น 1 (เอาเฉพาะสายที่ engine มั่นใจที่สุด กันกระดานรกด้วยหลายสายซ้อนกัน) */
  readonly ghostMaxLines?: number;
}

export class MindMeltCalculatorError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'MindMeltCalculatorError';
  }
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: Required<MindMeltCalculatorConfig> = {
  engineHighlightLookaheadPlies: 4,
  engineHighlightBoost: 0.35,
  ghostMaxPlies: 3,
  ghostMaxLines: 1,
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

const ALL_SQUARES: readonly Square[] = buildAllSquares();

function buildAllSquares(): readonly Square[] {
  const squares: Square[] = [];
  for (const rank of RANKS) {
    for (const file of FILES) {
      squares.push(`${file}${rank}` as Square);
    }
  }
  return squares;
}

// ============================================================================
// MindMeltCalculator
// ============================================================================

export class MindMeltCalculator {
  private readonly config: Required<MindMeltCalculatorConfig>;

  constructor(config: MindMeltCalculatorConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * คำนวณ heatmap การคุมพื้นที่ทั้ง 64 ช่องจากตำแหน่งปัจจุบัน (geometry ของหมากบนกระดาน)
   * ผสมกับสัญญาณจาก candidate line ของ engine (ช่องที่ปรากฏใน PV ลึกๆ ถือว่าสำคัญเชิงยุทธศาสตร์
   * แม้ตอนนี้จะยังไม่มีหมากเล็งอยู่มากก็ตาม)
   */
  public calculateSquareControl(fen: string, candidateLines: readonly UciInfo[]): SquareControlMap {
    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch (err) {
      throw new MindMeltCalculatorError(`FEN ไม่ถูกต้อง: "${fen}"`, err);
    }

    const engineHighlightedSquares = this.collectEngineHighlightedSquares(candidateLines);

    const rawCounts = ALL_SQUARES.map((square) => ({
      square,
      whiteAttackerCount: countAttackers(chess, square, 'w'),
      blackAttackerCount: countAttackers(chess, square, 'b'),
    }));

    const maxTotalAttackers = Math.max(1, ...rawCounts.map((entry) => entry.whiteAttackerCount + entry.blackAttackerCount));

    const result = {} as Record<Square, SquareControlValue>;

    for (const entry of rawCounts) {
      const totalAttackers = entry.whiteAttackerCount + entry.blackAttackerCount;
      const baseIntensity = totalAttackers / maxTotalAttackers;
      const appearsInEngineLines = engineHighlightedSquares.has(entry.square);

      // ช่องที่ engine เล็งไว้ใน PV ได้รับการ "ยก" intensity ขึ้นตามสัดส่วน boost ที่ตั้งไว้
      // แม้ค่าจาก geometry (จำนวนหมากที่เล็งอยู่ตอนนี้) จะต่ำ เพราะความสำคัญเชิงยุทธศาสตร์
      // ของช่องหนึ่งไม่ได้ขึ้นกับจำนวนหมากที่เล็งอยู่ ณ ขณะนี้เพียงอย่างเดียว
      const intensity = appearsInEngineLines
        ? clamp01(baseIntensity * (1 - this.config.engineHighlightBoost) + this.config.engineHighlightBoost)
        : clamp01(baseIntensity);

      const controlBalance =
        totalAttackers === 0
          ? 0
          : clampSigned((entry.whiteAttackerCount - entry.blackAttackerCount) / totalAttackers);

      result[entry.square] = {
        square: entry.square,
        controlIntensity: roundToTwoDecimals(intensity),
        controlBalance: roundToTwoDecimals(controlBalance),
        whiteAttackerCount: entry.whiteAttackerCount,
        blackAttackerCount: entry.blackAttackerCount,
        appearsInEngineLines,
      };
    }

    return result;
  }

  /**
   * ดึงตาเดินล่วงหน้าจาก PV ของ candidate line มาสร้างเป็น "ghost piece" — จำลองการเล่นตาม
   * PV บน chess.js instance แยกต่างหาก (clone จาก currentFen) เพื่อรู้ว่าตัวหมากที่ขยับใน
   * แต่ละก้าวของ PV คือตัวอะไร (ข้อมูลนี้ไม่ได้อยู่ใน UCI move string ตรงๆ ต้อง replay บนกระดานจริง)
   */
  public extractGhostPieces(candidateLines: readonly UciInfo[], currentFen: string): readonly GhostPiece[] {
    const rankedLines = [...candidateLines]
      .filter((line) => (line.pv?.length ?? 0) > 0)
      .sort((a, b) => (a.multipv ?? Number.MAX_SAFE_INTEGER) - (b.multipv ?? Number.MAX_SAFE_INTEGER))
      .slice(0, this.config.ghostMaxLines);

    const ghostPieces: GhostPiece[] = [];

    rankedLines.forEach((line, lineIndex) => {
      ghostPieces.push(...this.extractGhostPiecesForLine(line, currentFen, lineIndex));
    });

    return ghostPieces;
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private extractGhostPiecesForLine(line: UciInfo, currentFen: string, lineIndex: number): readonly GhostPiece[] {
    const pv = line.pv ?? [];
    const pliesToSimulate = Math.min(this.config.ghostMaxPlies, pv.length);
    if (pliesToSimulate === 0) return [];

    let chess: Chess;
    try {
      chess = new Chess(currentFen);
    } catch (err) {
      throw new MindMeltCalculatorError(`FEN ไม่ถูกต้อง: "${currentFen}"`, err);
    }

    const ghostPieces: GhostPiece[] = [];

    for (let plyIndex = 0; plyIndex < pliesToSimulate; plyIndex += 1) {
      const uciMove = pv[plyIndex];
      const parsedMove = parseUciMove(uciMove);
      if (!parsedMove) break; // string ผิดรูปแบบ UCI — หยุดสายนี้ไว้เท่าที่ทำได้ ไม่ throw เพราะสายอื่นอาจยังใช้ได้

      const pieceBeforeMove = chess.get(parsedMove.from);
      if (!pieceBeforeMove) break; // PV ไม่สอดคล้องกับตำแหน่งจำลอง (transposition หรือ FEN ไม่ตรงตอนวิเคราะห์) — หยุดสายนี้

      let moveApplied = false;
      try {
        chess.move(
          parsedMove.promotion
            ? { from: parsedMove.from, to: parsedMove.to, promotion: parsedMove.promotion }
            : { from: parsedMove.from, to: parsedMove.to },
        );
        moveApplied = true;
      } catch {
        moveApplied = false;
      }
      if (!moveApplied) break; // ตาที่เหลือใน PV เดินต่อไม่ได้ในกระดานจำลองนี้ — หยุดสายนี้ไว้เท่าที่ทำได้

      const plyOffset = plyIndex + 1;
      const lineConfidenceFactor = 1 / (lineIndex + 1); // สายที่ engine จัดอันดับดีกว่า (multipv น้อยกว่า) มีน้ำหนักสูงกว่า
      const depthDecayFactor = 1 / plyOffset; // ยิ่งลึกยิ่งไม่แน่นอน ลดความเข้มของภาพ ghost ลง

      ghostPieces.push({
        from: parsedMove.from,
        to: parsedMove.to,
        piece: pieceBeforeMove.type,
        plyOffset,
        intensity: roundToTwoDecimals(clamp01(lineConfidenceFactor * depthDecayFactor)),
      });
    }

    return ghostPieces;
  }

  private collectEngineHighlightedSquares(candidateLines: readonly UciInfo[]): ReadonlySet<Square> {
    const squares = new Set<Square>();

    for (const line of candidateLines) {
      const pv = line.pv ?? [];
      const relevantMoves = pv.slice(0, this.config.engineHighlightLookaheadPlies);
      for (const move of relevantMoves) {
        const parsed = parseUciMove(move);
        if (parsed) squares.add(parsed.to);
      }
    }

    return squares;
  }
}

// ============================================================================
// Helpers
// ============================================================================

interface ParsedUciMove {
  readonly from: Square;
  readonly to: Square;
  readonly promotion?: 'n' | 'b' | 'r' | 'q';
}

const UCI_MOVE_PATTERN = /^([a-h][1-8])([a-h][1-8])([nbrq])?$/;

function parseUciMove(uciMove: string): ParsedUciMove | null {
  const match = UCI_MOVE_PATTERN.exec(uciMove);
  if (!match) return null;
  const [, from, to, promotion] = match;
  return promotion
    ? { from: from as Square, to: to as Square, promotion: promotion as 'n' | 'b' | 'r' | 'q' }
    : { from: from as Square, to: to as Square };
}

/** ห่อ chess.js `.attackers()` ไว้จุดเดียว — ดูหมายเหตุเรื่องข้อสมมติ chess.js API บนหัวไฟล์ */
function countAttackers(chess: Chess, square: Square, color: 'w' | 'b'): number {
  return chess.attackers(square, color).length;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampSigned(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
