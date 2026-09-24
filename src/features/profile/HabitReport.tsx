/**
 * HabitReport.tsx
 * ---------------------------------------------------------------------------
 * รายงานสองส่วน: (1) HabitPattern — trigger → response → อัตราสำเร็จ →
 * คำแนะนำ และ (2) WeaknessItem — จุดอ่อนจัดอันดับความรุนแรงพร้อมแนวโน้ม
 * ทั้งสอง props เป็น array อิสระจากกัน ส่งมาว่างอันใดอันหนึ่งได้โดยไม่กระทบกัน
 * ---------------------------------------------------------------------------
 */

import { Lightbulb, Minus, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useState } from 'react';
import type { HabitPattern, WeaknessRankingEntry } from '../../shared/types/schema';

// ============================================================================
// Types
// ============================================================================

export interface HabitReportProps {
  readonly habitPatterns: readonly HabitPattern[];
  readonly weaknessRanking: readonly WeaknessRankingEntry[];
  readonly className?: string;
}

type SeverityLevel = 'critical' | 'high' | 'medium';
type WeaknessTrend = WeaknessRankingEntry['trend'];

// ============================================================================
// Severity classification
// ============================================================================

const SEVERITY_THRESHOLDS = { critical: 0.75, high: 0.5 } as const;

function classifySeverity(severity: number): SeverityLevel {
  if (severity >= SEVERITY_THRESHOLDS.critical) return 'critical';
  if (severity >= SEVERITY_THRESHOLDS.high) return 'high';
  return 'medium';
}

const SEVERITY_BADGE: Record<SeverityLevel, { readonly labelTh: string; readonly className: string }> = {
  critical: { labelTh: 'วิกฤต', className: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/40' },
  high: { labelTh: 'สูง', className: 'bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/40' },
  medium: { labelTh: 'ปานกลาง', className: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40' },
};

const TREND_DISPLAY: Record<WeaknessTrend, { readonly labelTh: string; readonly className: string; readonly Icon: typeof TrendingUp }> = {
  worsening: { labelTh: 'แย่ลง', className: 'text-red-400', Icon: TrendingUp },
  improving: { labelTh: 'ดีขึ้น', className: 'text-emerald-400', Icon: TrendingDown },
  flat: { labelTh: 'ทรงตัว', className: 'text-slate-400', Icon: Minus },
};

// ============================================================================
// Component
// ============================================================================

export function HabitReport(props: HabitReportProps) {
  const { habitPatterns, weaknessRanking, className } = props;
  const [activeTip, setActiveTip] = useState<string | null>(null);

  return (
    <>
      <div className={['flex flex-col gap-4', className ?? ''].join(' ')}>
        <WeaknessRankingCard weaknessRanking={weaknessRanking} onOpenTip={setActiveTip} />
        <HabitPatternCard habitPatterns={habitPatterns} />
      </div>

      {activeTip ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl ring-1 ring-slate-800">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-sky-300">
                <Lightbulb size={16} />
                วิธีฝึก
              </div>
              <button
                type="button"
                aria-label="ปิดหน้าต่างวิธีฝึก"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-slate-300 transition hover:bg-slate-700"
                onClick={() => setActiveTip(null)}
              >
                <X size={16} />
              </button>
            </div>

            <p className="whitespace-pre-line text-sm leading-6 text-slate-200">{activeTip}</p>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setActiveTip(null)}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ============================================================================
// Weakness ranking
// ============================================================================

function WeaknessRankingCard(props: {
  readonly weaknessRanking: readonly WeaknessRankingEntry[];
  readonly onOpenTip: (tip: string) => void;
}) {
  const { weaknessRanking, onOpenTip } = props;

  return (
    <div className="rounded-2xl bg-slate-900/60 p-4 ring-1 ring-slate-800">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">จุดอ่อนที่ควรฝึก</h3>

      {weaknessRanking.length === 0 ? (
        <div className="flex h-20 items-center justify-center px-3 text-center text-sm text-slate-500">
          ยังไม่พบจุดอ่อนที่เด่นชัด <br />
          ต้องมีข้อมูลประมาณ 3-5 เกม/เหตุการณ์ที่เกิดซ้ำ จึงจะเริ่มแสดงผลได้
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {weaknessRanking.map((item) => (
            <WeaknessItemRow key={item.area} item={item} onOpenTip={onOpenTip} />
          ))}
        </div>
      )}
    </div>
  );
}

function WeaknessItemRow(props: { readonly item: WeaknessRankingEntry; readonly onOpenTip: (tip: string) => void }) {
  const { item, onOpenTip } = props;
  const severity = classifySeverity(item.severity);
  const badge = SEVERITY_BADGE[severity];
  const trend = TREND_DISPLAY[item.trend];
  const TrendIcon = trend.Icon;

  return (
    <div className="rounded-xl bg-slate-800/50 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={['rounded-full px-2 py-0.5 text-[11px] font-semibold', badge.className].join(' ')}>
            {badge.labelTh}
          </span>
          <span className="text-sm text-slate-200">{item.area}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={['flex items-center gap-1 text-xs', trend.className].join(' ')}>
            <TrendIcon size={14} />
            <span>{trend.labelTh}</span>
          </div>
          <button
            type="button"
            aria-label={`แนะนำการฝึกสำหรับ ${item.area}`}
            title="ดูวิธีฝึก"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/10 text-sky-300 ring-1 ring-sky-400/30 transition hover:bg-sky-500/20"
            onClick={() => onOpenTip(getWeaknessPracticeTip(item.area))}
          >
            <Lightbulb size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function getWeaknessPracticeTip(area: string): string {
  switch (area) {
    case 'time_pressure_blunders':
      return 'ฝึกเวลาตกต่ำ: หยุด 5 วินาทีก่อนตัดสินใจทุกตา ให้ถาม 3 ข้อ: “ตานี้ปลอดภัยไหม?”, “ถ้าฉันเดินนี้ จะมีการตอบโต้ตรงไหน?”, “ฉันมี buffer ให้คิงหนีไหม?” ฝึกแบบนี้จนเคยชินก่อนหมดเวลา.';
    case 'greedy_capture_blunders':
      return 'ฝึกการกินหมากแบบระวัง: ก่อนกินทุกครั้ง ให้เช็ก 3 อย่าง: ตัวเราวางคิงไว้ดีไหม, หลังกินมีการตอบโต้ที่คุกคามตนเองไหม, และมีการหมุนการป้องกันที่เสียหายไหม? ถ้าไม่แน่ใจให้ไม่กินก่อน.';
    default:
      return 'ฝึกสแกนกระดาน 3 รอบก่อนเดิน: (1) อันตรายต่อคิง (2) การพัฒนา/ความปลอดภัยของชิ้น (3) โอกาสโจมตี/การตอบโต้ แล้วเลือกตาที่ปลอดภัยที่สุดก่อน.';
  }
}

// ============================================================================
// Habit patterns
// ============================================================================

function HabitPatternCard(props: { readonly habitPatterns: readonly HabitPattern[] }) {
  const { habitPatterns } = props;

  return (
    <div className="rounded-2xl bg-slate-900/60 p-4 ring-1 ring-slate-800">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">นิสัยที่เกิดขึ้นซ้ำๆ</h3>

      {habitPatterns.length === 0 ? (
        <div className="flex h-20 items-center justify-center px-3 text-center text-sm text-slate-500">
          ยังไม่พบรูปแบบพฤติกรรมที่ชัดเจน <br />
          ต้องมี trigger เดียวกันเกิดซ้ำประมาณ 2-3 ครั้ง และมีข้อมูลเกมเพียงพอ จึงจะเริ่มเห็นนิสัยที่เกิดขึ้นซ้ำๆ
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {habitPatterns.map((pattern) => (
            <HabitPatternRow key={pattern.patternId} pattern={pattern} />
          ))}
        </div>
      )}
    </div>
  );
}

function HabitPatternRow(props: { readonly pattern: HabitPattern }) {
  const { pattern } = props;
  const successPercent = Math.round(clamp0to1(pattern.successRate) * 100);

  return (
    <div className="rounded-xl bg-slate-800/50 p-3">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
        <span className="text-slate-400">เจอ:</span>
        <span className="text-slate-100">{pattern.trigger}</span>
        <span className="text-slate-500">→</span>
        <span className="text-slate-400">คุณมักจะ:</span>
        <span className="text-slate-100">{pattern.playerResponse}</span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-950">
          <div
            className={['h-full rounded-full', successPercent >= 50 ? 'bg-emerald-400' : 'bg-red-400'].join(' ')}
            style={{ width: `${successPercent}%` }}
          />
        </div>
        <span className="whitespace-nowrap text-xs text-slate-400">
          สำเร็จ {successPercent}% ({pattern.frequency}/{pattern.occurrences} ครั้ง)
        </span>
      </div>

      <p className="mt-2 text-xs text-slate-300">{pattern.verdict}</p>

      {pattern.recommendedAlternative ? (
        <p className="mt-1.5 text-xs text-sky-300">
          <span className="font-medium">ลองแทนที่ด้วย: </span>
          {pattern.recommendedAlternative}
        </p>
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
