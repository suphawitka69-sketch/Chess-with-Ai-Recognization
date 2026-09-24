/**
 * TrapDetector.ts
 * ---------------------------------------------------------------------------
 * เรดาร์ตรวจกับดักทางยุทธวิธีล่วงหน้า 2-3 ตา — รับ candidate moves (จาก
 * MultiPV ของตำแหน่งที่กำลังพิจารณา) พร้อม eval ตื้น (ทันทีหลังเดิน) และ
 * eval ลึก (หลังคู่ต่อสู้ตอบโต้ดีที่สุดไปอีก 2-3 ตา) แล้วฟันธงว่าตาไหน "ดูดี
 * แต่จริงๆ คือกับดัก"
 *
 * ⚠️ หมายเหตุสำคัญเรื่องขอบเขต (อ่านก่อนใช้งาน):
 *
 * 1. ไฟล์นี้ตั้งใจให้ "self-contained" — import เฉพาะ `chess.js` (แพ็กเกจ
 *    npm จริงที่เสถียร) เท่านั้น ไม่ import จาก core/engine/UciProtocol.ts
 *    หรือ core/analysis/winProbability.ts ที่มีอยู่แล้วในโปรเจกต์หลัก แม้จะ
 *    ดูเหมือนน่าจะใช้ร่วมกันได้ก็ตาม เหตุผลคือไฟล์นี้ถูกเขียนแยกเซสชันโดยไม่
 *    เห็นเนื้อไฟล์จริงของไฟล์เหล่านั้น (เห็นแค่ชื่อฟังก์ชันที่มีอยู่จาก
 *    เอกสารสรุป) การเดา signature ผิดแม้นิดเดียวจะทำให้ import พังตอนเอาไป
 *    ประกอบรวมกัน — ถ้าต้องการให้ไฟล์นี้ใช้ winProbability.ts จริงแทนที่จะมี
 *    ตรรกะ centipawn ของตัวเอง ต้องส่ง signature จริงของฟังก์ชันเหล่านั้นมา
 *    แล้วจะ refactor ให้
 * 2. การจำแนก "ชื่อรูปแบบกับดัก" (trapName) ครอบคลุมแค่ 2 รูปแบบที่ตรวจสอบ
 *    ได้จริงจากการไล่ตำแหน่งบนกระดาน: back-rank mate และ knight fork
 *    (ตรวจผ่านการนับเป้าหมายที่มีค่าจริงที่ม้าโจมตีได้ ไม่ใช่การเดา) ส่วน
 *    Skewer/Pin ที่ยกตัวอย่างไว้ในโจทย์ **ไม่ได้ถูกตรวจจับจริง** ในเวอร์ชันนี้
 *    เพราะต้องใช้การไล่เส้นโจมตี (ray tracing) ของหมากที่เดินเป็นเส้นตรง
 *    ร่วมกับตำแหน่งคิง ซึ่งซับซ้อนกว่าที่จะทำให้ถูกต้องแบบไม่มั่วในรอบนี้ —
 *    ตากับดักที่ไม่เข้าเงื่อนไข 2 แบบข้างต้นจะถูกจัดเป็น "tactical_reversal"
 *    (ระบุแค่ว่ามันเป็นกับดักจาก centipawn swing แต่ไม่ฟันธงชื่อรูปแบบเฉพาะ)
 *    แทนที่จะยัดใส่ป้าย Skewer/Fork แบบเดาสุ่ม
 * ---------------------------------------------------------------------------
 */

import { Chess, type Square } from 'chess.js';

// ============================================================================
// Public types
// ============================================================================

export type TrapPatternKind = 'back_rank_mate' | 'knight_fork' | 'tactical_reversal';
export type TrapSeverity = 'low' | 'medium' | 'critical';

export interface TrapWarning {
  readonly isTrap: boolean;
  /** ชื่อรูปแบบเป็นภาษาไทยพร้อมคำอังกฤษกำกับ — ว่างเปล่าถ้า isTrap เป็น false */
  readonly trapName: string;
  readonly severity: TrapSeverity;
  /** ช่องที่ตัวล่อ (การกินฟรี/สิ่งที่ดูน่าดึงดูด) เกิดขึ้น — คือ target square ของ trapMoveUci เอง */
  readonly baitSquare: string;
  readonly trapMoveUci: string;
  /** ลำดับตาต่อเนื่องที่ลงโทษ — เป็น SAN ถ้ามี ไม่งั้น fallback เป็น UCI ว่างเปล่าถ้า isTrap เป็น false */
  readonly punishmentLine: string[];
}

/** ตัวเลือกหนึ่งตาที่กำลังพิจารณา ณ ตำแหน่งปัจจุบัน (มาจาก MultiPV ของ engine) */
export interface CandidateLine {
  readonly moveUci: string;
  readonly moveSan: string;
  /**
   * eval มาตรฐาน (บวก = ขาวได้เปรียบเสมอ ไม่ว่าใครเป็นคนเดิน) ทันทีหลังเดิน
   * ตานี้ 1 ตา — ค่าตื้นๆ ที่ "ดูดี" ในสายตาแรก (เช่น กินฟรีดูดี๊ดี)
   */
  readonly shallowEvalCp: number;
  /**
   * eval มาตรฐานเดียวกัน แต่ลึกกว่า 2-3 ตาถัดไปหลังคู่ต่อสู้ตอบโต้ด้วยแผนที่
   * ดีที่สุด — null ถ้ายังไม่มีข้อมูลวิเคราะห์ลึกพอ (จะถูกข้ามไปเงียบๆ ไม่ใช่
   * ฟันธงว่าไม่ใช่กับดัก เพราะยังไม่มีหลักฐานพอ)
   */
  readonly deepEvalCp: number | null;
  /** UCI ของตาต่อเนื่องหลัง moveUci ที่นำไปสู่ deepEvalCp */
  readonly continuationUci: readonly string[];
  /** SAN ของตาต่อเนื่องชุดเดียวกัน (สำหรับแสดงผล) — ถ้าไม่มีให้ส่ง array ว่าง แล้วจะ fallback ไปแสดง UCI แทน */
  readonly continuationSan: readonly string[];
}

export interface TrapDetectionInput {
  /** ตำแหน่งก่อนเดิน — ใช้รู้ว่าใครเป็นฝ่ายกำลังพิจารณาตาเหล่านี้ (ฝ่ายที่อาจติดกับดัก) */
  readonly fenBeforeMove: string;
  readonly candidates: readonly CandidateLine[];
}

export interface TrapDetectorOptions {
  /** swing ขั้นต่ำ (cp, มุมมองฝ่ายที่กำลังพิจารณา) ที่ทำให้ตาดู "น่าดึงดูดตื้นๆ" พอจะเข้าข่ายพิจารณาว่าอาจเป็นกับดัก (default 150 = ประมาณเบี้ยครึ่งตัวถึงหนึ่งตัว) */
  readonly shallowAttractiveThresholdCp?: number;
  readonly lowSeveritySwingCp?: number;
  readonly mediumSeveritySwingCp?: number;
  readonly criticalSeveritySwingCp?: number;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_OPTIONS: Required<TrapDetectorOptions> = {
  shallowAttractiveThresholdCp: 150,
  lowSeveritySwingCp: 150,
  mediumSeveritySwingCp: 300,
  criticalSeveritySwingCp: 500,
};

const PIECE_VALUES: Readonly<Record<string, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** offset ของช่องที่ม้าโจมตีได้จากตำแหน่งปัจจุบัน (8 ทิศ L-shape มาตรฐาน) */
const KNIGHT_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

// ============================================================================
// TrapDetector
// ============================================================================

export class TrapDetector {
  private readonly options: Required<TrapDetectorOptions>;

  constructor(options: TrapDetectorOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * ประเมิน candidate เดียว — คืนค่า TrapWarning เสมอ (isTrap บอกผลว่าใช่/ไม่ใช่)
   * ใช้เมธอดนี้ตรงๆ ได้ถ้าต้องการเช็คทีละตา
   */
  public evaluateCandidate(fenBeforeMove: string, candidate: CandidateLine): TrapWarning {
    const notATrap: TrapWarning = {
      isTrap: false,
      trapName: '',
      severity: 'low',
      baitSquare: safeBaitSquare(candidate.moveUci),
      trapMoveUci: candidate.moveUci,
      punishmentLine: [],
    };

    if (candidate.deepEvalCp === null) return notATrap; // ข้อมูลไม่พอฟันธง

    const mover = moverColorFromFen(fenBeforeMove);
    const sign = mover === 'w' ? 1 : -1;
    const shallowForMover = candidate.shallowEvalCp * sign;
    const deepForMover = candidate.deepEvalCp * sign;

    const looksAttractive = shallowForMover >= this.options.shallowAttractiveThresholdCp;
    const swing = shallowForMover - deepForMover; // บวกมาก = จากดูดีกลายเป็นแย่ลงมาก

    if (!looksAttractive || swing < this.options.lowSeveritySwingCp) {
      return notATrap;
    }

    const severity = this.resolveSeverity(swing);
    const pattern = classifyPattern(fenBeforeMove, candidate);
    const punishmentLine = candidate.continuationSan.length > 0 ? [...candidate.continuationSan] : [...candidate.continuationUci];

    return {
      isTrap: true,
      trapName: pattern.label,
      severity,
      baitSquare: safeBaitSquare(candidate.moveUci),
      trapMoveUci: candidate.moveUci,
      punishmentLine,
    };
  }

  /** รัน evaluateCandidate กับ candidate ทุกตัว แล้วคืนเฉพาะที่เป็นกับดักจริง เรียงจากอันตรายที่สุดก่อน */
  public detectTraps(input: TrapDetectionInput): TrapWarning[] {
    return input.candidates
      .map((candidate) => this.evaluateCandidate(input.fenBeforeMove, candidate))
      .filter((warning) => warning.isTrap)
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  }

  private resolveSeverity(swingCp: number): TrapSeverity {
    if (swingCp >= this.options.criticalSeveritySwingCp) return 'critical';
    if (swingCp >= this.options.mediumSeveritySwingCp) return 'medium';
    return 'low';
  }
}

// ============================================================================
// Pattern classification — ดูหมายเหตุข้อ 2 บนสุดของไฟล์เรื่องขอบเขต
// ============================================================================

function classifyPattern(fenBeforeMove: string, candidate: CandidateLine): { readonly kind: TrapPatternKind; readonly label: string } {
  const fallback = { kind: 'tactical_reversal' as const, label: 'พลิกสถานการณ์ทางยุทธวิธี (Tactical Reversal — ยังไม่ระบุรูปแบบเฉพาะ)' };

  try {
    const scratch = new Chess(fenBeforeMove);
    const victimColor = scratch.turn(); // ฝ่ายที่กำลังพิจารณา trapMove นี้ = ฝ่ายที่จะเป็นเหยื่อถ้ามันคือกับดักจริง

    if (!applyUciMove(scratch, candidate.moveUci)) return fallback;
    for (const uci of candidate.continuationUci) {
      if (!applyUciMove(scratch, uci)) return fallback;
    }

    if (scratch.isCheckmate()) {
      const mated = scratch.turn(); // ฝ่ายที่ถูกรุกฆาต คือฝ่ายที่ "กำลังจะเดิน" ตอนนี้ (แพ้เพราะโดนรุกฆาต)
      const kingSquare = findKingSquare(scratch, mated);
      const backRank = mated === 'w' ? '1' : '8';
      if (kingSquare && kingSquare[1] === backRank) {
        return { kind: 'back_rank_mate', label: 'เปิดทางให้รุกฆาตแนวหลัง (Back-Rank Mate)' };
      }
      return fallback;
    }

    const lastMove = getLastAppliedMove(scratch);
    if (lastMove && lastMove.piece === 'n') {
      const valuableTargets = countValuableKnightTargets(scratch, lastMove.to, victimColor);
      if (valuableTargets >= 2) {
        return { kind: 'knight_fork', label: 'ม้าส้อม (Knight Fork) หลังติดกับดัก' };
      }
    }

    return fallback;
  } catch {
    // การ apply UCI move ที่มาจาก engine จริงไม่ควร throw แต่กันไว้เผื่อข้อมูล
    // ที่ส่งเข้ามาผิดรูปแบบ ไม่ให้การจำแนก pattern ทำให้ evaluateCandidate() พังไปด้วย
    return fallback;
  }
}

// ============================================================================
// Board-inspection helpers — module-private
// ============================================================================

function moverColorFromFen(fen: string): 'w' | 'b' {
  const turnField = fen.split(' ')[1];
  return turnField === 'b' ? 'b' : 'w';
}

function safeBaitSquare(uci: string): string {
  const match = /^[a-h][1-8]([a-h][1-8])/.exec(uci);
  return match?.[1] ?? '';
}

function applyUciMove(chess: Chess, uci: string): boolean {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
  if (!match) return false;
  const [, from, to, promotion] = match;
  try {
    chess.move(promotion ? { from, to, promotion } : { from, to });
    return true;
  } catch {
    return false;
  }
}

function findKingSquare(chess: Chess, color: 'w' | 'b'): string | null {
  const board = chess.board();
  for (const row of board) {
    for (const cell of row) {
      if (cell && cell.type === 'k' && cell.color === color) return cell.square;
    }
  }
  return null;
}

function getLastAppliedMove(chess: Chess): { readonly piece: string; readonly to: string } | null {
  const history = chess.history({ verbose: true });
  const last = history[history.length - 1];
  return last ? { piece: last.piece, to: last.to } : null;
}

/** นับจำนวนเป้าหมายของฝ่าย victimColor ที่มีค่า >= ตัวรอง (หรือเป็นคิง) ที่ม้าบนช่อง knightSquare โจมตีถึง — ใช้ยืนยัน fork จริงจากตำแหน่งบนกระดาน ไม่ใช่การเดา */
function countValuableKnightTargets(chess: Chess, knightSquare: string, victimColor: 'w' | 'b'): number {
  const fileIndex = knightSquare.charCodeAt(0) - 'a'.charCodeAt(0);
  const rankIndex = Number.parseInt(knightSquare[1] ?? '1', 10) - 1;

  let count = 0;
  for (const [df, dr] of KNIGHT_OFFSETS) {
    const f = fileIndex + df;
    const r = rankIndex + dr;
    if (f < 0 || f > 7 || r < 0 || r > 7) continue;

    const targetSquare = `${String.fromCharCode('a'.charCodeAt(0) + f)}${r + 1}` as Square;
    const piece = chess.get(targetSquare);
    if (piece && piece.color === victimColor && (PIECE_VALUES[piece.type] >= 3 || piece.type === 'k')) {
      count += 1;
    }
  }
  return count;
}

function severityRank(severity: TrapSeverity): number {
  if (severity === 'critical') return 3;
  if (severity === 'medium') return 2;
  return 1;
}
