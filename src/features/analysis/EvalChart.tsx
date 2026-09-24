/**
 * EvalChart.tsx
 * ---------------------------------------------------------------------------
 * กราฟ advantage ตลอดเกม — แกน X = ply, แกน Y = centipawn (โดเมนคงที่
 * -1000..1000 ตามที่ระบุ, mate ถูกปัดเป็น ±1000 แล้วตั้งแต่ตอน map เป็น
 * AnalyzedMove) ใช้เทคนิค gradient แนวตั้งที่แบ่งครึ่งพอดีที่ 50% แทนสีขาว/ดำ
 * เพราะโดเมนสมมาตร (-1000..1000) ทำให้ 0 อยู่กึ่งกลางเป๊ะเสมอ ไม่ต้องคำนวณ
 * offset ใหม่ทุกครั้งที่ข้อมูลเปลี่ยน
 *
 * รับข้อมูลเป็น AnalyzedMove[] ล้วนๆ ผ่าน props — ไม่รู้จัก store ไหนทั้งสิ้น
 * ---------------------------------------------------------------------------
 */

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { evalToClampedCp, type AnalyzedMove } from './types';

// ============================================================================
// Types
// ============================================================================

export interface EvalChartProps {
  readonly moves: readonly AnalyzedMove[];
  /** ply ที่กำลังเลือกอยู่ตอนนี้ (ไฮไลต์เส้นแนวตั้ง) — undefined ถ้ายังไม่ได้เลือกตาไหน */
  readonly currentPly?: number;
  readonly onSelectPly: (ply: number) => void;
  readonly heightPx?: number;
}

interface ChartPoint {
  readonly ply: number;
  readonly cp: number;
  readonly san: string;
  readonly isBlunder: boolean;
  readonly isMistake: boolean;
}

const Y_DOMAIN: [number, number] = [-1000, 1000];

// ============================================================================
// Helpers
// ============================================================================

function buildChartData(moves: readonly AnalyzedMove[]): ChartPoint[] {
  return moves.map((move) => ({
    ply: move.ply,
    cp: evalToClampedCp(move.evalAfter),
    san: move.san,
    isBlunder: move.classification === 'blunder',
    isMistake: move.classification === 'mistake',
  }));
}

function renderDot(props: { cx?: number; cy?: number; payload?: ChartPoint }): JSX.Element {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return <g />;
  if (payload.isBlunder) {
    return <circle cx={cx} cy={cy} r={5} fill="#ef4444" stroke="#fff" strokeWidth={1.5} />;
  }
  if (payload.isMistake) {
    return <circle cx={cx} cy={cy} r={3.5} fill="#f97316" stroke="#fff" strokeWidth={1} />;
  }
  return <g />;
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload as ChartPoint;
  return (
    <div className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs shadow-md">
      <div className="font-semibold text-gray-800">
        ตาที่ {point.ply}: {point.san}
      </div>
      <div className="text-gray-500">{point.cp > 0 ? `+${point.cp}` : point.cp} cp</div>
    </div>
  );
}

// ============================================================================
// Component
// ============================================================================

export function EvalChart({ moves, currentPly, onSelectPly, heightPx = 220 }: EvalChartProps): JSX.Element {
  const data = useMemo(() => buildChartData(moves), [moves]);

  return (
    <div style={{ width: '100%', height: heightPx }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
          onClick={(e) => {
            if (e && e.activeLabel !== undefined && e.activeLabel !== null) {
              onSelectPly(Number(e.activeLabel));
            }
          }}
        >
          <defs>
            <linearGradient id="evalSplitGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f3f4f6" stopOpacity={1} />
              <stop offset="50%" stopColor="#f3f4f6" stopOpacity={1} />
              <stop offset="50%" stopColor="#1f2937" stopOpacity={1} />
              <stop offset="100%" stopColor="#1f2937" stopOpacity={1} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
          <XAxis dataKey="ply" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#d1d5db' }} />
          <YAxis domain={Y_DOMAIN} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
          <Tooltip content={<ChartTooltip />} />

          <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={1} />
          {currentPly !== undefined && <ReferenceLine x={currentPly} stroke="#3b82f6" strokeDasharray="4 2" />}

          <Area
            type="monotone"
            dataKey="cp"
            stroke="#111827"
            strokeWidth={1.5}
            fill="url(#evalSplitGradient)"
            fillOpacity={0.85}
            isAnimationActive={false}
            dot={renderDot}
            activeDot={{ r: 4, cursor: 'pointer' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default EvalChart;
