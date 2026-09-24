/**
 * TrapRadar.tsx
 * ---------------------------------------------------------------------------
 * วิดเจ็ตขนาดเล็กแสดงสถานะ "มีกับดักซ่อนอยู่ในตำแหน่งนี้หรือไม่" — badge
 * กระพริบสีส้ม/แดงตามความรุนแรง พร้อม tooltip อธิบายความเสี่ยง และสวิตช์
 * เปิด/ปิดให้ผู้เล่นที่อยากฝึกคิดเองปิดตัวช่วยได้
 *
 * ⚠️ หมายเหตุสำคัญเรื่องขอบเขต:
 *
 * 1. คอมโพเนนต์นี้ **ไม่ได้รัน TrapDetector เอง** — รับผล `warnings` (จาก
 *    `TrapDetector.detectTraps()` ใน `src/core/analysis/TrapDetector.ts`)
 *    เป็น prop ตรงๆ เพราะการรัน detection จริงต้องมีข้อมูล MultiPV สดจาก
 *    engine ซึ่งเป็นหน้าที่ของ hook orchestration (เช่น `useEngine.ts` ที่มี
 *    อยู่แล้ว หรือ hook ใหม่ที่จะสร้างต่อ) ไม่ใช่ของ UI widget เอง
 * 2. `enabled`/`onToggle` เป็นแบบ controlled จาก parent ทั้งหมด — ไม่มี store
 *    เฉพาะของตัวเองเก็บสถานะเปิด/ปิด เพราะยังไม่มีการขอให้สร้าง store ใหม่
 *    สำหรับเรื่องนี้ ถ้าต้องการให้ค่านี้จำข้ามเซสชัน (persist) ต้องเพิ่ม field
 *    ใน store ที่มีอยู่แล้ว (เช่น useUiStore ถ้ามี) แล้วส่งเข้ามาเป็น prop
 *    ตามเดิม ไม่ใช่สร้าง state ลับไว้ในไฟล์นี้
 * 3. ข้อความ tooltip ตั้งใจใช้คำว่า "การเดินไปที่ช่อง X" แทน "การกินเบี้ยที่
 *    X" ตามตัวอย่างในโจทย์ เพราะ `TrapWarning` (ตามที่ TrapDetector.ts
 *    นิยามไว้) ไม่มี field บอกว่าตานั้นเป็นการกินหมากหรือเดินเฉยๆ — การใช้คำ
 *    ว่า "กิน" ตรงๆ ทั้งที่ไม่รู้แน่ชัดจะเป็นการยืนยันข้อมูลที่ไม่มีอยู่จริง
 *    ถ้าต้องการคำที่เจาะจงกว่านี้ ต้องเพิ่ม field (เช่น `isCapture`,
 *    `pieceMoved`) เข้าไปใน `TrapWarning` ที่ TrapDetector.ts ก่อน
 * 4. severity 'low' ถือว่ายังไม่น่าเป็นห่วงพอจะรบกวนผู้เล่น — badge จะสงบ
 *    (ไม่กระพริบ, ไอคอนสีเขียวปกติ) จนกว่าจะมี warning ระดับ 'medium' ขึ้นไป
 * 5. ใช้ Tailwind default palette ล้วนๆ (slate/red/orange/emerald) ไม่ได้
 *    อ้างอิง custom theme token เพราะไม่เห็น tailwind.config.js ของ
 *    โปรเจกต์นี้ว่ามีการ extend สีไว้หรือไม่
 * ---------------------------------------------------------------------------
 */

import type { ReactNode, SVGProps } from 'react';
import type { TrapSeverity, TrapWarning } from '../../core/analysis/TrapDetector';

// ============================================================================
// Public types
// ============================================================================

export interface TrapRadarProps {
  /** ผลลัพธ์จาก TrapDetector.detectTraps() ของตำแหน่งปัจจุบัน — ส่ง array ว่างถ้าไม่มีกับดักเลย */
  readonly warnings: readonly TrapWarning[];
  readonly enabled: boolean;
  readonly onToggle: (enabled: boolean) => void;
}

// ============================================================================
// Helpers
// ============================================================================

function severityRank(severity: TrapSeverity): number {
  if (severity === 'critical') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

/** เลือก warning ที่รุนแรงที่สุดมาแสดงเป็นหลัก — ไม่พึ่งลำดับที่ผู้เรียกส่งมา (จัดเรียงเองที่นี่ให้ชัวร์) */
function pickPrimaryWarning(warnings: readonly TrapWarning[]): TrapWarning | null {
  if (warnings.length === 0) return null;
  return [...warnings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0] ?? null;
}

/** ดูหมายเหตุข้อ 3 บนสุดของไฟล์เรื่องการเลือกคำ "เดินไปที่" แทน "กิน" */
function buildWarningMessage(warning: TrapWarning): string {
  const squareLabel = warning.baitSquare ? warning.baitSquare.toUpperCase() : 'ตำแหน่งนี้';
  const stepsAhead = warning.punishmentLine.length > 0 ? warning.punishmentLine.length : 2;
  const nameSuffix = warning.trapName ? ` (${warning.trapName})` : '';
  return `ระวัง! การเดินไปที่ช่อง ${squareLabel} อาจทำให้ติดกับดัก${nameSuffix} ในอีก ${stepsAhead} ตา`;
}

// ============================================================================
// Icons — inline SVG ล้วนๆ (ดูหมายเหตุข้อ 5 บนสุดของไฟล์)
// ============================================================================

function RadarIcon(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 12 21 12A9 9 0 1 1 12 3" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ============================================================================
// Toggle switch
// ============================================================================

function ToggleSwitch({ enabled, onToggle }: { readonly enabled: boolean; readonly onToggle: (value: boolean) => void }): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={enabled ? 'ปิดเรดาร์กับดัก' : 'เปิดเรดาร์กับดัก'}
      onClick={() => onToggle(!enabled)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
        enabled ? 'bg-emerald-500' : 'bg-slate-700'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

// ============================================================================
// Component
// ============================================================================

export function TrapRadar({ warnings, enabled, onToggle }: TrapRadarProps): ReactNode {
  const primary = enabled ? pickPrimaryWarning(warnings) : null;
  const isActive = primary !== null && primary.severity !== 'low';
  const isCritical = primary?.severity === 'critical';

  const iconColorClass = !enabled ? 'text-slate-600' : isActive ? (isCritical ? 'text-red-400' : 'text-orange-400') : 'text-emerald-400';
  const dotColorClass = isCritical ? 'bg-red-500' : 'bg-orange-500';
  const pingColorClass = isCritical ? 'bg-red-400' : 'bg-orange-400';

  return (
    <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1.5">
      <div className="group relative flex items-center">
        <button
          type="button"
          disabled={!enabled}
          aria-label={isActive && primary ? buildWarningMessage(primary) : 'เรดาร์กับดัก'}
          className="relative flex h-7 w-7 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed"
        >
          <RadarIcon className={`h-5 w-5 ${iconColorClass}`} />
          {isActive && (
            <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${pingColorClass} opacity-75`} />
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dotColorClass}`} />
            </span>
          )}
        </button>

        {isActive && primary && (
          <div
            role="tooltip"
            className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-64 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs leading-relaxed text-slate-200 opacity-0 shadow-lg transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
          >
            {buildWarningMessage(primary)}
          </div>
        )}
      </div>

      <span className="text-xs text-slate-400">เรดาร์กับดัก</span>
      <ToggleSwitch enabled={enabled} onToggle={onToggle} />
    </div>
  );
}
