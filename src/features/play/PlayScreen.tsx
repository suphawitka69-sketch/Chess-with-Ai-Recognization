/**
 * PlayScreen.tsx
 * ---------------------------------------------------------------------------
 * หน้าจอเล่นเกมแบบสมบูรณ์ — ประกอบ BoardContainer + ChessClock + control
 * panel (เริ่มเกม/ยอมแพ้/เลือกสี/เลือกระดับ) เข้าด้วยกัน และแสดงสถานะการ
 * แข่งขันแบบ real-time (Engine กำลังคิด / ถูกเช็ก / ผลจบเกม)
 *
 * ไฟล์นี้เป็นที่เดียวที่เรียก useEngine() เพื่อรับผิดชอบ initialize EnginePool
 * ของทั้งหน้าจอเล่นเกม — BoardContainer/ChessClock ไม่ยุ่งกับ engine lifecycle
 * เลย อ่านแต่ fen/clock จาก useGameStore เท่านั้น (แยกความรับผิดชอบชัดเจน)
 *
 * ⚠️ หมายเหตุ: บรรทัดที่ดึง `gameId` จาก useGameStore ด้านล่างสมมติว่า store มี
 * ฟิลด์ `state.gameId` (ตามแพทเทิร์นเดียวกับ playerColor/turn/lastMove) ถ้าชื่อ
 * จริงต่างไปให้แก้แค่บรรทัด selector นั้นบรรทัดเดียว ส่วนที่เหลือไม่กระทบ
 * ---------------------------------------------------------------------------
 */

import { useEffect, useMemo, useState } from 'react';
import type { EngineBuildUrls } from '../../core/engine/EnginePool';
import type { PieceColor } from '../../core/chess/GameEngine';
import { parseTimeControlNotation } from '../../core/chess/Clock';
import { useEngine } from '../../hooks/useEngine';
import { useGameActions, useGameOutcome, useGamePhase, useIsEngineThinking, useGameStore } from '../../state/useGameStore';
import { BoardContainer } from './BoardContainer';
import { ChessClock } from './ChessClock';
import { PanicMeter } from './PanicMeter';
import { GameOverModal } from '../gameover/GameOverModal';

// ============================================================================
// Types
// ============================================================================

export interface PlayScreenProps {
  readonly engineBuildUrls: EngineBuildUrls;
  readonly className?: string;
  /** เรียกเมื่อผู้เล่นกด "กลับเมนู" จาก modal สรุปผล — ปล่อยว่างถ้าหน้านี้ไม่มีเมนูอื่นให้กลับไป */
  readonly onExitToMenu?: () => void;
  /** เรียกเมื่อผู้เล่นกด "รับการสอน" จาก modal สรุปผล — ส่ง gameId ของเกมที่เพิ่งจบไป */
  readonly onNavigateToAnalysis?: (gameId: string) => void;
}

interface TimeControlPreset {
  readonly label: string;
  readonly notation: string;
}

const TIME_CONTROL_PRESETS: readonly TimeControlPreset[] = [
  { label: '3+2 (บูลเล็ต)', notation: '3+2' },
  { label: '5+0 (บลิตซ์)', notation: '5+0' },
  { label: '10+5 (แรพิด)', notation: '10+5' },
  { label: '15+10 (แรพิด)', notation: '15+10' },
];

// ============================================================================
// Component
// ============================================================================

export function PlayScreen(props: PlayScreenProps) {
  const { engineBuildUrls, className, onExitToMenu, onNavigateToAnalysis } = props;

  const engine = useEngine({ buildUrls: engineBuildUrls });
  const gameActions = useGameActions();
  const phase = useGamePhase();
  const isEngineThinking = useIsEngineThinking();
  const outcome = useGameOutcome();
  const playerColor = useGameStore((s) => s.state.playerColor);
  const turn = useGameStore((s) => s.state.turn);
  const lastMove = useGameStore((s) => s.state.lastMove);
  const errorMessage = useGameStore((s) => s.state.errorMessage);
  // ⚠️ สมมติฐาน: store มี state.gameId — แก้บรรทัดนี้บรรทัดเดียวถ้าชื่อจริงต่างไป
  const gameId = useGameStore((s) => s.state.gameId);

  const [setupColor, setSetupColor] = useState<PieceColor>('w');
  const [setupStrengthLevel, setSetupStrengthLevel] = useState<number>(3);
  const [setupTimeControlNotation, setSetupTimeControlNotation] = useState<string>('10+5');
  const [showWinToast, setShowWinToast] = useState(false);

  const isSetupVisible = phase === 'idle' || phase === 'initializing';

  useEffect(() => {
    if (phase === 'ended' && outcome && outcome.winner === playerColor) {
      setShowWinToast(true);
      const timer = window.setTimeout(() => setShowWinToast(false), 3000);
      return () => window.clearTimeout(timer);
    }
    setShowWinToast(false);
  }, [phase, outcome, playerColor]);

  const statusText = useMemo(() => {
    if (phase === 'idle') return 'ตั้งค่าเกมแล้วกด "เริ่มเกม" เพื่อเริ่มเล่น';
    if (phase === 'initializing') return 'กำลังเตรียมเกม…';
    if (phase === 'paused') return 'เกมหยุดชั่วคราว — กด "เล่นต่อ" เพื่อดำเนินเกมต่อ';
    if (phase === 'ended') return null; // แสดงผ่าน modal แทน
    if (isEngineThinking) return 'Engine กำลังคิด…';
    if (lastMove?.isCheck && turn === playerColor) return 'คุณถูกเช็ก!';
    if (lastMove?.isCheck && turn !== playerColor) return 'คุณรุกคู่ต่อสู้แล้ว รอ Engine ตอบโต้…';
    return turn === playerColor ? 'ตาของคุณ' : 'รอ Engine เดิน…';
  }, [phase, isEngineThinking, lastMove, turn, playerColor]);

  const handleStartGame = (): void => {
    void gameActions.initGame({
      playerColor: setupColor,
      strengthLevel: setupStrengthLevel,
      timeControl: parseTimeControlNotation(setupTimeControlNotation),
    });
  };

  const handlePause = (): void => {
    gameActions.pauseGame();
  };

  const handleResume = (): void => {
    gameActions.resumeGame();
  };

  const handleResign = (): void => {
    gameActions.resign();
  };

  const handleRematch = (): void => {
    gameActions.reset();
  };

  const handleAnalyze = (): void => {
    if (gameId) {
      onNavigateToAnalysis?.(gameId);
    }
  };

  return (
    <div className={['mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:flex-row lg:items-start', className ?? ''].join(' ')}>
      {showWinToast ? (
        <div className="pointer-events-none fixed right-5 top-20 z-[60] rounded-xl bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-300 ring-1 ring-emerald-500/40 shadow-lg shadow-emerald-500/10 backdrop-blur-sm">
          🎉 คุณชนะแล้ว!
        </div>
      ) : null}

      {/* กระดาน + นาฬิกาฝั่งตรงข้ามด้านบน / ผู้เล่นด้านล่าง (จัดชิดกระดาน) */}
      <div className="flex flex-1 flex-col items-center gap-3">
        <div className="w-full max-w-[640px]">
          <ChessClock stacked className="mb-2" />
        </div>

        <div className="relative w-full max-w-[640px]">
          <BoardContainer />

          {!engine.isReady && phase === 'idle' ? (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-slate-950/70 backdrop-blur-sm">
              <div className="text-center text-sm text-slate-300">
                {engine.isInitializing ? 'กำลังโหลด Chess Engine…' : (engine.errorMessage ?? 'กำลังเตรียม Engine…')}
              </div>
            </div>
          ) : null}
        </div>

        {statusText ? (
          <div className="rounded-full bg-slate-900/70 px-4 py-1.5 text-sm font-medium text-slate-200 ring-1 ring-slate-800">
            {statusText}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="rounded-lg bg-red-950/60 px-4 py-2 text-sm text-red-300 ring-1 ring-red-900">{errorMessage}</div>
        ) : null}
      </div>

      {/* Control panel + separate panic card */}
      <div className="flex w-full shrink-0 flex-col gap-4 lg:w-80">
        <aside className="w-full rounded-2xl bg-slate-900/60 p-5 ring-1 ring-slate-800">
          <h2 className="mb-4 text-lg font-semibold text-slate-100">Chess Coach</h2>

        {isSetupVisible ? (
          <div className="flex flex-col gap-5">
            <div>
              <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">เลือกฝั่งที่เล่น</span>
              <div className="grid grid-cols-2 gap-2">
                {(['w', 'b'] as const).map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setSetupColor(color)}
                    className={[
                      'rounded-lg px-3 py-2 text-sm font-medium ring-1 transition-colors',
                      setupColor === color
                        ? 'bg-sky-500/20 text-sky-300 ring-sky-500/60'
                        : 'bg-slate-800/60 text-slate-300 ring-slate-700 hover:bg-slate-800',
                    ].join(' ')}
                  >
                    {color === 'w' ? 'ฝ่ายขาว' : 'ฝ่ายดำ'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">ระดับความยาก</span>
              <div className="grid grid-cols-4 gap-1.5">
                {engine.strengthLadder.map((preset) => (
                  <button
                    key={preset.level}
                    type="button"
                    onClick={() => setSetupStrengthLevel(preset.level)}
                    title={preset.labelTh}
                    className={[
                      'rounded-lg px-2 py-2 text-xs font-medium ring-1 transition-colors',
                      setupStrengthLevel === preset.level
                        ? 'bg-sky-500/20 text-sky-300 ring-sky-500/60'
                        : 'bg-slate-800/60 text-slate-300 ring-slate-700 hover:bg-slate-800',
                    ].join(' ')}
                  >
                    {preset.level}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {engine.strengthLadder.find((p) => p.level === setupStrengthLevel)?.labelTh ?? ''}
              </p>
            </div>

            <div>
              <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">การจับเวลา</span>
              <div className="grid grid-cols-2 gap-1.5">
                {TIME_CONTROL_PRESETS.map((preset) => (
                  <button
                    key={preset.notation}
                    type="button"
                    onClick={() => setSetupTimeControlNotation(preset.notation)}
                    className={[
                      'rounded-lg px-2 py-2 text-xs font-medium ring-1 transition-colors',
                      setupTimeControlNotation === preset.notation
                        ? 'bg-sky-500/20 text-sky-300 ring-sky-500/60'
                        : 'bg-slate-800/60 text-slate-300 ring-slate-700 hover:bg-slate-800',
                    ].join(' ')}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={handleStartGame}
              disabled={!engine.isReady}
              className="mt-2 w-full rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {engine.isReady ? 'เริ่มเกม' : 'กำลังเตรียม Engine…'}
            </button>

            {engine.errorMessage ? <p className="text-xs text-red-400">{engine.errorMessage}</p> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-400">
                <dt>คุณเล่นฝั่ง</dt>
                <dd className="text-slate-200">{playerColor === 'w' ? 'ขาว' : 'ดำ'}</dd>
              </div>
              <div className="flex justify-between text-slate-400">
                <dt>ระดับ Engine</dt>
                <dd className="text-slate-200">
                  {engine.strengthLadder.find((p) => p.level === setupStrengthLevel)?.labelTh ?? '-'}
                </dd>
              </div>
              {engine.threadMode ? (
                <div className="flex justify-between text-slate-400">
                  <dt>โหมด Engine</dt>
                  <dd className="text-slate-200">{engine.threadMode === 'multi-thread' ? 'Multi-thread' : 'Single-thread'}</dd>
                </div>
              ) : null}
            </dl>

            {phase === 'playing' || phase === 'paused' ? (
              <div className="grid grid-cols-2 gap-2">
                {phase === 'playing' ? (
                  <button
                    type="button"
                    onClick={handlePause}
                    className="rounded-xl bg-amber-500/15 px-4 py-2.5 text-sm font-semibold text-amber-300 ring-1 ring-amber-500/40 transition-colors hover:bg-amber-500/25"
                  >
                    หยุดเกม
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleResume}
                    className="rounded-xl bg-emerald-500/15 px-4 py-2.5 text-sm font-semibold text-emerald-300 ring-1 ring-emerald-500/40 transition-colors hover:bg-emerald-500/25"
                  >
                    เล่นต่อ
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleResign}
                  className="rounded-xl bg-red-500/15 px-4 py-2.5 text-sm font-semibold text-red-300 ring-1 ring-red-500/40 transition-colors hover:bg-red-500/25"
                >
                  ยอมแพ้
                </button>
              </div>
            ) : null}

            {phase === 'ended' ? (
              <button
                type="button"
                onClick={handleRematch}
                className="w-full rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-400"
              >
                ตั้งค่าเกมใหม่
              </button>
            ) : null}
          </div>
        )}

        </aside>

        {phase === 'playing' ? (
          <section className="flex w-full justify-center rounded-2xl bg-slate-900/60 px-5 py-4 ring-1 ring-slate-800">
            <PanicMeter maxWidth={240} />
          </section>
        ) : null}
      </div>

      {phase === 'ended' && outcome ? (
        <GameOverModal
          outcome={outcome}
          playerColor={playerColor}
          onRematch={handleRematch}
          onMenu={onExitToMenu}
          onAnalyze={handleAnalyze}
          analyzeAvailable={true}
        />
      ) : null}
    </div>
  );
}