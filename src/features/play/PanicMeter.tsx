/**
 * src/features/play/PanicMeter.tsx
 * ---------------------------------------------------------------------------
 * เข็มวัดความลน (Panic Meter) — ปรับปรุง Layout ให้เป็น Card สไตล์เดียวกับแถบโค้ช
 * และรองรับการขยายขนาดตามความกว้างของ Container (เช่น ใต้ปุ่มยอมแพ้)
 * ---------------------------------------------------------------------------
 */

import React, { useMemo } from 'react';
import { usePanicScore, usePanicDelta, useIsUnderTimePressure } from '../../state/useTelemetryStore';

// ============================================================================
// Types & Config (จุดปรับแต่งค่า 🎨)
// ============================================================================

export interface PanicMeterProps {
  /** 
   * [จุดปรับที่ 1]: กำหนดความกว้างสูงสุด (px) หรือปล่อยว่างเพื่อให้กว้างเต็มกรอบ 100% 
   */
  readonly maxWidth?: number;
  /** [จุดปรับที่ 2]: ซ่อน Badge ข้อความด้านล่างหรือไม่ */
  readonly hideBadge?: boolean;
}

interface PanicZone {
  readonly max: number;
  readonly color: string;
  readonly label: string;
}

/** [จุดปรับที่ 3]: ช่วงคะแนนและสีของแต่ละโซน */
const PANIC_ZONES: readonly PanicZone[] = [
  { max: 30, color: '#22c55e', label: 'เยือกเย็น' },   // เขียว
  { max: 60, color: '#eab308', label: 'เริ่มลังเล' },   // เหลือง
  { max: 100, color: '#ef4444', label: 'นาฬิกาเดือด!' }, // แดง
];

/** [จุดปรับที่ 4]: ความนุ่มนวลของการดีดเข็ม */
const NEEDLE_TRANSITION = 'transform 600ms cubic-bezier(0.34, 1.3, 0.64, 1)';

// ============================================================================
// Helpers
// ============================================================================

function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.min(100, Math.max(0, score));
}

function zoneForScore(score: number): PanicZone {
  const clamped = clampScore(score);
  return PANIC_ZONES.find((zone) => clamped <= zone.max) ?? PANIC_ZONES[PANIC_ZONES.length - 1];
}

function scoreToNeedleAngle(score: number): number {
  const clamped = clampScore(score);
  return -90 + (clamped / 100) * 180;
}

function scoreToArcPoint(score: number, radius: number, cx: number, cy: number): { x: number; y: number } {
  const angleDeg = -180 + (clampScore(score) / 100) * 180;
  const angleRad = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(angleRad), y: cy + radius * Math.sin(angleRad) };
}

// ============================================================================
// Component
// ============================================================================

export function PanicMeter({ maxWidth = 320, hideBadge = false }: PanicMeterProps): JSX.Element {
  const panicScore = usePanicScore();
  const panicDelta = usePanicDelta();
  const isUnderTimePressure = useIsUnderTimePressure();

  const clampedScore = clampScore(panicScore);
  const activeZone = zoneForScore(clampedScore);
  const needleAngle = scoreToNeedleAngle(clampedScore);

  const cx = 100;
  const cy = 95;
  const radius = 75;
  const strokeWidth = 16;

  const zoneArcs = useMemo(() => {
    let previousBoundary = 0;
    return PANIC_ZONES.map((zone) => {
      const start = scoreToArcPoint(previousBoundary, radius, cx, cy);
      const end = scoreToArcPoint(zone.max, radius, cx, cy);
      const largeArcFlag = zone.max - previousBoundary > 50 ? 1 : 0;
      const d = `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
      previousBoundary = zone.max;
      return { d, color: zone.color, key: zone.label };
    });
  }, []);

  const deltaIndicator = useMemo(() => {
    if (Math.abs(panicDelta) < 1) return null;
    const rising = panicDelta > 0;
    return {
      symbol: rising ? '▲' : '▼',
      color: rising ? '#ef4444' : '#22c55e',
    };
  }, [panicDelta]);

  return (
    // [จุดปรับที่ 5]: กรอบภายนอก ปรับให้เข้ากับธีมของแถบโค้ด (Border, Background, Shadow)
    <div
      style={{
        width: '100%',
        maxWidth: `${maxWidth}px`,
        boxSizing: 'border-box',
        backgroundColor: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: '12px',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)',
      }}
    >
      {/* Header ของการ์ด */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '4px',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#4b5563' }}>ความกดดัน (Panic Meter)</span>
        {deltaIndicator && (
          <span style={{ fontSize: '11px', fontWeight: 600, color: deltaIndicator.color }}>
            {deltaIndicator.symbol} {Math.abs(Math.round(panicDelta))}
          </span>
        )}
      </div>

      {/* ตัวเกจวัดครึ่งวงกลม */}
      <svg
        viewBox="0 0 200 120"
        style={{ width: '100%', height: 'auto', maxHeight: '130px' }}
        role="img"
        aria-label={`Panic score: ${clampedScore}`}
      >
        {/* Track พื้นหลัง */}
        <path
          d={`M ${scoreToArcPoint(0, radius, cx, cy).x} ${scoreToArcPoint(0, radius, cx, cy).y} A ${radius} ${radius} 0 1 1 ${
            scoreToArcPoint(100, radius, cx, cy).x
          } ${scoreToArcPoint(100, radius, cx, cy).y}`}
          fill="none"
          stroke="#f3f4f6"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        {/* เส้นโซนสี 3 ช่วง */}
        {zoneArcs.map((arc) => (
          <path key={arc.key} d={arc.d} fill="none" stroke={arc.color} strokeWidth={strokeWidth} strokeLinecap="butt" />
        ))}

        {/* เข็มวัด */}
        <g
          style={{
            transform: `rotate(${needleAngle}deg)`,
            transformOrigin: `${cx}px ${cy}px`,
            transition: NEEDLE_TRANSITION,
          }}
        >
          <line x1={cx} y1={cy} x2={cx} y2={cy - radius + 10} stroke="#1f2937" strokeWidth={3.5} strokeLinecap="round" />
        </g>
        <circle cx={cx} cy={cy} r={6} fill="#1f2937" />

        {/* ตัวเลขคะแนน */}
        <text x={cx} y={cy + 22} textAnchor="middle" fontSize={18} fontWeight={700} fill="#1f2937">
          {Math.round(clampedScore)}
        </text>
      </svg>

      {/* Badge แสดงสถานะอารมณ์ */}
      {!hideBadge && (
        <div
          style={{
            marginTop: '2px',
            padding: '3px 14px',
            borderRadius: '9999px',
            fontSize: '12px',
            fontWeight: 600,
            color: '#ffffff',
            backgroundColor: activeZone.color,
            transition: 'background-color 400ms ease',
          }}
        >
          {isUnderTimePressure ? 'นาฬิกาเดือด!' : activeZone.label}
        </div>
      )}
    </div>
  );
}

export default PanicMeter;