/**
 * VariationTree.ts
 * ---------------------------------------------------------------------------
 * โครงสร้าง decision tree สำหรับ Analysis Sandbox ตาม Phase 0 §4.1-§4.2 —
 * ผู้เล่นสามารถ time-travel ไปยัง ply ใดก็ได้ของเกมจริง แล้วลองเดินสายแยก
 * (variation) ได้หลายทางจากจุดเดียวกัน โดยไม่กระทบ GameStore ของเกมจริง
 *
 * กฎสำคัญตามสเปก (ย้ำอีกครั้งเพราะเป็นจุดที่พลาดบ่อยที่สุด — ดู §4.1):
 * VariationTree ไม่ผูกกับ GameEngine instance ของเกมจริงเลย — SandboxStore
 * เป็นผู้รับผิดชอบ clone() ตำแหน่งและเดินหมากบน instance แยกก่อน แล้วค่อยส่ง
 * ผลลัพธ์ (MoveRecord + eval) เข้ามาที่ addMove() ของไฟล์นี้เท่านั้น — ไฟล์นี้
 * ไม่รู้จักและไม่แตะ chess.js เลย เป็น pure data structure ล้วนๆ
 *
 * โครงสร้างข้อมูลภายใน:
 * - `nodesById` : Map<id, node> — lookup O(1) แทนการไล่ DFS ทุกครั้งที่ค้นหา
 * - `parentIdById` : Map<id, parentId | null> — ใช้เดินย้อนขึ้นเพื่อสร้าง path
 *   (VariationNode ตามสเปกมีแค่ children ไม่มี parent pointer ในตัวเอง เพื่อให้
 *   โครงสร้างที่ export ออกไปเป็น serializable tree ปกติ ไม่มี circular reference)
 * ---------------------------------------------------------------------------
 */

import type { MoveRecord } from '../chess/GameEngine';

// ============================================================================
// Types
// ============================================================================

/** evaluation ของตำแหน่ง ณ โหนดนั้น — null เมื่อยังไม่ได้วิเคราะห์ (เช่น โหนดที่เพิ่งสร้างจากการเดินของผู้เล่นในแซนด์บ็อกซ์ ก่อน engine จะรายงานผล) */
export type VariationEval = { readonly type: 'cp' | 'mate'; readonly value: number } | null;

/** โครงสร้างโหนดตามสเปก Phase 0 §4.2 — เพิ่ม `annotation` (optional) ตามที่เอกสารสถาปัตยกรรมฉบับเต็มระบุไว้สำหรับเก็บคำอธิบายภาษาไทยจาก LLM */
export interface VariationNode {
  readonly id: string;
  readonly fen: string;
  readonly moveFromParent: { readonly san: string; readonly uci: string } | null;
  readonly eval: VariationEval;
  readonly children: VariationNode[];
  isMainLine: boolean;
  readonly isEngineBest: boolean;
  annotation?: string;
}

export interface CreateVariationTreeOptions {
  /** FEN ของตำแหน่งราก — โดยปกติคือ FEN ของ ply ที่ผู้เล่นกด "time travel" เข้ามาจากเกมจริง */
  readonly rootFen: string;
  /** evaluation ของตำแหน่งราก ถ้าทราบล่วงหน้า (เช่น ดึงมาจาก moveLog ของเกมจริงที่วิเคราะห์ไปแล้ว) */
  readonly rootEval?: VariationEval;
}

export interface AddMoveOptions {
  /** true เมื่อกิ่งนี้คือสายที่เล่นจริงในเกม (ตรงกับ history ของ GameStore) */
  readonly isMainLine?: boolean;
  /** true เมื่อกิ่งนี้คือตาที่ engine แนะนำว่าดีที่สุด ณ ตำแหน่งนั้น */
  readonly isEngineBest?: boolean;
}

export class VariationTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VariationTreeError';
  }
}

// ============================================================================
// VariationTree
// ============================================================================

export class VariationTree {
  private readonly root: VariationNode;
  private readonly nodesById = new Map<string, VariationNode>();
  private readonly parentIdById = new Map<string, string | null>();
  private nodeCount = 0;
  private fallbackIdCounter = 0;

  constructor(options: CreateVariationTreeOptions) {
    const rootNode: VariationNode = {
      id: 'root',
      fen: options.rootFen,
      moveFromParent: null,
      eval: options.rootEval ?? null,
      children: [],
      // รากของแซนด์บ็อกซ์ถือเป็นจุดเริ่มของ "สายหลัก" เสมอ (คือตำแหน่งจริงที่ผู้เล่น time-travel เข้ามา)
      isMainLine: true,
      // รากไม่ใช่ "ตาที่ engine แนะนำ" เพราะไม่มีตาเดินมาสู่รากเลย
      isEngineBest: false,
    };
    this.root = rootNode;
    this.registerNode(rootNode, null);
  }

  // --------------------------------------------------------------------------
  // Mutation
  // --------------------------------------------------------------------------

  /**
   * เพิ่มตาเดินใหม่ต่อจากโหนดที่ระบุ — ถ้ามีกิ่งที่เดินด้วยตาเดียวกัน (uci ตรงกัน)
   * อยู่แล้วใต้โหนดนั้น จะคืนโหนดเดิมแทนการสร้างซ้ำ (idempotent) เพื่อไม่ให้ต้นไม้
   * บวมขึ้นโดยไม่จำเป็นเวลาผู้เล่นลองกดตาเดิมซ้ำหลายครั้งในแซนด์บ็อกซ์
   */
  public addMove(fromNodeId: string, moveRecord: MoveRecord, evalAfterMove: VariationEval, options: AddMoveOptions = {}): VariationNode {
    const parent = this.nodesById.get(fromNodeId);
    if (!parent) {
      throw new VariationTreeError(`ไม่พบโหนดต้นทาง id="${fromNodeId}" ในต้นไม้ — เรียก addMove() ด้วย id ที่ไม่มีอยู่จริง`);
    }

    const existingChild = parent.children.find((child) => child.moveFromParent?.uci === moveRecord.uci);
    if (existingChild) {
      return existingChild;
    }

    const node: VariationNode = {
      id: this.generateNodeId(),
      fen: moveRecord.fenAfter,
      moveFromParent: { san: moveRecord.san, uci: moveRecord.uci },
      eval: evalAfterMove,
      children: [],
      isMainLine: options.isMainLine ?? false,
      isEngineBest: options.isEngineBest ?? false,
    };

    parent.children.push(node);
    this.registerNode(node, fromNodeId);
    return node;
  }

  /**
   * ใส่คำอธิบายภาษาไทยจาก LLM ให้กับโหนดที่ระบุ (ใช้โดย LessonPanel หลังเรียก
   * PromptBuilder + LLM proxy สำเร็จ) — แก้ในที่เดิม (mutate) เพราะ annotation
   * เป็น optional field เดียวที่เปลี่ยนแปลงได้หลังสร้างโหนดตามสเปก
   */
  public setAnnotation(nodeId: string, annotation: string): void {
    const node = this.nodesById.get(nodeId);
    if (!node) {
      throw new VariationTreeError(`ไม่พบโหนด id="${nodeId}" — ไม่สามารถใส่ annotation ได้`);
    }
    node.annotation = annotation;
  }

  /**
   * ทำเครื่องหมายเส้นทางจากรากถึงโหนดที่ระบุว่าเป็น "สายหลัก" ใหม่ (isMainLine = true)
   * และล้างเครื่องหมายสายหลักเดิมของพี่น้องโหนดในทุกระดับที่เส้นทางนี้ผ่าน — ใช้เมื่อ
   * ผู้เล่นตัดสินใจ "รับเอาสายที่ลองไว้เป็นสายจริง" ระหว่างอยู่ในแซนด์บ็อกซ์
   */
  public promoteToMainLine(nodeId: string): void {
    const path = this.getPathToNode(nodeId);
    const pathIds = new Set(path.map((node) => node.id));

    for (const node of path) {
      const parentId = this.parentIdById.get(node.id) ?? null;
      if (parentId === null) continue;
      const parent = this.nodesById.get(parentId);
      if (!parent) continue;
      for (const sibling of parent.children) {
        sibling.isMainLine = pathIds.has(sibling.id);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  public getRoot(): VariationNode {
    return this.root;
  }

  public findNode(id: string): VariationNode | null {
    return this.nodesById.get(id) ?? null;
  }

  /** จำนวนโหนดทั้งหมดในต้นไม้ (รวมราก) */
  public getNodeCount(): number {
    return this.nodeCount;
  }

  /**
   * เส้นทางจากรากถึงโหนดที่ระบุ (รวมทั้งรากและโหนดปลายทาง) — โยน VariationTreeError
   * ถ้าไม่พบโหนดนั้นในต้นไม้ ใช้สำหรับ VariationExplorer แสดง breadcrumb และสำหรับ
   * ArrowLayer คำนวณว่าต้องวาดลูกศรจากตำแหน่งไหนไปตำแหน่งไหนตามลำดับ
   */
  public getPathToNode(id: string): readonly VariationNode[] {
    const target = this.nodesById.get(id);
    if (!target) {
      throw new VariationTreeError(`ไม่พบโหนด id="${id}" ในต้นไม้ — ไม่สามารถสร้าง path ได้`);
    }

    const path: VariationNode[] = [];
    let currentId: string | null = id;
    while (currentId !== null) {
      const current = this.nodesById.get(currentId);
      if (!current) break;
      path.push(current);
      currentId = this.parentIdById.get(currentId) ?? null;
    }
    return path.reverse();
  }

  /**
   * ไล่จากรากตามกิ่งที่ isMainLine === true ไปเรื่อยๆ จนสุดทาง — คืนสายที่เล่นจริง
   * ในเกม (ใช้แสดงใน MoveList เป็นค่าเริ่มต้น ก่อนผู้เล่นจะกดเข้าไปดูสายอื่น)
   */
  public getMainLine(): readonly VariationNode[] {
    const path: VariationNode[] = [this.root];
    let current = this.root;

    for (;;) {
      const mainChild = current.children.find((child) => child.isMainLine);
      if (!mainChild) break;
      path.push(mainChild);
      current = mainChild;
    }

    return path;
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private registerNode(node: VariationNode, parentId: string | null): void {
    this.nodesById.set(node.id, node);
    this.parentIdById.set(node.id, parentId);
    this.nodeCount += 1;
  }

  /** ใช้ crypto.randomUUID() เมื่อมี (browser/Node ที่ทันสมัย) พร้อม fallback แบบ counter สำหรับ environment ที่ไม่มี Web Crypto API */
  private generateNodeId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    this.fallbackIdCounter += 1;
    return `node_${this.fallbackIdCounter.toString(36)}`;
  }
}
