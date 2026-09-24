/**
 * GameOverModal.tsx
 * ---------------------------------------------------------------------------
 * แยกออกมาจาก PlayScreen.tsx เป็นไฟล์ของตัวเอง เพื่อให้ทดสอบ/แก้ไข UI สรุปผล
 * ได้อิสระจาก control panel — component นี้เป็น "pure display" ล้วนๆ ไม่รู้จัก
 * useGameStore เลย รับทุกอย่างผ่าน props เท่านั้น (ตัดสินใจ render จาก
 * `outcome` ที่ PlayScreen ส่งเข้ามา ไม่ subscribe store เอง เพื่อไม่ให้มีจุด
 * อ่าน state ซ้ำซ้อนสองที่)
 *
 * ปุ่ม "รับการสอน (Analyze)" ตอนนี้เชื่อมกับ GameAnalyzer/AnalysisScreen แล้ว
 * (Phase 3) — จึงเปิดใช้งานเสมอ ไม่มีสถานะ "เร็วๆ นี้" อีกต่อไป การจะเรียก
 * onAnalyze จริงหรือไม่ขึ้นกับว่าผู้เรียก (PlayScreen) ส่ง callback มาหรือเปล่า
 * ---------------------------------------------------------------------------
 */

import type { AnyEndReason, GameOutcome } from '../../state/useGameStore';
import type { PieceColor } from '../../core/chess/GameEngine';

// ============================================================================
// Types
// ============================================================================

export interface GameOverModalProps {
  readonly outcome: GameOutcome;
  readonly playerColor: PieceColor | null;
  /** "เล่นอีกครั้ง" — กลับไปหน้าตั้งค่าเกมใหม่ (หรือจะ auto-start ด้วยค่าตั้งค่าเดิมก็ได้ แล้วแต่ผู้เรียกกำหนด) */
  readonly onRematch: () => void;
  /** "เมนูหลัก" — ไม่บังคับ ปล่อยว่างถ้าหน้านี้ไม่มีเมนูอื่นให้กลับไป (ปุ่มจะไม่แสดงถ้าไม่ส่งมา) */
  readonly onMenu?: () => void;
  /** "รับการสอน" — ไม่บังคับ ถ้าไม่ส่งมาปุ่มจะกดได้แต่ไม่มีอะไรเกิดขึ้น */
  readonly onAnalyze?: () => void;
  /** คงไว้เพื่อความเข้ากันได้กับผู้เรียกเดิม — ไม่ใช้ในการตัดสินใจ enable/disable ปุ่มอีกต่อไป */
  readonly analyzeAvailable?: boolean;
}

// ============================================================================
// Label helpers
// ============================================================================

export function terminationLabelTh(termination: AnyEndReason): string {
  switch (termination) {
    case 'checkmate':
      return 'รุกฆาต';
    case 'stalemate':
      return 'อับ (Stalemate)';
    case 'threefold_repetition':
      return 'เดินซ้ำตำแหน่งเดิม 3 ครั้ง';
    case 'insufficient_material':
      return 'หมากไม่พอรุกฆาต';
    case 'fifty_move_rule':
      return 'ครบ 50 ตาไม่มีการกินหมาก/เดินเบี้ย';
    case 'resignation':
      return 'ยอมแพ้';
    case 'timeout':
      return 'หมดเวลา';
    default:
      return termination;
  }
}

export function outcomeHeadlineTh(winner: 'w' | 'b' | 'draw', playerColor: PieceColor | null): string {
  if (winner === 'draw') return 'เสมอ';
  if (playerColor && winner === playerColor) return 'คุณชนะ! 🎉';
  return 'คุณแพ้';
}

function outcomeAccentClass(winner: 'w' | 'b' | 'draw', playerColor: PieceColor | null): string {
  if (winner === 'draw') return 'text-amber-300';
  if (playerColor && winner === playerColor) return 'text-emerald-300';
  return 'text-red-300';
}

// ============================================================================
// Component
// ============================================================================

export function GameOverModal(props: GameOverModalProps) {
  const { outcome, playerColor, onRematch, onMenu, onAnalyze } = props;

  const handleAnalyzeClick = (): void => {
    onAnalyze?.();
  };

  const didPlayerWin = playerColor !== null && outcome.winner === playerColor;
  const didDraw = outcome.winner === 'draw';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-over-headline"
    >
      <div className="w-full max-w-md rounded-3xl bg-slate-900 p-6 text-center ring-1 ring-slate-800 shadow-2xl shadow-slate-950/50">
        <div className={['mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full text-2xl', didPlayerWin ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40' : didDraw ? 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40' : 'bg-red-500/15 text-red-300 ring-1 ring-red-500/40'].join(' ')}>
          {didPlayerWin ? '🏆' : didDraw ? '🤝' : '💥'}
        </div>

        <h3 id="game-over-headline" className={['text-3xl font-black tracking-tight', outcomeAccentClass(outcome.winner, playerColor)].join(' ')}>
          {outcomeHeadlineTh(outcome.winner, playerColor)}
        </h3>
        <p className="mt-2 text-sm text-slate-400">
          {didPlayerWin ? 'เกมนี้คุณเอาชนะได้สำเร็จ' : didDraw ? 'เกมจบด้วยผลเสมอ' : 'เกมจบลงด้วยการที่คุณแพ้'}
        </p>
        <p className="mt-1.5 text-sm text-slate-500">{terminationLabelTh(outcome.termination)}</p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleAnalyzeClick}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-400"
          >
            <span>รับการสอน</span>
            <span className="text-xs font-normal opacity-75">(Analyze)</span>
          </button>

          {onMenu ? (
            <button
              type="button"
              onClick={onMenu}
              className="w-full rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700"
            >
              เมนูหลัก
            </button>
          ) : null}

          <button
            type="button"
            onClick={onRematch}
            className="w-full rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-200 ring-1 ring-slate-700 transition-colors hover:bg-slate-700"
          >
            เล่นอีกครั้ง
          </button>
        </div>
      </div>
    </div>
  );
}