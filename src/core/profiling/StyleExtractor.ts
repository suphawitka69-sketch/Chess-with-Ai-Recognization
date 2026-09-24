/**
 * StyleExtractor.ts
 * ---------------------------------------------------------------------------
 * ⚠️ ไม่เห็นเนื้อไฟล์จริงของ `shared/types/schema.ts` (MoveLogRecord /
 * GameSummaryRecord) หรือ `winProbability.ts` / `classifier.ts` เวอร์ชันล่าสุด
 * ในเซสชันนี้ — ตามแพทเทิร์นที่ใช้กับ TrapDetector.ts ไปแล้ว ไฟล์นี้จึงนิยาม
 * input type ของตัวเอง (`StyleMoveInput` / `StyleGameInput`) แบบ self-contained
 * ไม่ import จากไฟล์ที่ไม่เห็นเนื้อจริง ผู้เรียก (เช่น useProfile.ts ที่ยังไม่มี)
 * มีหน้าที่ map MoveLogRecord/GameSummaryRecord จริงให้เข้ารูปนี้ก่อนส่งเข้ามา
 * — field ที่ตั้งชื่อไว้จงใจให้ตรงกับชื่อใน Schema 1/2A ของเอกสารสถาปัตยกรรม
 * Phase 0 เพื่อให้ map ตรงๆ ได้ง่ายที่สุดถ้าโครงสร้างจริงตรงกัน
 *
 * หลักการคำนวณแต่ละแกน (0-100) — ทุกแกนเป็น "ตัวประมาณ" จากข้อมูลที่มีอยู่จริง
 * ในระบบตอนนี้ ไม่ใช่สูตรวิชาการที่ตายตัว เพราะข้อมูลบางอย่างที่ควรใช้จริง
 * (เช่น ความแปรปรวนของ MultiPV, threat detection แบบเต็มรูปแบบของ TrapDetector)
 * ยังไม่ได้ต่อเข้ามาที่ชั้นนี้ — คอมเมนต์ในแต่ละฟังก์ชันระบุข้อจำกัดตรงๆ
 * ---------------------------------------------------------------------------
 */

// ============================================================================
// Types
// ============================================================================

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

export type StyleMoveClassification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'forced';

/**
 * ข้อมูลของ 1 ตา ที่ StyleExtractor ต้องการ — ผู้เรียก map มาจาก MoveLogRecord
 * จริง (Schema 1) ก่อนส่งเข้ามา ทุก field เป็น optional ยกเว้นสิ่งที่จำเป็น
 * ต่อการนับพื้นฐาน (color, actor, isCapture, isCheck, fenBefore, moveNumber)
 * เพื่อให้ยังคำนวณแกนอื่นได้แม้บางแกนจะขาดข้อมูล engine.* ไป
 */
export interface StyleMoveInput {
  readonly gameId: string;
  readonly ply: number;
  readonly moveNumber: number;
  readonly color: 'w' | 'b';
  readonly actor: 'human' | 'engine' | 'ghost';
  readonly isCapture: boolean;
  readonly isCheck: boolean;
  /** FEN ก่อนเดินตานี้ — ใช้ประมาณ phase ถ้าไม่ได้ส่ง `phase` มาตรงๆ (นับจำนวนหมากที่เหลือ) */
  readonly fenBefore: string;
  /** ถ้า GameAnalyzer คำนวณ phase ไว้แล้วให้ส่งมาตรงๆ — แม่นกว่าการประมาณจาก FEN */
  readonly phase?: GamePhase;
  readonly classification?: StyleMoveClassification;
  /** centipawn loss ของตานี้ (>= 0) — มาจาก engine.centipawnLoss ใน Schema 1 */
  readonly centipawnLoss?: number;
  /**
   * eval "ก่อน" เดินตานี้ ในมุมมองฝ่ายขาวเสมอ (ตาม convention ของ
   * winProbability.ts ที่เอกสารระบุว่าทุก EngineScore เป็น White POV) —
   * ใช้ตัดสินว่าฝ่ายที่กำลังเดินกำลัง "เสียเปรียบ" อยู่หรือไม่ (สำหรับ
   * defensiveResilience) ค่าเป็น centipawn ที่ผ่านการแปลง mate มาแล้ว
   * (เช่นจาก scoreToEquivalentCentipawns ของ winProbability.ts)
   */
  readonly evalBeforeWhitePovCp?: number;
  /** psych.panicScore ของตานี้ (0-100) — จาก PanicCalculator */
  readonly panicScore?: number;
  readonly triggerFlags?: readonly string[];
}

export interface StyleGameInput {
  readonly gameId: string;
  readonly playerColor: 'w' | 'b';
  readonly moves: readonly StyleMoveInput[];
}

export interface StyleVector {
  readonly aggression: number;
  readonly positional: number;
  readonly tacticalSharpness: number;
  readonly defensiveResilience: number;
  readonly timeManagement: number;
  readonly riskTolerance: number;
  readonly prophylaxis: number;
  readonly endgameTechnique: number;
}

export class StyleExtractorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StyleExtractorError';
  }
}

// ============================================================================
// Config
// ============================================================================

/** ค่ากลาง (50) ใช้เมื่อไม่มีข้อมูลพอจะคำนวณแกนนั้นเลย — ดีกว่าคืน 0 ซึ่งจะถูกตีความว่า "แย่มาก" ทั้งที่จริงๆ แค่ "ยังไม่มีข้อมูล" */
const NEUTRAL_SCORE = 50;

/** centipawn loss ที่ถือว่า "แย่เต็มสเกล" สำหรับ normalize เป็น accuracy 0-100 (ใช้ค่าเดียวกันทั้ง defensiveResilience และ endgameTechnique เพื่อให้เทียบกันได้) */
const CENTIPAWN_LOSS_SATURATION = 300;

/** threshold centipawn (มุมมองฝ่ายขาว) ที่ถือว่า "กำลังเสียเปรียบชัดเจน" สำหรับตัดสิน defensiveResilience — ใช้ magnitude เดียวกันสองทิศทางตามสี */
const LOSING_THRESHOLD_CP = 50;

/** จำนวนหมาก (ไม่นับเบี้ย/คิง) รวมสองฝั่งที่ต่ำกว่านี้ถือว่าเข้าสู่ endgame ถ้าไม่มี phase ส่งมาตรงๆ */
const ENDGAME_PIECE_COUNT_THRESHOLD = 6;

/** เลขตาที่ใช้เป็นเส้นแบ่ง opening แบบหยาบๆ (ถ้าไม่มี phase ส่งมา) */
const OPENING_MOVE_NUMBER_CUTOFF = 10;

// ============================================================================
// StyleExtractor
// ============================================================================

export class StyleExtractor {
  /**
   * สกัด StyleVector จากเกมทั้งหมดที่ส่งเข้ามา — กรองเอาเฉพาะตาที่ actor==='human'
   * และ color ตรงกับ playerColor ของเกมนั้น (กัน mapping ผิดพลาดจากภายนอกที่อาจ
   * ส่งตาของฝั่งตรงข้ามหรือของ engine ปนเข้ามา)
   */
  public extract(games: readonly StyleGameInput[]): StyleVector {
    const humanMoves = games.flatMap((game) =>
      game.moves
        .filter((m) => m.actor === 'human' && m.color === game.playerColor)
        .map((m) => ({ ...m, resolvedPhase: m.phase ?? this.estimatePhase(m) })),
    );

    if (humanMoves.length === 0) {
      throw new StyleExtractorError('Cannot extract style: no human moves found in the provided games');
    }

    return {
      aggression: this.computeAggression(humanMoves),
      positional: this.computePositional(humanMoves),
      tacticalSharpness: this.computeTacticalSharpness(humanMoves),
      defensiveResilience: this.computeDefensiveResilience(humanMoves),
      timeManagement: this.computeTimeManagement(humanMoves),
      riskTolerance: this.computeRiskTolerance(humanMoves),
      prophylaxis: this.computeProphylaxis(humanMoves),
      endgameTechnique: this.computeEndgameTechnique(humanMoves),
    };
  }

  // --------------------------------------------------------------------------
  // 1. Aggression — สัดส่วนตาที่กิน/รุก (capture หรือ check) จากตาทั้งหมด
  // --------------------------------------------------------------------------
  private computeAggression(moves: readonly ResolvedMove[]): number {
    const aggressiveCount = moves.filter((m) => m.isCapture || m.isCheck).length;
    return this.toScore(aggressiveCount, moves.length);
  }

  // --------------------------------------------------------------------------
  // 2. Positional — ในกลุ่มตา "เงียบ" (ไม่กิน ไม่รุก) มีกี่ % ที่เป็นตาคุณภาพดี
  //    (good/best/great/brilliant) — สะท้อนการเดินปรับปรุงโครงสร้างอย่างมี
  //    คุณภาพ ไม่ใช่แค่เดินเงียบๆ เฉยๆ โดยไม่มีจุดประสงค์
  // --------------------------------------------------------------------------
  private computePositional(moves: readonly ResolvedMove[]): number {
    const quietMoves = moves.filter((m) => !m.isCapture && !m.isCheck);
    const quietGoodMoves = quietMoves.filter((m) => m.classification && isGoodOrBetter(m.classification));
    if (quietMoves.length === 0) return NEUTRAL_SCORE;
    return this.toScore(quietGoodMoves.length, quietMoves.length);
  }

  // --------------------------------------------------------------------------
  // 3. Tactical sharpness — ในกลุ่มตาที่มี classification จาก engine แล้ว มีกี่ %
  //    ที่จัดอยู่ระดับ best ขึ้นไป (best/great/brilliant) — ข้อจำกัด: นี่คือ
  //    "ความแม่นยำโดยรวม" ไม่ใช่ "% ที่เจอแท็กติกเมื่อมีโอกาส" ตรงๆ เพราะการ
  //    ตรวจว่าตำแหน่งไหน "มีโอกาสแท็กติก" จริงๆ ต้องใช้ TrapDetector/MultiPV
  //    วิเคราะห์เชิงลึกกว่านี้ ซึ่งยังไม่ได้ต่อเข้ามาที่ชั้นนี้
  // --------------------------------------------------------------------------
  private computeTacticalSharpness(moves: readonly ResolvedMove[]): number {
    const classified = moves.filter((m) => m.classification !== undefined);
    if (classified.length === 0) return NEUTRAL_SCORE;
    const sharpCount = classified.filter((m) => isBestOrBetter(m.classification as StyleMoveClassification)).length;
    return this.toScore(sharpCount, classified.length);
  }

  // --------------------------------------------------------------------------
  // 4. Defensive resilience — ความแม่นยำ (1 - centipawnLoss ที่ normalize แล้ว)
  //    เฉพาะตาที่ฝ่ายกำลังเดินอยู่ใน "สถานะเสียเปรียบ" ตาม evalBeforeWhitePovCp
  // --------------------------------------------------------------------------
  private computeDefensiveResilience(moves: readonly ResolvedMove[]): number {
    const losingMoves = moves.filter((m) => m.evalBeforeWhitePovCp !== undefined && this.isMoverLosing(m));
    return this.averageAccuracy(losingMoves);
  }

  // --------------------------------------------------------------------------
  // 5. Time management — ยิ่ง panicScore เฉลี่ยต่ำ + ยิ่งไม่ค่อยติด trigger flag
  //    ประเภทเวลา (low_clock/time_scramble) ยิ่งคะแนนสูง
  // --------------------------------------------------------------------------
  private computeTimeManagement(moves: readonly ResolvedMove[]): number {
    const withPanic = moves.filter((m) => m.panicScore !== undefined);
    if (withPanic.length === 0) return NEUTRAL_SCORE;

    const avgPanic = withPanic.reduce((sum, m) => sum + (m.panicScore ?? 0), 0) / withPanic.length;
    const timeFlagCount = moves.filter((m) => m.triggerFlags?.some((f) => f === 'low_clock' || f === 'time_scramble')).length;
    const timeFlagRatio = timeFlagCount / moves.length;

    // น้ำหนัก 70% จาก panic เฉลี่ย (กลับด้าน: panic สูง = time management แย่),
    // 30% จากความถี่ของการติดธงเวลาโดยตรง — ให้ signal ตรงตัว (low_clock) มี
    // น้ำหนักน้อยกว่า panic เพราะ panic ครอบคลุมสาเหตุอื่นด้วย ไม่ใช่แค่เวลา
    const fromPanic = clamp0to100(100 - avgPanic);
    const fromFlags = clamp0to100(100 - timeFlagRatio * 100);
    return Math.round(0.7 * fromPanic + 0.3 * fromFlags);
  }

  // --------------------------------------------------------------------------
  // 6. Risk tolerance — สัดส่วนตาที่ "ไม่ใช่ตาที่ดีที่สุด/บังคับ" (เบี่ยงจากสาย
  //    ปลอดภัยที่สุด) ข้อจำกัด: นี่เป็นตัวแทนของ "ความเต็มใจเบี่ยงจากสายที่
  //    ปลอดภัยที่สุด" ไม่ใช่ "ความเสี่ยงเชิงกลยุทธ์" ตรงๆ (ซึ่งควรวัดจากความ
  //    แปรปรวนของ MultiPV lines ที่ยังไม่ได้ต่อเข้ามาที่ชั้นนี้)
  // --------------------------------------------------------------------------
  private computeRiskTolerance(moves: readonly ResolvedMove[]): number {
    const classified = moves.filter((m) => m.classification !== undefined);
    if (classified.length === 0) return NEUTRAL_SCORE;
    const deviatingCount = classified.filter(
      (m) => m.classification !== 'best' && m.classification !== 'forced' && m.classification !== 'brilliant',
    ).length;
    return this.toScore(deviatingCount, classified.length);
  }

  // --------------------------------------------------------------------------
  // 7. Prophylaxis — ตัวแทนคร่าวๆ: สัดส่วนตา "เงียบ" (ไม่กิน ไม่รุก) คุณภาพดี
  //    ในช่วง middlegame ข้อจำกัด: การวัด prophylaxis จริงต้องตรวจว่าตานั้น
  //    "ดับภัยคุกคามที่กำลังจะเกิด" ของฝ่ายตรงข้ามหรือไม่ ซึ่งต้องใช้
  //    TrapDetector วิเคราะห์ตำแหน่งของคู่ต่อสู้ล่วงหน้าเทียบกับตาที่เลือก
  //    เดินจริง — logic นั้นยังไม่ได้ต่อเข้ามาที่ชั้นนี้ จึงใช้ heuristic
  //    ที่หยาบกว่านี้ไปก่อน
  // --------------------------------------------------------------------------
  private computeProphylaxis(moves: readonly ResolvedMove[]): number {
    const middlegameMoves = moves.filter((m) => m.resolvedPhase === 'middlegame');
    const quietGoodMiddlegameMoves = middlegameMoves.filter(
      (m) => !m.isCapture && !m.isCheck && m.classification && isGoodOrBetter(m.classification),
    );
    if (middlegameMoves.length === 0) return NEUTRAL_SCORE;
    return this.toScore(quietGoodMiddlegameMoves.length, middlegameMoves.length);
  }

  // --------------------------------------------------------------------------
  // 8. Endgame technique — ความแม่นยำเฉพาะตาที่อยู่ในเฟส endgame
  // --------------------------------------------------------------------------
  private computeEndgameTechnique(moves: readonly ResolvedMove[]): number {
    const endgameMoves = moves.filter((m) => m.resolvedPhase === 'endgame');
    return this.averageAccuracy(endgameMoves);
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private isMoverLosing(move: ResolvedMove): boolean {
    const evalCp = move.evalBeforeWhitePovCp as number;
    // มุมมองเป็น White POV เสมอ — ถ้าฝ่ายขาวกำลังเดินและ evalCp ติดลบมากกว่า
    // threshold แปลว่าขาวเสียเปรียบ, ถ้าฝ่ายดำกำลังเดินต้องกลับเครื่องหมาย
    return move.color === 'w' ? evalCp <= -LOSING_THRESHOLD_CP : evalCp >= LOSING_THRESHOLD_CP;
  }

  private averageAccuracy(moves: readonly ResolvedMove[]): number {
    const withLoss = moves.filter((m) => m.centipawnLoss !== undefined);
    if (withLoss.length === 0) return NEUTRAL_SCORE;
    const avgLoss = withLoss.reduce((sum, m) => sum + Math.min(m.centipawnLoss as number, CENTIPAWN_LOSS_SATURATION), 0) / withLoss.length;
    return Math.round(clamp0to100(100 - (avgLoss / CENTIPAWN_LOSS_SATURATION) * 100));
  }

  private toScore(count: number, total: number): number {
    if (total === 0) return NEUTRAL_SCORE;
    return Math.round(clamp0to100((count / total) * 100));
  }

  /**
   * ประมาณ phase จากจำนวนหมาก (ไม่นับเบี้ย/คิง) ที่เหลือบนกระดาน — ใช้เมื่อ
   * MoveLogRecord ไม่ได้แนบ `phase` มาให้ตรงๆ จาก GameAnalyzer อยู่แล้ว
   * เป็น heuristic หยาบ ไม่แม่นเท่าการวิเคราะห์โครงสร้างจริง แต่พอใช้งานได้
   * เมื่อไม่มีข้อมูลอื่น
   */
  private estimatePhase(move: StyleMoveInput): GamePhase {
    if (move.moveNumber <= OPENING_MOVE_NUMBER_CUTOFF) return 'opening';

    const piecePlacement = move.fenBefore.split(' ')[0] ?? '';
    let nonPawnKingPieceCount = 0;
    for (const char of piecePlacement) {
      if (/[nbrqNBRQ]/.test(char)) nonPawnKingPieceCount += 1;
    }

    return nonPawnKingPieceCount <= ENDGAME_PIECE_COUNT_THRESHOLD ? 'endgame' : 'middlegame';
  }
}

// ============================================================================
// Module-private helpers
// ============================================================================

interface ResolvedMove extends StyleMoveInput {
  readonly resolvedPhase: GamePhase;
}

function isGoodOrBetter(classification: StyleMoveClassification): boolean {
  return classification === 'good' || isBestOrBetter(classification);
}

function isBestOrBetter(classification: StyleMoveClassification): boolean {
  return classification === 'best' || classification === 'great' || classification === 'brilliant';
}

function clamp0to100(value: number): number {
  if (Number.isNaN(value)) return NEUTRAL_SCORE;
  return Math.min(100, Math.max(0, value));
}
