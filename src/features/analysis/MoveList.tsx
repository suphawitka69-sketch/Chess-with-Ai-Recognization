/**
 * MoveList.tsx
 * ---------------------------------------------------------------------------
 * ตารางบันทึกตาเดิน แบ่งคอลัมน์ขาว/ดำ 1 แถวต่อ 1 moveNumber (เต็มตา) — คลิกที่
 * ตาไหนก็เรียก onSelectPly(ply) ทันที ไฮไลต์ cell ของ ply ที่กำลังดูอยู่
 *
 * รับ AnalyzedMove[] ผ่าน props ล้วนๆ ไม่รู้จัก store — ผู้เรียก
 * (AnalysisScreen) เป็นคนแปลง MoveLogRecord ของจริงเป็น AnalyzedMove ก่อน
 * ---------------------------------------------------------------------------
 */

import { useMemo } from 'react';
import { CLASSIFICATION_BADGE, CLASSIFICATION_COLOR, type AnalyzedMove } from './types';

// ============================================================================
// Types
// ============================================================================

export interface MoveListProps {
  readonly moves: readonly AnalyzedMove[];
  readonly currentPly?: number;
  readonly onSelectPly: (ply: number) => void;
}

interface MoveRow {
  readonly moveNumber: number;
  readonly white: AnalyzedMove | null;
  readonly black: AnalyzedMove | null;
}

// ============================================================================
// Helpers
// ============================================================================

function groupIntoRows(moves: readonly AnalyzedMove[]): readonly MoveRow[] {
  const rows: MoveRow[] = [];
  for (const move of moves) {
    const rowIndex = move.moveNumber - 1;
    if (!rows[rowIndex]) {
      rows[rowIndex] = { moveNumber: move.moveNumber, white: null, black: null };
    }
    if (move.color === 'w') {
      rows[rowIndex] = { ...rows[rowIndex], white: move };
    } else {
      rows[rowIndex] = { ...rows[rowIndex], black: move };
    }
  }
  return rows.filter(Boolean);
}

// ============================================================================
// Move cell
// ============================================================================

function MoveCell({
  move,
  isActive,
  onSelectPly,
}: {
  readonly move: AnalyzedMove | null;
  readonly isActive: boolean;
  readonly onSelectPly: (ply: number) => void;
}): JSX.Element {
  if (!move) return <td className="px-2 py-1 text-sm text-gray-300">…</td>;

  const badge = move.classification ? CLASSIFICATION_BADGE[move.classification] : undefined;
  const badgeColor = move.classification ? CLASSIFICATION_COLOR[move.classification] : 'text-gray-500';

  return (
    <td className="px-1 py-0.5">
      <button
        type="button"
        onClick={() => onSelectPly(move.ply)}
        className={`flex w-full items-baseline gap-1 rounded px-2 py-1 text-left text-sm transition-colors ${
          isActive ? 'bg-blue-100 font-semibold text-blue-900' : 'hover:bg-gray-100 text-gray-800'
        }`}
      >
        <span>{move.san}</span>
        {badge && <span className={`text-xs font-bold ${badgeColor}`}>{badge}</span>}
        {move.centipawnLoss !== null && move.centipawnLoss > 0 && (
          <span className="ml-auto text-[10px] text-gray-400">-{move.centipawnLoss}</span>
        )}
      </button>
    </td>
  );
}

// ============================================================================
// Component
// ============================================================================

export function MoveList({ moves, currentPly, onSelectPly }: MoveListProps): JSX.Element {
  const rows = useMemo(() => groupIntoRows(moves), [moves]);

  return (
    <div className="max-h-full overflow-y-auto rounded-md border border-gray-200">
      <table className="w-full table-fixed border-collapse">
        <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="w-10 px-2 py-1 text-left font-medium">#</th>
            <th className="px-2 py-1 text-left font-medium">ขาว</th>
            <th className="px-2 py-1 text-left font-medium">ดำ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.moveNumber} className="border-t border-gray-100">
              <td className="px-2 py-1 text-xs text-gray-400">{row.moveNumber}.</td>
              <MoveCell move={row.white} isActive={row.white?.ply === currentPly} onSelectPly={onSelectPly} />
              <MoveCell move={row.black} isActive={row.black?.ply === currentPly} onSelectPly={onSelectPly} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default MoveList;
