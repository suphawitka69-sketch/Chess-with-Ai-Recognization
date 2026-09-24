/**
 * src/App.tsx
 * ---------------------------------------------------------------------------
 * จุดศูนย์กลางนำทาง (Main Navigation Router)
 * เชื่อมต่อปุ่ม "รับการสอน" จาก PlayScreen ให้กระโดดไปหน้า AnalysisScreen ได้จริง
 * พร้อมแถบเมนูด้านบนสลับหน้า [เล่นเกม] | [วิเคราะห์] | [โปรไฟล์]
 *
 * [แก้แล้ว] `startGhostGame` เดิมอ่าน `db.profile.get('local_player')` ตรงๆ
 * ซึ่งเป็นแถว "cache" ที่จะอัปเดตก็ต่อเมื่อมีใครเรียก syncProfileFromGames()
 * มาก่อนเท่านั้น — ถ้าผู้เล่นจบเกมแล้วกด "ดวลกับตัวเองในอดีต" โดยยังไม่เคย
 * เปิดหน้าโปรไฟล์เลยในเซสชันนี้ (หรือ Dexie แถว profile ยังไม่เคยถูกสร้าง)
 * จะได้ profile ที่ stale หรือแย่กว่านั้นคือ `return` เงียบๆ ไปเลยโดยไม่มี
 * error ใดๆ ให้ผู้เล่นเห็น ขัดกับกฎเหล็กที่ว่า Ghost mode ต้องอ่าน profile
 * ล่าสุดจากฐานข้อมูลจริงเสมอ ไม่ใช่ cache หรือ profile เดิมที่ stale — แก้โดย
 * เรียก profileRepository.syncProfileFromGames() แทน ซึ่งจะ rebuild ทั้งก้อน
 * จาก db.games/db.moveLogs ทั้งหมดใหม่ทุกครั้ง (และรอ waitForPendingPersist()
 * ก่อนเสมอ กันไม่ให้เกมล่าสุดที่เพิ่งจบหายไปจากการคำนวณ)
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import type { EngineBuildUrls } from './core/engine/EnginePool';
import { PlayScreen } from './features/play/PlayScreen';
import { AnalysisScreen } from './features/analysis/AnalysisScreen';
import { ProfileScreen } from './features/profile/ProfileScreen';
import { useGameId } from './state/useGameStore';
import { useGameActions } from './state/useGameStore';
import { profileRepository } from './data/repositories/ProfileRepository';
import type { ClockConfig } from './core/chess/Clock';

export interface AppProps {
  readonly engineBuildUrls: EngineBuildUrls;
}

export type ActiveTab = 'play' | 'analysis' | 'profile';

const CURRENT_TAB_KEY = 'chess-coach.currentTab';
const ACTIVE_GAME_ID_KEY = 'chess-coach.activeGameId';

function isActiveTab(value: string | null): value is ActiveTab {
  return value === 'play' || value === 'analysis' || value === 'profile';
}

function readStoredValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable in private or restricted browser contexts.
  }
}

export function App(props: AppProps) {
  const { engineBuildUrls } = props;
  const gameId = useGameId();
  const gameActions = useGameActions();
  const [currentTab, setCurrentTab] = useState<ActiveTab>(() => {
    const storedTab = readStoredValue(CURRENT_TAB_KEY);
    return isActiveTab(storedTab) ? storedTab : 'play';
  });
  const [activeGameId, setActiveGameId] = useState<string | null>(() => readStoredValue(ACTIVE_GAME_ID_KEY));

  useEffect(() => {
    writeStoredValue(CURRENT_TAB_KEY, currentTab);
  }, [currentTab]);

  useEffect(() => {
    if (gameId) {
      setActiveGameId(gameId);
      writeStoredValue(ACTIVE_GAME_ID_KEY, gameId);
    }
  }, [gameId]);

  const analysisGameId = gameId ?? activeGameId;

  const navigateToAnalysis = (targetGameId: string): void => {
    setActiveGameId(targetGameId);
    writeStoredValue(ACTIVE_GAME_ID_KEY, targetGameId);
    setCurrentTab('analysis');
  };

  const startGhostGame = async (snapshotElo: number): Promise<void> => {
    // 1) รอ background persist ของเกมล่าสุด (ถ้ามีค้างอยู่) ให้เขียนลง
    //    db.games/db.moveLogs เสร็จจริงก่อน
    await gameActions.waitForPendingPersist();

    // 2) rebuild profile จาก all-history ทั้งหมดใหม่เสมอ — ไม่อ่าน db.profile
    //    ตรงๆ เพราะแถวนั้นอาจยังไม่เคย sync เลยในเซสชันนี้ หรือ sync ไว้นาน
    //    แล้วตั้งแต่ก่อนเกมล่าสุดจบ ทำให้ habitPatterns/estimatedElo ที่ Ghost
    //    จะใช้เป็น stale ไม่ตรงกับประวัติเกมจริงล่าสุด
    const profile = await profileRepository.syncProfileFromGames();

    const timeControl: ClockConfig = { baseMs: 10 * 60_000, incrementMs: 5_000 };
    await gameActions.initGame({
      playerColor: 'w',
      strengthLevel: 3,
      timeControl,
      opponent: {
        type: 'ghost_self',
        strengthLevel: 3,
        uciElo: snapshotElo || profile.aggregate.estimatedElo || 1200,
        label: 'ตัวคุณในอดีต (Ghost)',
        ghostSourceProfileSnapshot: JSON.stringify(profile),
        profileSnapshot: profile,
      },
    });
    setCurrentTab('play');
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-950 text-slate-100 antialiased">
      {/* แถบ Navigation Bar ด้านบน */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-800/80 bg-slate-900/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-3">
          <span className="text-xl font-black tracking-wider text-sky-400">CHESS COACH</span>
          <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-400 ring-1 ring-sky-500/30">
            AI Platform
          </span>
        </div>

        {/* ปุ่มสลับ 3 หน้าจอหลัก */}
        <nav className="flex items-center gap-1 rounded-xl bg-slate-950/60 p-1 ring-1 ring-slate-800">
          <button
            type="button"
            onClick={() => setCurrentTab('play')}
            className={[
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
              currentTab === 'play'
                ? 'bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200',
            ].join(' ')}
          >
            <span>♟️</span>
            <span>เล่นเกม</span>
          </button>

          <button
            type="button"
            onClick={() => setCurrentTab('analysis')}
            className={[
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
              currentTab === 'analysis'
                ? 'bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200',
            ].join(' ')}
          >
            <span>🔍</span>
            <span>วิเคราะห์</span>
          </button>

          <button
            type="button"
            onClick={() => setCurrentTab('profile')}
            className={[
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
              currentTab === 'profile'
                ? 'bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200',
            ].join(' ')}
          >
            <span>👤</span>
            <span>โปรไฟล์</span>
          </button>
        </nav>
      </header>

      {/* เนื้อหาหน้าจอตาม Tab ที่เลือก */}
      <main className="flex-1">
        {currentTab === 'play' && (
          <PlayScreen
            engineBuildUrls={engineBuildUrls}
            className="min-h-full"
            // ⭐ ส่งคำสั่งนี้เข้าไปให้ PlayScreen ปลดล็อกปุ่มรับการสอน!
            onNavigateToAnalysis={navigateToAnalysis}
          />
        )}

        {currentTab === 'analysis' && (
          <div className="p-4 sm:p-6">
            {analysisGameId ? <AnalysisScreen gameId={analysisGameId} /> : <p className="text-slate-400">ยังไม่มีเกมสำหรับวิเคราะห์</p>}
          </div>
        )}

        {currentTab === 'profile' && (
          <div className="p-4 sm:p-6">
            <ProfileScreen onStartGhostGame={startGhostGame} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;