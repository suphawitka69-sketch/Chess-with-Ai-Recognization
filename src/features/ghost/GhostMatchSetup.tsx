/**
 * GhostMatchSetup.tsx
 * ---------------------------------------------------------------------------
 * Modal เลือกจุดในอดีตจาก `progression` มาเป็นค่าตั้งต้นของ Ghost — component
 * นี้ทำหน้าที่แค่ "เลือกแล้วยืนยัน Elo/วันที่" ไม่รู้จัก GhostEngine เลย
 * ผลลัพธ์สุดท้ายที่ส่งออกไปคือตัวเลข estimatedElo ล้วนๆ ผ่าน onStartGhostGame
 * — ผู้เรียก (ProfileScreen/App) เป็นคนตัดสินใจว่าจะเอาเลขนี้ไปสร้าง Ghost
 * จริงอย่างไร
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from 'react';
import type { ProgressionPoint } from '../../shared/types/schema';

// ============================================================================
// Types
// ============================================================================

export interface GhostMatchSetupProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onStartGhostGame: (snapshotElo: number) => void;
  readonly progression: readonly ProgressionPoint[];
}

// ============================================================================
// Component
// ============================================================================

export function GhostMatchSetup(props: GhostMatchSetupProps) {
  const { isOpen, onClose, onStartGhostGame, progression } = props;

  const sorted = useMemo(
    () => [...progression].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [progression],
  );

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // ทุกครั้งที่เปิด modal ใหม่ ตั้งค่าเริ่มต้นเป็น "เกมล่าสุด" ให้อัตโนมัติ
  useEffect(() => {
    if (isOpen && sorted.length > 0) {
      setSelectedIndex(sorted.length - 1);
    } else if (!isOpen) {
      setSelectedIndex(null);
    }
  }, [isOpen, sorted.length]);

  if (!isOpen) return null;

  const selected = selectedIndex !== null ? (sorted[selectedIndex] ?? null) : null;
  const weekAgoIndex = findClosestIndexToDaysAgo(sorted, 7);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ghost-setup-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-slate-900 p-6 ring-1 ring-slate-800 shadow-2xl">
        <h3 id="ghost-setup-title" className="text-lg font-bold text-slate-100">
          ดวลกับตัวเองในอดีต
        </h3>
        <p className="mt-1 text-sm text-slate-400">เลือกช่วงเวลาที่อยากย้อนกลับไปดวลด้วย</p>

        {sorted.length === 0 ? (
          <div className="mt-4 rounded-xl bg-slate-800/50 p-4 text-center text-sm text-slate-500">
            ยังไม่มีข้อมูลพัฒนาการเพียงพอสำหรับสร้าง Ghost — เล่นให้จบสักสองสามเกมก่อน
          </div>
        ) : (
          <>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setSelectedIndex(sorted.length - 1)}
                className={presetButtonClass(selectedIndex === sorted.length - 1)}
              >
                เกมล่าสุด
              </button>
              {weekAgoIndex !== null ? (
                <button type="button" onClick={() => setSelectedIndex(weekAgoIndex)} className={presetButtonClass(selectedIndex === weekAgoIndex)}>
                  สัปดาห์ที่แล้ว
                </button>
              ) : null}
            </div>

            <div className="mt-3 max-h-48 overflow-y-auto rounded-xl bg-slate-950/40 ring-1 ring-slate-800">
              {sorted.map((point, index) => (
                <button
                  key={point.gameId}
                  type="button"
                  onClick={() => setSelectedIndex(index)}
                  className={[
                    'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors',
                    selectedIndex === index ? 'bg-sky-500/15 text-sky-300' : 'text-slate-300 hover:bg-slate-800/60',
                  ].join(' ')}
                >
                  <span>{formatDateTh(point.date)}</span>
                  <span className="text-xs text-slate-500">Elo {Math.round(point.estimatedElo)}</span>
                </button>
              ))}
            </div>

            {selected ? (
              <div className="mt-4 rounded-xl bg-slate-800/50 p-3 text-sm">
                <div className="text-slate-400">กำลังจะดวลกับตัวเองเมื่อ</div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="font-medium text-slate-100">{formatDateTh(selected.date)}</span>
                  <span className="text-lg font-bold text-sky-300">{Math.round(selected.estimatedElo)} Elo</span>
                </div>
              </div>
            ) : null}
          </>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            disabled={selected === null}
            onClick={() => {
              if (selected) onStartGhostGame(selected.estimatedElo);
            }}
            className="w-full rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            เริ่มดวลกับ Ghost
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700"
          >
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function presetButtonClass(active: boolean): string {
  return [
    'flex-1 rounded-lg px-3 py-2 text-xs font-medium ring-1 transition-colors',
    active ? 'bg-sky-500/20 text-sky-300 ring-sky-500/60' : 'bg-slate-800/60 text-slate-300 ring-slate-700 hover:bg-slate-800',
  ].join(' ');
}

function findClosestIndexToDaysAgo(sorted: readonly ProgressionPoint[], days: number): number | null {
  if (sorted.length === 0) return null;

  const targetMs = Date.now() - days * 24 * 60 * 60 * 1000;
  let closestIndex = 0;
  let closestDiffMs = Number.POSITIVE_INFINITY;

  sorted.forEach((point, index) => {
    const diff = Math.abs(new Date(point.date).getTime() - targetMs);
    if (diff < closestDiffMs) {
      closestDiffMs = diff;
      closestIndex = index;
    }
  });

  return closestIndex;
}

function formatDateTh(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}
