/**
 * ProfileScreen.tsx
 * ---------------------------------------------------------------------------
 * โหลด PlayerProfileRecord จาก profileRepository แล้วประกอบ 4 การ์ดที่มีอยู่
 * แล้ว (StyleRadar, ProgressGraph, GmComparison, HabitReport) เข้าด้วยกัน
 * พร้อม sync ข้อมูลเกมจริงจาก IndexedDB ก่อนแสดงผล และปุ่มเปิด GhostMatchSetup
 *
 * `profileRepository` เป็นเจ้าของการ aggregate จาก db.games/db.moveLogs
 *
 * [แก้แล้ว] เดิม useEffect เรียก profileRepository.syncProfileFromGames()
 * ทันทีตอน mount โดยไม่รอ background persist ของเกมล่าสุด — ถ้าผู้เล่นกดมา
 * หน้านี้ทันทีหลังเกมจบ (finishGame() ใน useGameStore.ts persist แบบ
 * background ไม่ await) มีโอกาสที่การ sync รอบนี้จะอ่าน db.games/db.moveLogs
 * ไปก่อนที่เกมล่าสุดจะเขียนเสร็จจริง ทำให้ habitPatterns/progression ที่
 * คำนวณได้ "หาย" เกมล่าสุดไป ขัดกับกฎที่ว่าทุกครั้งที่ sync ต้อง rebuild จาก
 * all-history จริงเสมอ — จึง await useGameActions().waitForPendingPersist()
 * ก่อนเรียก sync ทุกครั้ง
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import { profileRepository } from '../../data/repositories/ProfileRepository';
import { useGameActions } from '../../state/useGameStore';
import type { PlayerProfileRecord } from '../../shared/types/schema';
import { StyleRadar } from './StyleRadar';
import { ProgressGraph } from './ProgressGraph';
import { GmComparison } from './GmComparison';
import { HabitReport } from './HabitReport';
import { GhostMatchSetup } from '../ghost/GhostMatchSetup';

// ============================================================================
// Types
// ============================================================================

export interface ProfileScreenProps {
  readonly className?: string;
  /** เรียกเมื่อผู้เล่นยืนยันเริ่มดวลกับ Ghost ใน modal — ส่ง Elo ของจุดในอดีตที่เลือกไว้ */
  readonly onStartGhostGame?: (snapshotElo: number) => void;
}

type LoadState = 'loading' | 'ready' | 'error';

// ============================================================================
// Component
// ============================================================================

export function ProfileScreen(props: ProfileScreenProps) {
  const { className, onStartGhostGame } = props;
  const gameActions = useGameActions();

  const [profile, setProfile] = useState<PlayerProfileRecord | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGhostModalOpen, setIsGhostModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');

    (async () => {
      try {
        // รอให้ background persist ของเกมล่าสุด (ถ้ามี) เขียนลง Dexie เสร็จ
        // ก่อนเสมอ ไม่งั้นถ้าผู้เล่นกดมาหน้านี้ทันทีหลังจบเกม profile ที่
        // rebuild ได้จะไม่รวมเกมล่าสุดเข้าไปด้วย (ดูหมายเหตุบนหัวไฟล์)
        await gameActions.waitForPendingPersist();
        const record = await profileRepository.syncProfileFromGames();
        if (cancelled) return;
        setProfile(record);
        setLoadState('ready');
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setLoadState('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gameActions]);

  const handleStartGhostGame = (snapshotElo: number): void => {
    setIsGhostModalOpen(false);
    onStartGhostGame?.(snapshotElo);
  };

  if (loadState === 'loading') {
    return <ProfileScreenSkeleton className={className} />;
  }

  if (loadState === 'error' || profile === null) {
    return (
      <div className={['flex min-h-full items-center justify-center p-6', className ?? ''].join(' ')}>
        <div className="max-w-sm rounded-2xl bg-red-950/40 px-6 py-4 text-center text-sm text-red-300 ring-1 ring-red-900">
          โหลดโปรไฟล์ไม่สำเร็จ{errorMessage ? `: ${errorMessage}` : ''}
        </div>
      </div>
    );
  }

  return (
    <div className={['mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6', className ?? ''].join(' ')}>
      <ProfileHeader profile={profile} onOpenGhostSetup={() => setIsGhostModalOpen(true)} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StyleRadar styleVector={profile.styleVector} />
        <ProgressGraph progression={profile.progression} />
        <GmComparison similarities={profile.grandmasterSimilarity} />
        <HabitReport habitPatterns={profile.habitPatterns} weaknessRanking={profile.weaknessRanking} />
      </div>

      <GhostMatchSetup
        isOpen={isGhostModalOpen}
        onClose={() => setIsGhostModalOpen(false)}
        onStartGhostGame={handleStartGhostGame}
        progression={profile.progression}
      />
    </div>
  );
}

// ============================================================================
// Header
// ============================================================================

interface ProfileHeaderProps {
  readonly profile: PlayerProfileRecord;
  readonly onOpenGhostSetup: () => void;
}

function ProfileHeader(props: ProfileHeaderProps) {
  const { profile, onOpenGhostSetup } = props;
  const { aggregate } = profile;

  const totalDecisiveOrDrawn = aggregate.record.w + aggregate.record.l + aggregate.record.d;
  const winRatePercent = totalDecisiveOrDrawn > 0 ? Math.round((aggregate.record.w / totalDecisiveOrDrawn) * 100) : 0;

  return (
    <div className="rounded-2xl bg-slate-900/80 p-5 ring-1 ring-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap gap-6">
          <Stat label="เกมที่เล่น" value={aggregate.gamesPlayed.toString()} />
          <Stat label="ชนะ/แพ้/เสมอ" value={`${aggregate.record.w}/${aggregate.record.l}/${aggregate.record.d}`} sub={`อัตราชนะ ${winRatePercent}%`} />
          <Stat
            label="Elo โดยประมาณ"
            value={Math.round(aggregate.estimatedElo).toString()}
            sub={`ความเชื่อมั่น ${Math.round(clamp01(aggregate.eloConfidence) * 100)}%`}
          />
        </div>

        <button
          type="button"
          onClick={onOpenGhostSetup}
          className="whitespace-nowrap rounded-xl bg-sky-500/15 px-4 py-2.5 text-sm font-semibold text-sky-300 ring-1 ring-sky-500/40 transition-colors hover:bg-sky-500/25"
        >
          👻 ดวลกับตัวเองในอดีต
        </button>
      </div>
    </div>
  );
}

function Stat(props: { readonly label: string; readonly value: string; readonly sub?: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{props.label}</div>
      <div className="mt-0.5 text-2xl font-bold text-slate-100">{props.value}</div>
      {props.sub ? <div className="text-xs text-slate-500">{props.sub}</div> : null}
    </div>
  );
}

// ============================================================================
// Loading skeleton
// ============================================================================

function ProfileScreenSkeleton(props: { readonly className?: string }) {
  return (
    <div className={['mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6', props.className ?? ''].join(' ')}>
      <div className="h-24 animate-pulse rounded-2xl bg-slate-900/80 ring-1 ring-slate-800" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-80 animate-pulse rounded-2xl bg-slate-900/60 ring-1 ring-slate-800" />
        <div className="h-80 animate-pulse rounded-2xl bg-slate-900/60 ring-1 ring-slate-800" />
        <div className="h-64 animate-pulse rounded-2xl bg-slate-900/60 ring-1 ring-slate-800" />
        <div className="h-64 animate-pulse rounded-2xl bg-slate-900/60 ring-1 ring-slate-800" />
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}