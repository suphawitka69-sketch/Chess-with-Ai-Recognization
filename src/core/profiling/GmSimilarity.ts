/**
 * GmSimilarity.ts
 * ---------------------------------------------------------------------------
 * เปรียบเทียบ StyleVector ของผู้เล่นกับเวกเตอร์สไตล์ของ Grandmaster 12 คนใน
 * gmVectors.json ด้วย Cosine Similarity แล้วสร้างคำอธิบายภาษาไทยประกอบ —
 * ใช้แสดงในหน้า Profile ("คุณเล่นคล้าย Mikhail Tal 81%" เป็นต้น)
 *
 * ทำไมใช้ Cosine Similarity แทน Euclidean Distance: StyleVector แต่ละแกนมีสเกล
 * 0-100 เหมือนกันหมด แต่สิ่งที่เราสนใจคือ "สัดส่วน/ทิศทาง" ของสไตล์การเล่น
 * มากกว่า "ระยะห่างเชิงขนาด" — ผู้เล่นที่ได้คะแนนทุกแกนสูงเป็นสองเท่าของ GM
 * คนหนึ่ง (เช่น aggression 40 vs 80 ทุกแกนเท่ากันตามสัดส่วน) ควรถูกมองว่า
 * "มีสไตล์คล้ายกันมาก" ไม่ใช่ "ต่างกันมาก" ซึ่ง cosine similarity จับตรงนี้ได้
 * ตรงกว่า distance-based metric
 *
 * ⚠️ gmVectors.json ถูก validate โครงสร้างขณะรันไทม์ทั้งหมดในไฟล์นี้
 * (ไม่ไว้ใจ type ที่ TypeScript อนุมานจาก JSON import เฉยๆ) เพราะไฟล์ json
 * เป็นข้อมูล static ที่แก้ไขได้โดยไม่ผ่าน type check ของ compiler
 * ---------------------------------------------------------------------------
 */

import type { StyleVector } from './StyleExtractor';
import gmData from './gmVectors.json';

// ============================================================================
// Types
// ============================================================================

interface GmVectorEntry {
  readonly name: string;
  readonly vector: readonly number[];
  readonly playstyleDescriptionTh: string;
}

interface GmVectorDataset {
  readonly schemaVersion: number;
  readonly axes: readonly string[];
  readonly grandmasters: readonly GmVectorEntry[];
}

export interface GmSimilarityConfig {
  /** จำนวน GM สูงสุดที่จะคืนกลับ เรียงจากคะแนนสูงไปต่ำ (ค่าเริ่มต้น 3) */
  readonly topN?: number;
  /** เกณฑ์คะแนน (0-100) ที่ทั้งผู้เล่นและ GM ต้องสูงกว่าเท่ากันในแกนเดียวกัน ถึงจะนับเป็น "จุดร่วม" (ค่าเริ่มต้น 70) */
  readonly sharedTraitThreshold?: number;
  /** จำนวนแกน "จุดร่วม" สูงสุดที่จะแสดงต่อ GM หนึ่งคน (ค่าเริ่มต้น 3) */
  readonly maxSharedTraits?: number;
  /** จำนวนแกน "จุดต่าง" สูงสุดที่จะแสดงต่อ GM หนึ่งคน (ค่าเริ่มต้น 2) */
  readonly maxDivergences?: number;
}

export interface GmSimilarityResult {
  readonly name: string;
  /** คะแนนความคล้าย 0.00-1.00 (1.00 = ทิศทางเวกเตอร์เหมือนกันทุกประการ) */
  readonly score: number;
  readonly sharedTraits: readonly string[];
  readonly divergence: readonly string[];
  readonly playstyleDescriptionTh: string;
}

export class GmSimilarityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmSimilarityError';
  }
}

// ============================================================================
// Constants
// ============================================================================

/** ผลต่างคะแนน (หน่วยเดียวกับสเกล 0-100 ของ StyleVector) ที่ต่ำกว่านี้ถือว่า "ใกล้เคียงกันเกินจะเรียกว่าจุดต่าง" จึงถูกกรองออกจาก divergence list */
const MIN_NOTABLE_DIVERGENCE = 10;

/** คำอธิบายภาษาไทยของแต่ละแกน — ใช้ประกอบ sharedTraits/divergence ให้อ่านเข้าใจง่าย ไม่ใช่โชว์ camelCase identifier ตรงๆ */
const AXIS_LABEL_TH: Readonly<Record<string, string>> = {
  aggression: 'ความก้าวร้าว/ชอบบุก',
  positional: 'การเล่นเชิงตำแหน่ง',
  tacticalSharpness: 'ความคมในเชิงยุทธวิธี',
  defensiveResilience: 'ความเหนียวแน่นเวลาตั้งรับ',
  timeManagement: 'การจัดการเวลา',
  riskTolerance: 'ความกล้าเสี่ยง',
  prophylaxis: 'การป้องกันล่วงหน้า',
  endgameTechnique: 'ฝีมือช่วงท้ายเกม',
};

// ============================================================================
// GmSimilarity
// ============================================================================

export class GmSimilarity {
  private readonly dataset: GmVectorDataset;

  /**
   * รับ dataset แบบ injection ได้ (ค่าเริ่มต้นคือ gmVectors.json ที่ bundle มากับแอป)
   * เพื่อให้ทดสอบ unit test ได้ด้วยข้อมูลปลอมโดยไม่ต้องแก้ไฟล์ json จริง
   */
  constructor(rawDataset: unknown = gmData) {
    this.dataset = parseGmVectorDataset(rawDataset);
  }

  /** จำนวน GM ทั้งหมดที่โหลดมาได้ในชุดข้อมูล */
  public get grandmasterCount(): number {
    return this.dataset.grandmasters.length;
  }

  /**
   * หา GM ที่มีสไตล์ใกล้เคียงกับ styleVector ที่ระบุมากที่สุด เรียงจากคล้ายที่สุดก่อน
   */
  public findTopMatches(styleVector: StyleVector, config: GmSimilarityConfig = {}): readonly GmSimilarityResult[] {
    const topN = config.topN ?? 3;
    if (!Number.isInteger(topN) || topN <= 0) {
      throw new GmSimilarityError(`topN ต้องเป็นจำนวนเต็มบวก (ได้รับ ${topN})`);
    }
    const sharedTraitThreshold = config.sharedTraitThreshold ?? 70;
    const maxSharedTraits = config.maxSharedTraits ?? 3;
    const maxDivergences = config.maxDivergences ?? 2;

    const playerVectorByAxis = styleVectorToRecord(styleVector);

    const results = this.dataset.grandmasters.map((gm): GmSimilarityResult => {
      const gmVectorByAxis = this.gmEntryToAxisRecord(gm);
      const score = roundToTwoDecimals(cosineSimilarity(this.dataset.axes, playerVectorByAxis, gmVectorByAxis));

      return {
        name: gm.name,
        score,
        sharedTraits: buildSharedTraits(this.dataset.axes, playerVectorByAxis, gmVectorByAxis, sharedTraitThreshold, maxSharedTraits),
        divergence: buildDivergence(this.dataset.axes, playerVectorByAxis, gmVectorByAxis, gm.name, maxDivergences),
        playstyleDescriptionTh: gm.playstyleDescriptionTh,
      };
    });

    return results.sort((a, b) => b.score - a.score).slice(0, topN);
  }

  private gmEntryToAxisRecord(entry: GmVectorEntry): Readonly<Record<string, number>> {
    if (entry.vector.length !== this.dataset.axes.length) {
      throw new GmSimilarityError(
        `GM "${entry.name}" มี vector ความยาว ${entry.vector.length} ไม่ตรงกับจำนวนแกนที่ประกาศไว้ (${this.dataset.axes.length})`,
      );
    }
    const record: Record<string, number> = {};
    this.dataset.axes.forEach((axis, index) => {
      record[axis] = entry.vector[index];
    });
    return record;
  }
}

// ============================================================================
// Vector math
// ============================================================================

function styleVectorToRecord(vector: StyleVector): Readonly<Record<string, number>> {
  return {
    aggression: vector.aggression,
    positional: vector.positional,
    tacticalSharpness: vector.tacticalSharpness,
    defensiveResilience: vector.defensiveResilience,
    timeManagement: vector.timeManagement,
    riskTolerance: vector.riskTolerance,
    prophylaxis: vector.prophylaxis,
    endgameTechnique: vector.endgameTechnique,
  };
}

/** cos(θ) = (A · B) / (||A|| * ||B||) — คำนวณบนแกนที่ dataset ประกาศไว้เท่านั้น (ไม่ใช่ Object.keys ของ record เพราะลำดับ/ชุดแกนต้องตรงกันทั้งสองฝั่งเสมอ) */
function cosineSimilarity(
  axes: readonly string[],
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const axis of axes) {
    const valueA = a[axis] ?? 0;
    const valueB = b[axis] ?? 0;
    dotProduct += valueA * valueB;
    normA += valueA * valueA;
    normB += valueB * valueB;
  }

  if (normA === 0 || normB === 0) {
    // เวกเตอร์ที่ทุกแกนเป็น 0 ไม่มีทิศทางให้เทียบ — ไม่ควรเกิดในทางปฏิบัติเพราะ
    // StyleVector ควรมีอย่างน้อยบางแกนไม่เป็นศูนย์ แต่ป้องกันหารด้วยศูนย์ไว้ให้ชัดเจน
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

// ============================================================================
// Thai description builders
// ============================================================================

function describeAxisLabel(axis: string): string {
  return AXIS_LABEL_TH[axis] ?? axis;
}

function buildSharedTraits(
  axes: readonly string[],
  playerRecord: Readonly<Record<string, number>>,
  gmRecord: Readonly<Record<string, number>>,
  threshold: number,
  maxCount: number,
): readonly string[] {
  const matchingAxes = axes.filter((axis) => (playerRecord[axis] ?? 0) >= threshold && (gmRecord[axis] ?? 0) >= threshold);

  // เรียงแกนที่ "โดดเด่นที่สุดของทั้งคู่" ขึ้นก่อน (ค่าเฉลี่ยของสองฝ่ายสูงสุด)
  const sortedAxes = [...matchingAxes].sort((axisA, axisB) => {
    const averageA = ((playerRecord[axisA] ?? 0) + (gmRecord[axisA] ?? 0)) / 2;
    const averageB = ((playerRecord[axisB] ?? 0) + (gmRecord[axisB] ?? 0)) / 2;
    return averageB - averageA;
  });

  return sortedAxes.slice(0, maxCount).map((axis) => `${describeAxisLabel(axis)} สูงพอๆ กัน`);
}

function buildDivergence(
  axes: readonly string[],
  playerRecord: Readonly<Record<string, number>>,
  gmRecord: Readonly<Record<string, number>>,
  gmName: string,
  maxCount: number,
): readonly string[] {
  const diffs = axes
    .map((axis) => ({ axis, diff: (gmRecord[axis] ?? 0) - (playerRecord[axis] ?? 0) }))
    .filter((entry) => Math.abs(entry.diff) >= MIN_NOTABLE_DIVERGENCE);

  const sortedByMagnitude = [...diffs].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  return sortedByMagnitude.slice(0, maxCount).map((entry) => describeDivergence(entry.axis, entry.diff, gmName));
}

function describeDivergence(axis: string, diff: number, gmName: string): string {
  const label = describeAxisLabel(axis);
  const points = Math.round(Math.abs(diff));
  return diff > 0
    ? `${gmName} มีจุดเด่นด้าน${label}สูงกว่าคุณ (ต่างกัน ${points} แต้ม)`
    : `คุณมีจุดเด่นด้าน${label}สูงกว่า ${gmName} (ต่างกัน ${points} แต้ม)`;
}

// ============================================================================
// Runtime validation ของ gmVectors.json
// ============================================================================

function parseGmVectorDataset(raw: unknown): GmVectorDataset {
  if (typeof raw !== 'object' || raw === null) {
    throw new GmSimilarityError('gmVectors.json ต้องเป็น object');
  }
  const candidate = raw as Record<string, unknown>;
  const { schemaVersion, axes, grandmasters } = candidate;

  if (typeof schemaVersion !== 'number') {
    throw new GmSimilarityError('gmVectors.json ขาด field "schemaVersion" ที่เป็นตัวเลข');
  }
  if (!Array.isArray(axes) || axes.length === 0 || axes.some((axis) => typeof axis !== 'string')) {
    throw new GmSimilarityError('gmVectors.json ขาด field "axes" ที่เป็น array ของ string อย่างน้อย 1 รายการ');
  }
  if (!Array.isArray(grandmasters) || grandmasters.length === 0) {
    throw new GmSimilarityError('gmVectors.json ขาด field "grandmasters" ที่เป็น array อย่างน้อย 1 รายการ');
  }

  const typedAxes = axes as readonly string[];
  const parsedGrandmasters = grandmasters.map((entry, index) => parseGmEntry(entry, index, typedAxes.length));

  return { schemaVersion, axes: typedAxes, grandmasters: parsedGrandmasters };
}

function parseGmEntry(raw: unknown, index: number, expectedVectorLength: number): GmVectorEntry {
  if (typeof raw !== 'object' || raw === null) {
    throw new GmSimilarityError(`grandmasters[${index}] ไม่ใช่ object`);
  }
  const candidate = raw as Record<string, unknown>;
  const { name, vector, playstyleDescriptionTh } = candidate;

  if (typeof name !== 'string' || name.length === 0) {
    throw new GmSimilarityError(`grandmasters[${index}] ขาด field "name" ที่เป็น string`);
  }
  if (!Array.isArray(vector) || vector.some((value) => typeof value !== 'number')) {
    throw new GmSimilarityError(`grandmasters[${index}] ("${name}") ขาด field "vector" ที่เป็น array ของตัวเลข`);
  }
  if (vector.length !== expectedVectorLength) {
    throw new GmSimilarityError(
      `grandmasters[${index}] ("${name}") มี vector ความยาว ${vector.length} ไม่ตรงกับจำนวนแกนที่ประกาศไว้ (${expectedVectorLength})`,
    );
  }
  if (typeof playstyleDescriptionTh !== 'string' || playstyleDescriptionTh.length === 0) {
    throw new GmSimilarityError(`grandmasters[${index}] ("${name}") ขาด field "playstyleDescriptionTh" ที่เป็น string`);
  }

  return { name, vector: vector as readonly number[], playstyleDescriptionTh };
}
