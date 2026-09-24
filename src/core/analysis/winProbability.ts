/**
 * winProbability.ts
 * ---------------------------------------------------------------------------
 * แปลง engine evaluation (centipawn หรือ mate) เป็น "win probability" (0.0-1.0)
 * ด้วยสูตร sigmoid เดียวกับที่ Lichess ใช้ในหน้า Analysis Board
 * (ค่าคงที่ MULTIPLIER = -0.00368208 มาจาก lila's `winningChances.ts` —
 * ผ่านการ fit เพื่อให้เส้นโค้งใกล้เคียงกับผลจริงของ Stockfish ในทางปฏิบัติ)
 *
 * หลักการสำคัญของไฟล์นี้ (ต้องอ่านก่อนใช้ทุกฟังก์ชัน):
 * "EngineScore" ทุกตัวที่ไฟล์นี้รับ/คืนค่า เป็น **มุมมองฝ่ายขาวเสมอ**
 * (positive = ขาวได้เปรียบ, negative = ดำได้เปรียบ) สอดคล้องกับ field
 * "engine.evalBefore" / "engine.evalAfter" ใน Phase 0 §3.1 JSON Schema ซึ่ง
 * ทั้งสอง field เป็นบวกพร้อมกันได้แม้ตาที่ขยับเปลี่ยนสีผู้เล่น (ตัวอย่างใน
 * สเปก: evalBefore=24, evalAfter=31 ทั้งคู่จากมุมมองขาว) — นี่คือ convention
 * "absolute White POV" ซึ่งต่างจาก raw UCI score ที่ engine คืนมา (ซึ่งเป็น
 * "มุมมองฝ่ายที่กำลังจะเดิน" หรือ relative-to-side-to-move) ผู้เรียกที่ดึงค่า
 * ดิบจาก EnginePool.analyzePosition()/requestPlayMove() ต้องแปลงเป็น absolute
 * White POV ก่อนส่งเข้าไฟล์นี้ — ใช้ `flipScorePerspective()` ด้านล่างช่วยแปลง
 * (คูณค่าด้วย -1 เมื่อฝ่ายที่กำลังจะเดิน ณ ตำแหน่งนั้นคือฝ่ายดำ)
 * ---------------------------------------------------------------------------
 */

// ============================================================================
// Types
// ============================================================================

export type PieceColor = 'w' | 'b';

/** engine evaluation แบบ centipawn — มุมมองฝ่ายขาวเสมอ (ดูหมายเหตุด้านบนของไฟล์) */
export interface CpScore {
  readonly type: 'cp';
  readonly value: number;
}

/** engine evaluation แบบ mate-in-N — มุมมองฝ่ายขาวเสมอ: value > 0 แปลว่าขาวเป็นฝ่ายรุกฆาต, value < 0 แปลว่าดำเป็นฝ่ายรุกฆาต */
export interface MateScore {
  readonly type: 'mate';
  readonly value: number;
}

export type EngineScore = CpScore | MateScore;

// ============================================================================
// Constants
// ============================================================================

/** ค่าคงที่ sigmoid ตามสูตรของ Lichess (lila `winningChances.ts`) */
const LICHESS_SIGMOID_MULTIPLIER = -0.00368208;

/**
 * แปลง mate score ให้เป็น centipawn เทียบเท่า — ยิ่ง mate ใกล้ (N น้อย) ยิ่งเทียบเท่า
 * cp ที่สูงมาก (เกือบชนะขาดลอยแน่นอน) ยิ่ง mate ไกล ค่าจะลดหลั่นลงมาบ้างเพื่อสะท้อนว่า
 * ยังมีโอกาสพลิกสถานการณ์ได้เล็กน้อยกว่าตำแหน่งที่ mate ประชิดตัวแล้ว
 */
const MATE_BASE_CENTIPAWNS = 10_000;
const MATE_PLY_PENALTY_CENTIPAWNS = 100;
const MIN_MATE_EQUIVALENT_CENTIPAWNS = 5_000;

// ============================================================================
// Core helpers
// ============================================================================

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * แปลง mate score (มุมมองฝ่ายขาว) ให้เป็นตัวเลข centipawn เทียบเท่า
 * ใช้เมื่อต้องเปรียบเทียบ mate score กับ cp score บนสเกลเดียวกัน (เช่นใน classifier.ts)
 */
export function mateToEquivalentCentipawns(mateValue: number): number {
  const sign = mateValue >= 0 ? 1 : -1;
  const distancePlies = Math.abs(mateValue);
  const magnitude = Math.max(
    MIN_MATE_EQUIVALENT_CENTIPAWNS,
    MATE_BASE_CENTIPAWNS - distancePlies * MATE_PLY_PENALTY_CENTIPAWNS,
  );
  return sign * magnitude;
}

/** แปลง EngineScore (cp หรือ mate) ให้เป็นตัวเลข centipawn บนสเกลเดียวกันเสมอ — มุมมองฝ่ายขาว */
export function scoreToEquivalentCentipawns(score: EngineScore): number {
  return score.type === 'cp' ? score.value : mateToEquivalentCentipawns(score.value);
}

/**
 * กลับมุมมองของ EngineScore (ขาว <-> ดำ) — ใช้แปลง raw UCI score (relative-to-side-to-move)
 * ให้กลายเป็น absolute White POV ก่อนใช้งานฟังก์ชันอื่นในไฟล์นี้ทั้งหมด
 * ตัวอย่าง: engine คืนค่า relative-to-mover cp=+40 ขณะดำกำลังจะเดิน → flip แล้วได้ cp=-40 (มุมมองขาว)
 */
export function flipScorePerspective(score: EngineScore): EngineScore {
  return score.type === 'cp' ? { type: 'cp', value: -score.value } : { type: 'mate', value: -score.value };
}

// ============================================================================
// Win probability (White POV)
// ============================================================================

/**
 * สูตร sigmoid ของ Lichess: winningChances(cp) = 2 / (1 + e^(MULTIPLIER * cp)) - 1
 * คืนค่าอยู่ในช่วง (-1, 1) โดย +1 = ขาวชนะขาดลอยแน่นอน, -1 = ดำชนะขาดลอยแน่นอน
 * ฟังก์ชันนี้แปลงเป็น win probability ของฝ่ายขาว (0.0-1.0) ด้วยการ map (-1,1) → (0,1)
 */
export function centipawnsToWinProbability(centipawns: number): number {
  // clamp ก่อนเข้าสูตรกัน exponent overflow กรณีมี cp เทียบเท่าของ mate ที่ใหญ่มาก
  const bounded = clamp(centipawns, -MATE_BASE_CENTIPAWNS, MATE_BASE_CENTIPAWNS);
  const winningChances = 2 / (1 + Math.exp(LICHESS_SIGMOID_MULTIPLIER * bounded)) - 1;
  return clamp((winningChances + 1) / 2, 0, 1);
}

/** แปลง EngineScore (cp หรือ mate, มุมมองขาว) ตรงเป็น win probability ของฝ่ายขาว */
export function scoreToWinProbability(score: EngineScore): number {
  return centipawnsToWinProbability(scoreToEquivalentCentipawns(score));
}

/**
 * win probability จากมุมมองของสีที่ระบุ (Point of View) —
 * ใช้ตัวนี้แทน scoreToWinProbability() ตรงๆ เมื่อไฟล์ที่เรียกไม่ได้สนใจแค่ฝ่ายขาว
 * (เช่น telemetry ต้องดูจากมุมมองผู้เล่น ไม่ใช่มุมมองขาวเสมอไป)
 */
export function povWinProbability(score: EngineScore, perspective: PieceColor): number {
  const whiteWinProbability = scoreToWinProbability(score);
  return perspective === 'w' ? whiteWinProbability : 1 - whiteWinProbability;
}

/**
 * ความแกว่งของ win probability ระหว่างก่อน/หลังตาเดิน จากมุมมองของสีที่ระบุ
 * ค่าบวก = ตาเดินนี้ทำให้ perspective ได้เปรียบขึ้น, ค่าลบ = เสียเปรียบลง
 * สอดคล้องกับ field "criticalMoments[].winProbSwing" ใน Phase 0 §3.2 (ตัวอย่าง: -0.44 สำหรับ blunder)
 */
export function winProbSwing(scoreBefore: EngineScore, scoreAfter: EngineScore, perspective: PieceColor): number {
  return povWinProbability(scoreAfter, perspective) - povWinProbability(scoreBefore, perspective);
}
