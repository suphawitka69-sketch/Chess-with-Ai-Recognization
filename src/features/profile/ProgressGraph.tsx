/**
 * ProgressGraph.tsx
 * ---------------------------------------------------------------------------
 * กราฟแสดงวิวัฒนาการของผู้เล่นตามเวลา จาก `ProgressionDataPoint[]` — สลับดูได้
 * 3 มิติ (accuracy / estimatedElo / avgPanic) ผ่าน tab ธรรมดา ไม่ใช้ router
 * เพราะเป็นแค่การเปลี่ยนมุมมองข้อมูลชุดเดียวกัน ไม่ใช่คนละหน้า
 * ---------------------------------------------------------------------------
 */

import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import type { ProgressionPoint } from '../../shared/types/schema';

// ============================================================================
// Types
// ============================================================================

export interface ProgressGraphProps {
  readonly progression: readonly ProgressionPoint[];
  readonly className?: string;
  readonly heightPx?: number;
}

type ProgressMetric = 'accuracy' | 'estimatedElo' | 'avgPanic';

interface MetricConfig {
  readonly labelTh: string;
  readonly unit: string;
  readonly color: string;
  readonly domain: [number, number | 'auto'];
  readonly getValue: (point: ProgressionPoint) => number;
  readonly formatValue: (value: number) => string;
}

interface ChartDatum {
  readonly dateLabel: string;
  readonly value: number;
}

// ============================================================================
// Metric definitions
// ============================================================================

const METRIC_CONFIGS: Record<ProgressMetric, MetricConfig> = {
  accuracy: {
    labelTh: 'ความแม่นยำ',
    unit: '%',
    color: '#34d399',
    domain: [0, 100],
    getValue: (p) => p.accuracy,
    formatValue: (v) => `${v.toFixed(1)}%`,
  },
  estimatedElo: {
    labelTh: 'Elo โดยประมาณ',
    unit: '',
    color: '#38bdf8',
    domain: [0, 'auto'],
    getValue: (p) => p.estimatedElo,
    formatValue: (v) => Math.round(v).toString(),
  },
  avgPanic: {
    labelTh: 'Panic Score เฉลี่ย',
    unit: '/100',
    color: '#f87171',
    domain: [0, 100],
    getValue: (p) => p.avgPanic,
    formatValue: (v) => `${Math.round(v)}/100`,
  },
};

const METRIC_ORDER: readonly ProgressMetric[] = ['accuracy', 'estimatedElo', 'avgPanic'];

// ============================================================================
// Component
// ============================================================================

export function ProgressGraph(props: ProgressGraphProps) {
  const { progression, className, heightPx = 280 } = props;
  const [activeMetric, setActiveMetric] = useState<ProgressMetric>('accuracy');

  const config = METRIC_CONFIGS[activeMetric];

  const data: ChartDatum[] = useMemo(
    () => progression.map((point) => ({ dateLabel: formatDateLabel(point.date), value: config.getValue(point) })),
    [progression, config],
  );

  return (
    <div className={['rounded-2xl bg-slate-900/60 p-4 ring-1 ring-slate-800', className ?? ''].join(' ')}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">พัฒนาการ</h3>
        <div className="flex gap-1 rounded-lg bg-slate-800/60 p-1">
          {METRIC_ORDER.map((metric) => (
            <button
              key={metric}
              type="button"
              onClick={() => setActiveMetric(metric)}
              className={[
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                activeMetric === metric ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200',
              ].join(' ')}
            >
              {METRIC_CONFIGS[metric].labelTh}
            </button>
          ))}
        </div>
      </div>

      {progression.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-slate-500">ยังไม่มีข้อมูลพัฒนาการ — เล่นให้จบสักเกมก่อน</div>
      ) : (
        <ResponsiveContainer width="100%" height={heightPx}>
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`progress-gradient-${activeMetric}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={config.color} stopOpacity={0.4} />
                <stop offset="95%" stopColor={config.color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="dateLabel" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis
              stroke="#475569"
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              domain={config.domain}
              width={40}
            />
            <Tooltip content={(tooltipProps) => <ProgressTooltip {...tooltipProps} config={config} />} cursor={false} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={config.color}
              fill={`url(#progress-gradient-${activeMetric})`}
              strokeWidth={2}
              isAnimationActive={false}
              name={config.labelTh}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ============================================================================
// Custom tooltip
// ============================================================================

function ProgressTooltip(props: TooltipProps<ValueType, NameType> & { readonly config: MetricConfig }) {
  if (!props.active || !props.payload || props.payload.length === 0) return null;
  const raw = props.payload[0]?.value;
  const value = typeof raw === 'number' ? raw : Number(raw ?? 0);

  return (
    <div className="rounded-lg bg-slate-950/95 px-3 py-2 text-xs text-slate-200 ring-1 ring-slate-700 shadow-xl">
      <div className="text-slate-400">{props.label}</div>
      <div className="font-medium" style={{ color: props.config.color }}>
        {props.config.formatValue(value)}
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatDateLabel(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}
