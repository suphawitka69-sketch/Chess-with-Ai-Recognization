/**
 * useSandboxStore.ts (Fixed & Aligned with VariationTree.ts)
 * ---------------------------------------------------------------------------
 * State ของ Analysis Sandbox — แยกขาดจาก useGameStore 100% ไม่ persist ลง Dexie
 * ---------------------------------------------------------------------------
 */

import { create } from 'zustand';
import { GameEngine, GameEngineError, type MoveInput, type MoveRecord, type PieceColor } from '../core/chess/GameEngine';
import { VariationTree, type VariationNode } from '../core/analysis/VariationTree';
import type { UciScore } from '../core/engine/UciProtocol';
import type { EvalScore } from '../features/analysis/types';
import { getEnginePool } from './useEngineStore';

export class SandboxStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxStoreError';
  }
}

let sandboxEngineInstance: GameEngine | null = null;
let variationTreeInstance: VariationTree | null = null;

function teardownInstances(): void {
  sandboxEngineInstance = null;
  variationTreeInstance = null;
}

export function getSandboxEngine(): GameEngine {
  if (!sandboxEngineInstance) {
    throw new SandboxStoreError('Sandbox engine is not initialized — call enterAt() first');
  }
  return sandboxEngineInstance;
}

export function getSandboxTree(): VariationTree {
  if (!variationTreeInstance) {
    throw new SandboxStoreError('Sandbox tree is not initialized — call enterAt() first');
  }
  return variationTreeInstance;
}

function toWhitePovEval(score: UciScore | undefined, sideToMove: PieceColor): EvalScore | null {
  if (!score) return null;
  const normalizedValue = sideToMove === 'w' ? score.value : -score.value;
  return { type: score.kind, value: normalizedValue };
}

function scoreToComparableCp(score: EvalScore | null): number {
  if (!score) return 0;
  if (score.type === 'mate') {
    const distance = Math.abs(score.value);
    return score.value > 0 ? 10000 - distance * 100 : -10000 - distance * 100;
  }
  return score.value;
}

function buildBranchExplanation(delta: number | null, bestMove: string | null): string | null {
  if (delta === null) {
    return 'ยังไม่มีข้อมูลวิเคราะห์สายนี้ครบถ้วนในขณะนี้ — ให้รอระบบประเมินอีกสักครู่';
  }

  if (delta >= 100) {
    return 'ยอดเยี่ยม! สายนี้ช่วยแก้ปัญหาได้จริง และทำให้คุณได้เปรียบกลับมา';
  }

  if (delta <= -100) {
    return bestMove && bestMove !== '(none)'
      ? `สายนี้อันตราย! คู่ต่อสู้สวนกลับด้วย ${bestMove} ทำให้คุณเสียเปรียบหนักกว่าเดิม`
      : 'สายนี้อันตราย! คู่ต่อสู้สวนกลับได้ทันและทำให้คุณเสียเปรียบหนักกว่าเดิม';
  }

  if (delta >= 25) {
    return `สายนี้ดีขึ้นเล็กน้อย (${Math.round(delta)} แต้ม) แต่คู่ต่อสู้ยังมีแนวตอบโต้ที่ต้องระวัง`; 
  }

  if (delta <= -25) {
    return `สายนี้แย่ลงเล็กน้อย (${Math.round(Math.abs(delta))} แต้ม) เพราะคู่ต่อสู้ตอบโต้ได้ทัน`; 
  }

  return `สายนี้ใกล้เคียงกับตาจริง (${Math.round(delta)} แต้ม) — คุณยังอยู่ในสถานการณ์ที่สามารถต่อยอดต่อไปได้`; 
}

export interface SandboxState {
  readonly active: boolean;
  readonly rootGameId: string | null;
  readonly rootPly: number | null;
  readonly fen: string;
  readonly turn: PieceColor | null;
  readonly currentNodeId: string | null;
  readonly tree: VariationNode | null;
  readonly errorMessage: string | null;
  readonly isEngineThinking: boolean;
  readonly branchEval: EvalScore | null;
  readonly evalDeltaVsMainline: number | null;
  readonly branchExplanation: string | null;
}

export interface SandboxActions {
  readonly enterAt: (gameId: string, ply: number, fen: string) => void;
  readonly tryMove: (input: MoveInput) => Promise<void>;
  readonly jumpTo: (nodeId: string) => void;
  readonly resetBranch: () => void;
  readonly exit: () => void;
  readonly clearError: () => void;
}

export interface SandboxStore {
  readonly state: SandboxState;
  readonly actions: SandboxActions;
}

const initialSandboxState: SandboxState = {
  active: false,
  rootGameId: null,
  rootPly: null,
  fen: '',
  turn: null,
  currentNodeId: null,
  tree: null,
  errorMessage: null,
  isEngineThinking: false,
  branchEval: null,
  evalDeltaVsMainline: null,
  branchExplanation: null,
};

export const useSandboxStore = create<SandboxStore>()((set, get) => ({
  state: initialSandboxState,

  actions: {
    enterAt: (gameId, ply, fen) => {
      teardownInstances();

      let engine: GameEngine;
      try {
        engine = new GameEngine(fen);
      } catch (err) {
        set(() => ({
          state: {
            ...initialSandboxState,
            errorMessage: err instanceof GameEngineError ? err.message : `FEN ไม่ถูกต้อง: ${String(err)}`,
          },
        }));
        return;
      }

      const tree = new VariationTree({ rootFen: fen });

      sandboxEngineInstance = engine;
      variationTreeInstance = tree;

      set(() => ({
        state: {
          active: true,
          rootGameId: gameId,
          rootPly: ply,
          fen: engine.getFen(),
          turn: engine.getTurn(),
          currentNodeId: tree.getRoot().id,
          tree: { ...tree.getRoot() },
          errorMessage: null,
          isEngineThinking: false,
          branchEval: null,
          evalDeltaVsMainline: null,
          branchExplanation: null,
        },
      }));
    },

    tryMove: async (input) => {
      const current = get().state;
      const engine = sandboxEngineInstance;
      const tree = variationTreeInstance;

      if (!current.active || !engine || !tree || current.currentNodeId === null) {
        set((s) => ({ state: { ...s.state, errorMessage: 'Sandbox ยังไม่ได้เริ่ม — เรียก enterAt() ก่อน' } }));
        return;
      }

      set((s) => ({
        state: {
          ...s.state,
          isEngineThinking: true,
          branchEval: null,
          evalDeltaVsMainline: null,
          branchExplanation: null,
          errorMessage: null,
        },
      }));

      let mainlineEval: EvalScore | null = null;
      const pool = getEnginePool();

      try {
        const rootAnalysis = pool ? await pool.analyzePosition(engine.getFen(), engine.getUciMoveList(), 8, 200) : null;
        const rootInfo = rootAnalysis ? rootAnalysis.finalLinesByMultiPv.get(1) ?? rootAnalysis.infoHistory[rootAnalysis.infoHistory.length - 1] : undefined;
        mainlineEval = toWhitePovEval(rootInfo?.score, engine.getTurn());
      } catch {
        mainlineEval = null;
      }

      let record: MoveRecord;
      try {
        record = engine.makeMove(input);
      } catch (err) {
        const message = err instanceof GameEngineError ? err.message : `เดินไม่ได้: ${String(err)}`;
        set((s) => ({
          state: { ...s.state, errorMessage: message, isEngineThinking: false },
        }));
        return;
      }

      const playerNode = tree.addMove(current.currentNodeId, record, null, { isMainLine: false });

      if (!pool) {
        set((s) => ({
          state: {
            ...s.state,
            fen: engine.getFen(),
            turn: engine.getTurn(),
            currentNodeId: playerNode.id,
            tree: { ...tree.getRoot() },
            isEngineThinking: false,
            branchEval: null,
            evalDeltaVsMainline: null,
            branchExplanation: 'ยังไม่สามารถเชื่อมต่อ Stockfish เพื่อวิเคราะห์สายนี้ได้ในขณะนี้',
          },
        }));
        return;
      }

      try {
        const analysis = await pool.analyzePosition(engine.getFen(), engine.getUciMoveList(), 8, 200);
        const finalInfo = analysis.finalLinesByMultiPv.get(1) ?? analysis.infoHistory[analysis.infoHistory.length - 1];
        const branchScore = toWhitePovEval(finalInfo?.score, engine.getTurn());
        const bestMove = analysis.bestMove.bestMove;
        const delta = branchScore && mainlineEval ? scoreToComparableCp(branchScore) - scoreToComparableCp(mainlineEval) : null;
        let finalNodeId = playerNode.id;
        let replyMoveUsable: string | null = null;

        if (bestMove && bestMove !== '(none)') {
          const replyRecord = engine.makeMove(bestMove);
          const replyNode = tree.addMove(playerNode.id, replyRecord, branchScore, { isEngineBest: true });
          finalNodeId = replyNode.id;
          replyMoveUsable = bestMove;
        }

        set((s) => ({
          state: {
            ...s.state,
            fen: engine.getFen(),
            turn: engine.getTurn(),
            currentNodeId: finalNodeId,
            tree: { ...tree.getRoot() },
            isEngineThinking: false,
            branchEval: branchScore,
            evalDeltaVsMainline: delta,
            branchExplanation: buildBranchExplanation(delta, replyMoveUsable),
            errorMessage: null,
          },
        }));
      } catch (err) {
        set((s) => ({
          state: {
            ...s.state,
            fen: engine.getFen(),
            turn: engine.getTurn(),
            currentNodeId: playerNode.id,
            tree: { ...tree.getRoot() },
            isEngineThinking: false,
            branchEval: null,
            evalDeltaVsMainline: null,
            branchExplanation: 'เกิดข้อผิดพลาดระหว่างการวิเคราะห์สายแยก — คุณยังสามารถลองเดินซ้ำได้',
            errorMessage: err instanceof Error ? err.message : String(err),
          },
        }));
      }
    },

    jumpTo: (nodeId) => {
      const current = get().state;
      const engine = sandboxEngineInstance;
      const tree = variationTreeInstance;

      if (!current.active || !engine || !tree) {
        set((s) => ({ state: { ...s.state, errorMessage: 'Sandbox ยังไม่ได้เริ่ม — เรียก enterAt() ก่อน' } }));
        return;
      }

      const node = tree.findNode(nodeId);
      if (!node) {
        set((s) => ({ state: { ...s.state, errorMessage: `ไม่พบตำแหน่งที่ต้องการกระโดดไป (node "${nodeId}")` } }));
        return;
      }

      try {
        engine.loadFen(node.fen);
      } catch (err) {
        set((s) => ({
          state: { ...s.state, errorMessage: err instanceof GameEngineError ? err.message : String(err) },
        }));
        return;
      }

      set((s) => ({
        state: {
          ...s.state,
          fen: engine.getFen(),
          turn: engine.getTurn(),
          currentNodeId: nodeId,
          isEngineThinking: false,
          branchEval: node.eval,
          evalDeltaVsMainline: null,
          branchExplanation: null,
          errorMessage: null,
        },
      }));
    },

    resetBranch: () => {
      const current = get().state;
      const engine = sandboxEngineInstance;
      const tree = variationTreeInstance;

      if (!current.active || !engine || !tree) {
        return;
      }

      try {
        engine.loadFen(tree.getRoot().fen);
      } catch (err) {
        set((s) => ({ state: { ...s.state, errorMessage: err instanceof GameEngineError ? err.message : String(err) } }));
        return;
      }

      set((s) => ({
        state: {
          ...s.state,
          fen: engine.getFen(),
          turn: engine.getTurn(),
          currentNodeId: tree.getRoot().id,
          tree: { ...tree.getRoot() },
          isEngineThinking: false,
          branchEval: null,
          evalDeltaVsMainline: null,
          branchExplanation: null,
          errorMessage: null,
        },
      }));
    },

    exit: () => {
      teardownInstances();
      set(() => ({ state: initialSandboxState }));
    },

    clearError: () => {
      set((s) => ({ state: { ...s.state, errorMessage: null } }));
    },
  },
}));

// Selector Helpers
export function useSandboxActions(): SandboxActions {
  return useSandboxStore((s) => s.actions);
}
export function useSandboxActive(): boolean {
  return useSandboxStore((s) => s.state.active);
}
export function useSandboxFen(): string {
  return useSandboxStore((s) => s.state.fen);
}
export function useSandboxTurn(): PieceColor | null {
  return useSandboxStore((s) => s.state.turn);
}
export function useSandboxCurrentNodeId(): string | null {
  return useSandboxStore((s) => s.state.currentNodeId);
}
export function useSandboxTree(): VariationNode | null {
  return useSandboxStore((s) => s.state.tree);
}
export function useSandboxErrorMessage(): string | null {
  return useSandboxStore((s) => s.state.errorMessage);
}
export function useSandboxCurrentPath(): readonly VariationNode[] {
  const currentNodeId = useSandboxStore((s) => s.state.currentNodeId);
  if (!currentNodeId || !variationTreeInstance) return [];
  return variationTreeInstance.getPathToNode(currentNodeId);
}