/**
 * events.ts
 * ---------------------------------------------------------------------------
 * นิยาม event ดิบทุกประเภทที่เกิดขึ้นระหว่างผู้เล่นคิด 1 ตา รวมถึง shape ของ
 * "สแนปช็อต" สรุปผลของตานั้นหลัง aggregate event ทั้งหมดแล้ว (ตรงกับส่วน
 * `behavior` ของ Schema 1 — Per-Move Behavioral & Engine Log Data ในเอกสาร
 * สถาปัตยกรรม Phase 0 §3.1)
 *
 * ไฟล์นี้เป็น **pure types เท่านั้น** — ไม่มี class, ไม่มี side effect, ไม่มี
 * การคำนวณใดๆ ทั้งสิ้น (แม้แต่ hesitationIndex ก็เป็นแค่ field ใน snapshot
 * type ไม่ใช่สูตรคำนวณ) ตัว aggregator ที่รับ `MoveTelemetryEvent[]` มา reduce
 * เป็น `RawMoveTelemetrySnapshot` จริงๆ อยู่คนละไฟล์ (module ถัดไปใน
 * core/telemetry/) เพื่อให้ types แยกออกจาก logic อย่างเด็ดขาด — import
 * events.ts ที่ไหนก็ไม่มี runtime overhead ติดมาด้วยเลยแม้แต่ byte เดียว
 * ---------------------------------------------------------------------------
 */

import type { Square } from 'chess.js';
import type { PieceColor } from '../chess/GameEngine';

// ============================================================================
// Raw events — หนึ่ง event ต่อหนึ่งการกระทำจริงของผู้เล่น (มือ/เมาส์/หน้าต่าง)
// ============================================================================

/** ผู้เล่นเลือก/คลิกช่องที่มีหมาก (ทั้งการเลือกครั้งแรกในตา และการสลับไปเลือกช่องอื่น) */
export interface PieceSelectedEvent {
  readonly type: 'piece_selected';
  readonly square: Square;
  /** เวลา (ms) นับจากเริ่มตานี้ (ไม่ใช่ epoch time) — ดู RawMoveTelemetrySnapshot สำหรับ timestamp สัมบูรณ์ */
  readonly atMs: number;
}

/** ผู้เล่นยกเลิกการเลือกโดยไม่เดิน (คลิกช่องเดิมซ้ำ หรือคลิกที่อื่นที่ไม่ใช่เป้าหมายที่เดินได้) */
export interface SelectionCancelledEvent {
  readonly type: 'selection_cancelled';
  readonly square: Square;
  readonly atMs: number;
}

/** ผู้เล่นปล่อยหมากลงช่องเป้าหมาย (ไม่ว่าจะจบเป็นตาเดินที่ถูกต้องหรือไม่ก็ตาม — aggregator เป็นผู้ตัดสินว่าตานี้ "จบ" ตาหรือยัง) */
export interface PieceDroppedEvent {
  readonly type: 'piece_dropped';
  readonly from: Square;
  readonly to: Square;
  readonly atMs: number;
}

/**
 * เมาส์/นิ้วอยู่เหนือช่องหนึ่งครบช่วงเวลาหนึ่งแล้ว (event นี้ยิงตอน hover "จบ"
 * ไม่ใช่ตอนเริ่ม — durationMs คือระยะเวลาที่ชี้ค้างอยู่บนช่องนั้นทั้งหมด)
 * ใช้สร้าง hoverHeatmap ใน RawMoveTelemetrySnapshot
 */
export interface SquareHoveredEvent {
  readonly type: 'square_hovered';
  readonly square: Square;
  readonly durationMs: number;
}

/** แท็บ/หน้าต่างเสียโฟกัส (ผู้เล่นสลับไปแท็บอื่นระหว่างคิด) — สัญญาณของการเสียสมาธิหรือไปหาข้อมูลเพิ่ม */
export interface WindowBlurEvent {
  readonly type: 'window_blur';
  readonly atMs: number;
}

/** แท็บ/หน้าต่างกลับมาได้โฟกัส — จับคู่กับ WindowBlurEvent เพื่อคำนวณระยะเวลาที่หายไป */
export interface WindowFocusEvent {
  readonly type: 'window_focus';
  readonly atMs: number;
}

/** Discriminated union ของ event ทั้งหมดที่อาจเกิดขึ้นระหว่างตาหนึ่ง — exhaustive switch บน `type` ได้ที่ aggregator */
export type MoveTelemetryEvent =
  | PieceSelectedEvent
  | SelectionCancelledEvent
  | PieceDroppedEvent
  | SquareHoveredEvent
  | WindowBlurEvent
  | WindowFocusEvent;

/** ชนิดของ event ทั้งหมด (union ของ literal `type`) — สะดวกเวลาต้องการ narrow โดยไม่ import ทุก interface แยก */
export type MoveTelemetryEventType = MoveTelemetryEvent['type'];

// ============================================================================
// Type guards — narrow MoveTelemetryEvent เป็นชนิดเจาะจง ไม่มี side effect ใดๆ
// ============================================================================

export function isPieceSelectedEvent(event: MoveTelemetryEvent): event is PieceSelectedEvent {
  return event.type === 'piece_selected';
}

export function isSelectionCancelledEvent(event: MoveTelemetryEvent): event is SelectionCancelledEvent {
  return event.type === 'selection_cancelled';
}

export function isPieceDroppedEvent(event: MoveTelemetryEvent): event is PieceDroppedEvent {
  return event.type === 'piece_dropped';
}

export function isSquareHoveredEvent(event: MoveTelemetryEvent): event is SquareHoveredEvent {
  return event.type === 'square_hovered';
}

export function isWindowBlurEvent(event: MoveTelemetryEvent): event is WindowBlurEvent {
  return event.type === 'window_blur';
}

export function isWindowFocusEvent(event: MoveTelemetryEvent): event is WindowFocusEvent {
  return event.type === 'window_focus';
}

// ============================================================================
// RawMoveTelemetrySnapshot — ผลลัพธ์สรุปของหนึ่งตา ตรงกับ "behavior" ใน Schema 1
// ============================================================================

/** หนึ่งรายการในลำดับการเลือกช่องจริงระหว่างตา — สอดคล้องกับ `pieceSelections` ใน Schema 1 §3.1 */
export interface PieceSelectionRecord {
  readonly square: Square;
  readonly atMs: number;
  readonly cancelled: boolean;
}

/**
 * สแนปช็อตพฤติกรรมของหนึ่งตา หลัง aggregate `MoveTelemetryEvent[]` ทั้งหมด
 * ของตานั้นแล้ว — field ทุกตัวตรงกับ object `behavior` ใน Schema 1
 * (Per-Move Behavioral & Engine Log Data, เอกสารสถาปัตยกรรม Phase 0 §3.1)
 * ไม่รวม field ฝั่ง `timing`/`engine`/`psych`/`context` ของ schema เดียวกัน
 * เพราะมาจากคนละแหล่งข้อมูล (Clock, EnginePool, PanicCalculator, ECO book
 * ตามลำดับ) — โมดูลที่ประกอบทุกส่วนเป็น MoveLog เต็มรูปแบบเป็นชั้นที่สูงกว่านี้
 */
export interface RawMoveTelemetrySnapshot {
  readonly ply: number;
  readonly color: PieceColor;

  /** ลำดับการเลือก/ยกเลิกเลือกช่องทั้งหมดระหว่างตานี้ ตามลำดับเวลาที่เกิดขึ้นจริง */
  readonly pieceSelections: readonly PieceSelectionRecord[];

  /** จำนวนครั้งที่คลิกเลือกช่องทั้งหมด (รวมทั้งที่ cancelled และไม่ cancelled) */
  readonly totalClicks: number;

  /** จำนวนช่อง "ที่ต่างกัน" ที่ถูกแตะระหว่างตานี้ (ไม่นับซ้ำ) */
  readonly distinctPiecesTouched: number;

  /** จำนวนครั้งที่คลิกช่องเดิมซ้ำติดกัน (เลือกตัวเดิมซ้ำโดยไม่ได้สลับไปตัวอื่นก่อน) */
  readonly repeatClickSamePiece: number;

  /** จำนวนครั้งที่เกิด SelectionCancelledEvent ระหว่างตานี้ */
  readonly selectionCancelCount: number;

  /** ระยะเวลารวม (ms) ที่เมาส์/นิ้วอยู่เหนือแต่ละช่อง — key เป็นชื่อช่อง (เช่น "f3") มาจาก SquareHoveredEvent ทั้งหมดของตานี้ */
  readonly hoverHeatmap: Readonly<Record<string, number>>;

  /**
   * ระยะทาง (พิกเซล) ที่ลากหมากระหว่างตานี้ — เป็น `null` เมื่อไม่มีข้อมูลนี้
   * เพราะ event ทั้ง 6 ประเภทข้างต้นไม่มีตัวใดบันทึกพิกัดพิกเซลไว้เลย
   * (PieceDroppedEvent เก็บแค่ square ต้นทาง/ปลายทางเป็นชื่อช่อง ไม่ใช่พิกัด)
   * ถ้าต้องการ field นี้จริง ต้องเพิ่ม event ใหม่ที่ capture พิกัดเมาส์ดิบ
   * จาก UI layer (เช่น PointerMoveEvent) ซึ่งอยู่นอกขอบเขตของ event set นี้
   */
  readonly dragDistancePx: number | null;

  /** จำนวนครั้งที่แท็บเสียโฟกัสระหว่างตานี้ (นับจาก WindowBlurEvent) */
  readonly tabBlurCount: number;

  /**
   * ดัชนีความลังเล 0-1 — เป็น field ที่ **สงวนไว้ให้ aggregator เติมค่า**
   * (สูตรผสม cancel/repeat/idle ตาม Phase 0 §3.1 ตัวอย่าง `hesitationIndex: 0.71`)
   * ไฟล์นี้เป็น pure types เท่านั้นจึงไม่มีสูตรคำนวณอยู่ในนี้ — ดู aggregator
   * module ที่ import ชนิดนี้ไปเติมค่าจริง
   */
  readonly hesitationIndex: number;

  /** เวลา (ms) จากเริ่มตานี้ (turn start) จนถึง PieceSelectedEvent ตัวแรก — วัด "นั่งเฉยก่อนแตะหมากครั้งแรก" */
  readonly idleBeforeFirstTouchMs: number;

  /** epoch timestamp (ms, Date.now()) ตอนตานี้จบ — ใช้เป็น anchor แปลง `atMs`/`durationMs` สัมพัทธ์ทั้งหมดกลับเป็นเวลาจริงได้ถ้าจำเป็น */
  readonly turnEndedAtEpochMs: number;
}
