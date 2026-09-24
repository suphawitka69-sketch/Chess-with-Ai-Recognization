/**
 * StyleRadar.tsx
 * ---------------------------------------------------------------------------
 * เรดาร์ชาร์ต 8 แกนของ StyleVector — component นี้เป็น pure display ล้วนๆ
 * ไม่ query store เอง รับ `styleVector` ที่คำนวณเสร็จแล้วจาก StyleExtractor
 * ผ่าน props เท่านั้น (เห็นได้จาก signature ที่ตรงกับที่ระบุมา)
 * ---------------------------------------------------------------------------
 */

import { useMemo } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
} from 'recharts';
import type { StyleVector } from '../../shared/types/schema';

// ============================================================================
// Types
// ============================================================================

export interface StyleRadarProps {
  readonly styleVector: StyleVector;
  readonly className?: string;
  /** ความสูงของชาร์ต (px) — ค่าเริ่มต้น 320 พอดีกับ card ทั่วไปในหน้า profile */
  readonly heightPx?: number;
}

interface StyleAxisDatum {
  readonly axis: string;
  readonly value: number;
}

// ============================================================================
// Axis definitions — ชื่อแกนภาษาไทย + ลำดับการแสดงผลตายตัว
// ============================================================================

const STYLE_AXES: readonly { readonly key: keyof StyleVector; readonly labelTh: string }[] = [
  { key: 'aggression', labelTh: 'ความก้าวร้าว' },
  { key: 'tacticalSharpness', labelTh: 'ความคมยุทธวิธี' },
  { key: 'riskTolerance', labelTh: 'ความกล้าเสี่ยง' },
  { key: 'endgameTechnique', labelTh: 'เทคนิคปลายเกม' },
  { key: 'defensiveResilience', labelTh: 'ความอึดตั้งรับ' },
  { key: 'prophylaxis', labelTh: 'การป้องกันล่วงหน้า' },
  { key: 'positional', labelTh: 'เชิงตำแหน่ง' },
  { key: 'timeManagement', labelTh: 'การจัดการเวลา' },
];

// ============================================================================
// Component
// ============================================================================

export function StyleRadar(props: StyleRadarProps) {
  const { styleVector, className, heightPx = 320 } = props;

  const data: readonly StyleAxisDatum[] = useMemo(
    () => STYLE_AXES.map((axis) => ({ axis: axis.labelTh, value: clamp0to100(styleVector[axis.key]) })),
    [styleVector],
  );

  return (
    <div className={['rounded-2xl bg-slate-900/60 p-4 ring-1 ring-slate-800', className ?? ''].join(' ')}>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-400">สไตล์การเล่น</h3>
      <ResponsiveContainer width="100%" height={heightPx}>
        <RadarChart data={data as unknown as Record<string, unknown>[]} outerRadius="75%">
          <PolarGrid stroke="#334155" />
          <PolarAngleAxis dataKey="axis" tick={{ fill: '#cbd5e1', fontSize: 11 }} />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={5} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} />
          <Radar name="สไตล์การเล่น" dataKey="value" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.45} isAnimationActive={false} />
          <Tooltip content={StyleRadarTooltip} cursor={false} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ============================================================================
// Custom tooltip — โทนมืดให้เข้ากับธีมที่เหลือของระบบ
// ============================================================================

function StyleRadarTooltip(props: TooltipProps<number, string>) {
  if (!props.active || !props.payload || props.payload.length === 0) return null;
  const item = props.payload[0];

  return (
    <div className="rounded-lg bg-slate-950/95 px-3 py-2 text-xs text-slate-200 ring-1 ring-slate-700 shadow-xl">
      <div className="font-medium">{props.label}</div>
      <div className="text-sky-300">{item.value}/100</div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function clamp0to100(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}
