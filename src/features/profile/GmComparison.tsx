/**
 * GmComparison.tsx
 * ---------------------------------------------------------------------------
 * การ์ดแสดง Grandmaster ที่สไตล์ใกล้เคียงที่สุด 3 อันดับแรก — เรียงลำดับเอง
 * ตาม `score` จากมากไปน้อยก่อนตัด top 3 เสมอ (defensive: ไม่ไว้ใจว่า array
 * ที่ส่งเข้ามาจะถูกเรียงมาแล้วจากผู้เรียก) ป้องกัน UI แสดงอันดับผิดถ้าผู้เรียก
 * ลืมเรียงมาก่อน
 * ---------------------------------------------------------------------------
 */

import { useMemo } from 'react';
import type { GrandmasterSimilarityEntry } from '../../shared/types/schema';

// ============================================================================
// Types
// ============================================================================

export interface GmComparisonProps {
  readonly similarities: readonly GrandmasterSimilarityEntry[];
  readonly className?: string;
}

const TOP_N = 3;

const RANK_ACCENT: readonly string[] = [
  'ring-amber-400/60', // อันดับ 1
  'ring-slate-400/50', // อันดับ 2
  'ring-orange-700/50', // อันดับ 3
];

const RANK_BAR_COLOR: readonly string[] = ['bg-amber-400', 'bg-slate-400', 'bg-orange-600'];

// ============================================================================
// Component
// ============================================================================

export function GmComparison(props: GmComparisonProps) {
  const { similarities, className } = props;

  const topMatches = useMemo(() => [...similarities].sort((a, b) => b.score - a.score).slice(0, TOP_N), [similarities]);

  return (
    <div className={['rounded-2xl bg-slate-900/60 p-4 ring-1 ring-slate-800', className ?? ''].join(' ')}>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">สไตล์ใกล้เคียงใคร</h3>

      {topMatches.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-sm text-slate-500">ยังไม่มีข้อมูลเพียงพอสำหรับเปรียบเทียบ</div>
      ) : (
        <div className="flex flex-col gap-3">
          {topMatches.map((match, index) => (
            <GmComparisonCard key={match.name} match={match} rank={index} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Single card
// ============================================================================

interface GmComparisonCardProps {
  readonly match: GrandmasterSimilarityEntry;
  readonly rank: number;
}

function GmComparisonCard(props: GmComparisonCardProps) {
  const { match, rank } = props;
  const percent = Math.round(clamp0to1(match.score) * 100);

  return (
    <div className={['rounded-xl bg-slate-800/50 p-3 ring-1', RANK_ACCENT[rank] ?? 'ring-slate-700'].join(' ')}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 text-xs font-bold text-slate-300">
            #{rank + 1}
          </span>
          <span className="font-medium text-slate-100">{match.name}</span>
        </div>
        <span className="text-sm font-semibold text-sky-300">{percent}%</span>
      </div>

      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-950">
        <div
          className={['h-full rounded-full transition-all duration-500', RANK_BAR_COLOR[rank] ?? 'bg-sky-400'].join(' ')}
          style={{ width: `${percent}%` }}
        />
      </div>

      {match.sharedTraits.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-medium text-emerald-400">จุดที่คล้ายกัน</div>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-slate-300">
            {match.sharedTraits.map((trait) => (
              <li key={trait}>{trait}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {match.divergence.length > 0 ? (
        <div className="mt-2">
          <div className="text-xs font-medium text-amber-400">จุดที่ต่างกัน</div>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-slate-300">
            {match.divergence.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function clamp0to1(value: number): number {
  return Math.min(1, Math.max(0, value));
}
