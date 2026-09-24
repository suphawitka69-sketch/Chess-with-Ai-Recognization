/**
 * ChessClock.tsx
 * ---------------------------------------------------------------------------
 * แสดงเวลาคงเหลือของทั้งสองฝ่าย โดยอ่านจาก useGameStore().state.clock ซึ่งเป็น
 * ClockSnapshot ที่ถูกอัปเดตจริงจาก Clock.onTick() ทุก ~100ms ระหว่างนาฬิกา
 * กำลังเดิน (ดู core/chess/Clock.ts) — component นี้เอง "ไม่คำนวณเวลาเอง"
 * เลย เป็นแค่ pure display ของสิ่งที่ store ส่งมา ตรงตามหลัก single source
 * of truth ของเวลาที่อยู่ใน Clock class เท่านั้น
 * ---------------------------------------------------------------------------
 */

import type { ClockSnapshot } from '../../core/chess/Clock';
import type { PieceColor } from '../../core/chess/GameEngine';
import { useGameStore } from '../../state/useGameStore';

// ============================================================================
// Constants
// ============================================================================

/** ต่ำกว่านี้ (ms) ถือว่า "เวลาวิกฤต" — ตัวเลขจะเปลี่ยนเป็นสีแดงและกระพริบเตือน */
const CRITICAL_TIME_THRESHOLD_MS = 20_000;
/** ต่ำกว่านี้ (ms) ถือว่า "เวลาเริ่มน้อย" — ตัวเลขจะเป็นสีเหลือง (เตือนแต่ยังไม่วิกฤต) */
const LOW_TIME_THRESHOLD_MS = 60_000;
/** ต่ำกว่านี้ (ms) จะแสดงทศนิยมวินาที (เช่น "0:09.3") เพื่อความรู้สึกกดดันแบบนาฬิกาจริง */
const SHOW_TENTHS_THRESHOLD_MS = 10_000;

// ============================================================================
// Types
// ============================================================================

export interface ChessClockProps {
  readonly className?: string;
  /** แสดงเฉพาะนาฬิกาของฝ่ายนี้ — ปล่อยว่างเพื่อแสดงทั้งสองฝ่าย (ค่าเริ่มต้น) */
  readonly onlyColor?: PieceColor;
  /** จัดเรียงแนวตั้ง (ฝ่ายตรงข้ามอยู่บน ผู้เล่นอยู่ล่าง) — ค่าเริ่มต้าน true เหมาะกับ sidebar แคบ */
  readonly stacked?: boolean;
}

// ============================================================================
// Formatting helpers
// ============================================================================

function formatClockTime(remainingMs: number): string {
  const clamped = Math.max(0, remainingMs);

  if (clamped < SHOW_TENTHS_THRESHOLD_MS) {
    const totalTenths = Math.floor(clamped / 100);
    const seconds = Math.floor(totalTenths / 10);
    const tenths = totalTenths % 10;
    return `0:${String(seconds).padStart(2, '0')}.${tenths}`;
  }

  const totalSeconds = Math.floor(clamped / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function timeSeverity(remainingMs: number): 'normal' | 'low' | 'critical' {
  if (remainingMs <= CRITICAL_TIME_THRESHOLD_MS) return 'critical';
  if (remainingMs <= LOW_TIME_THRESHOLD_MS) return 'low';
  return 'normal';
}

function colorLabel(color: PieceColor): string {
  return color === 'w' ? 'ฝ่ายขาว' : 'ฝ่ายดำ';
}

// ============================================================================
// Single clock face
// ============================================================================

interface ClockFaceProps {
  readonly color: PieceColor;
  readonly remainingMs: number;
  readonly isActive: boolean;
  readonly isFlagged: boolean;
}

function ClockFace(props: ClockFaceProps) {
  const { color, remainingMs, isActive, isFlagged } = props;
  const severity = timeSeverity(remainingMs);

  const containerToneClass = isActive
    ? 'bg-slate-100 text-slate-950 ring-2 ring-sky-400 shadow-lg shadow-sky-500/20'
    : 'bg-slate-900 text-slate-300 ring-1 ring-slate-800';

  const digitToneClass = isFlagged
    ? 'text-red-500'
    : severity === 'critical'
      ? isActive
        ? 'text-red-600 animate-pulse'
        : 'text-red-400'
      : severity === 'low'
        ? isActive
          ? 'text-amber-600'
          : 'text-amber-400'
        : '';

  return (
    <div className={['flex items-center justify-between rounded-xl px-4 py-3 transition-colors duration-200', containerToneClass].join(' ')}>
      <div className="flex items-center gap-2">
        <span
          className={[
            'inline-block h-2.5 w-2.5 rounded-full',
            color === 'w' ? 'bg-slate-50 ring-1 ring-slate-400' : 'bg-slate-950 ring-1 ring-slate-600',
          ].join(' ')}
          aria-hidden="true"
        />
        <span className="text-xs font-medium uppercase tracking-wider opacity-70">{colorLabel(color)}</span>
      </div>

      <span className={['font-mono text-2xl font-semibold tabular-nums', digitToneClass].join(' ')}>
        {isFlagged ? '0:00' : formatClockTime(remainingMs)}
      </span>
    </div>
  );
}

// ============================================================================
// Component
// ============================================================================

export function ChessClock(props: ChessClockProps) {
  const { className, onlyColor, stacked = true } = props;

  const clock: ClockSnapshot | null = useGameStore((s) => s.state.clock);
  const playerColor = useGameStore((s) => s.state.playerColor);

  if (!clock) {
    return (
      <div className={['rounded-xl bg-slate-900/60 px-4 py-3 text-center text-xs text-slate-500', className ?? ''].join(' ')}>
        ยังไม่เริ่มเกม
      </div>
    );
  }

  const isFlagged = clock.phase === 'flagged';
  const opponentColor: PieceColor = playerColor === 'b' ? 'w' : 'b';

  const faces: readonly PieceColor[] = onlyColor
    ? [onlyColor]
    : stacked
      ? [opponentColor, playerColor ?? 'w'] // ฝ่ายตรงข้ามอยู่บน ผู้เล่นอยู่ล่าง เหมือน UI หมากรุกออนไลน์ทั่วไป
      : (['w', 'b'] as const);

  return (
    <div className={['flex gap-2', stacked ? 'flex-col' : 'flex-row', className ?? ''].join(' ')}>
      {faces.map((color) => (
        <ClockFace
          key={color}
          color={color}
          remainingMs={color === 'w' ? clock.whiteRemainingMs : clock.blackRemainingMs}
          isActive={clock.phase === 'running' && clock.activeColor === color}
          isFlagged={isFlagged && clock.activeColor === color}
        />
      ))}
    </div>
  );
}
