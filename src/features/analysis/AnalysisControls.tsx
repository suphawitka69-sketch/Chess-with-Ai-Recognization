/**
 * src/features/analysis/AnalysisControls.tsx
 * แถบควบคุม Replay สไตล์ YouTube ตัวจริง (Scrubber + Play/Pause + Speed)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface AnalyzedMove {
  readonly ply: number;
  readonly san: string;
  readonly classification?: string | null;
}

type PlaybackSpeed = 0.5 | 1 | 2;

export interface AnalysisControlsProps {
  readonly moves: readonly AnalyzedMove[];
  readonly currentPly: number | null;
  readonly onSelectPly: (ply: number) => void;
  readonly disableKeyboardShortcuts?: boolean;
}

const SPEED_INTERVAL_MS: Record<PlaybackSpeed, number> = {
  0.5: 2500,
  1: 1200,
  2: 600,
};

const SPEED_OPTIONS: readonly PlaybackSpeed[] = [0.5, 1, 2];

const MARKER_COLOR: Record<'blunder' | 'mistake' | 'brilliant', string> = {
  blunder: 'bg-red-500',
  mistake: 'bg-orange-400',
  brilliant: 'bg-cyan-400',
};

export function AnalysisControls({
  moves,
  currentPly,
  onSelectPly,
  disableKeyboardShortcuts = false,
}: AnalysisControlsProps): JSX.Element {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  const totalPlies = moves.length;

  const currentIndex = useMemo(() => {
    if (totalPlies === 0) return 0;
    if (currentPly === null) return 0;
    const idx = moves.findIndex((m) => m.ply === currentPly);
    return idx === -1 ? 0 : idx;
  }, [moves, currentPly, totalPlies]);

  const isAtStart = currentIndex <= 0;
  const isAtEnd = totalPlies > 0 && currentIndex >= totalPlies - 1;

  const stateRef = useRef({
    currentIndex,
    totalPlies,
    moves,
    isPlaying,
    speed,
    onSelectPly,
  });

  useEffect(() => {
    stateRef.current = {
      currentIndex,
      totalPlies,
      moves,
      isPlaying,
      speed,
      onSelectPly,
    };
  }, [currentIndex, totalPlies, moves, isPlaying, speed, onSelectPly]);

  const goToIndex = useCallback(
    (index: number) => {
      if (totalPlies === 0) return;
      const clamped = Math.max(0, Math.min(totalPlies - 1, index));
      const target = moves[clamped];
      if (target) onSelectPly(target.ply);
    },
    [moves, totalPlies, onSelectPly],
  );

  const goFirst = useCallback(() => {
    setIsPlaying(false);
    goToIndex(0);
  }, [goToIndex]);

  const goLast = useCallback(() => {
    setIsPlaying(false);
    goToIndex(totalPlies - 1);
  }, [goToIndex, totalPlies]);

  const goPrev = useCallback(() => {
    setIsPlaying(false);
    goToIndex(currentIndex - 1);
  }, [goToIndex, currentIndex]);

  const goNext = useCallback(() => {
    setIsPlaying(false);
    goToIndex(currentIndex + 1);
  }, [goToIndex, currentIndex]);

  const togglePlay = useCallback(() => {
    if (totalPlies === 0) return;
    if (!isPlaying) {
      if (isAtEnd) goToIndex(0);
      setIsPlaying(true);
    } else {
      setIsPlaying(false);
    }
  }, [totalPlies, isPlaying, isAtEnd, goToIndex]);

  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setIsPlaying(false);
      goToIndex(Number(e.target.value));
    },
    [goToIndex],
  );

  // Auto-Play Engine
  useEffect(() => {
    if (!isPlaying) return undefined;

    const intervalId = setInterval(() => {
      const {
        currentIndex: curIdx,
        totalPlies: total,
        moves: currentMoves,
        onSelectPly: selectPly,
      } = stateRef.current;

      const nextIdx = curIdx + 1;
      if (nextIdx >= total) {
        setIsPlaying(false);
        return;
      }

      const nextMove = currentMoves[nextIdx];
      if (nextMove) selectPly(nextMove.ply);
    }, SPEED_INTERVAL_MS[speed]);

    return () => clearInterval(intervalId);
  }, [isPlaying, speed]);

  // Keyboard Shortcuts
  useEffect(() => {
    if (disableKeyboardShortcuts) return undefined;

    function isTyping(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    }

    function handleKeyDown(e: KeyboardEvent): void {
      if (isTyping(e.target)) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Home') {
        e.preventDefault();
        goFirst();
      } else if (e.key === 'End') {
        e.preventDefault();
        goLast();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [disableKeyboardShortcuts, goPrev, goNext, togglePlay, goFirst, goLast]);

  const markers = useMemo(() => {
    if (totalPlies <= 1) return [];
    return moves
      .map((move, idx) => ({ move, idx }))
      .filter(
        ({ move }) =>
          move.classification === 'blunder' ||
          move.classification === 'mistake' ||
          move.classification === 'brilliant',
      )
      .map(({ move, idx }) => ({
        ply: move.ply,
        classification: move.classification as 'blunder' | 'mistake' | 'brilliant',
        percent: (idx / (totalPlies - 1)) * 100,
      }));
  }, [moves, totalPlies]);

  const disabled = totalPlies === 0;

  return (
    <div className="mx-auto w-full max-w-[560px] rounded-lg border border-gray-700 bg-gray-900 p-3 text-gray-200 shadow-lg">
      {/* 1. หลอด Timeline สไตล์ YouTube */}
      <div className="relative mb-3">
        <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
          <span>
            ตาที่ {disabled ? 0 : currentIndex + 1} / {totalPlies}
          </span>
          {moves[currentIndex] && (
            <span className="font-semibold text-blue-400">
              {moves[currentIndex].san}
              {moves[currentIndex].classification ? ` (${moves[currentIndex].classification})` : ''}
            </span>
          )}
        </div>

        <div className="relative flex h-5 items-center">
          <div className="absolute h-1.5 w-full rounded-full bg-gray-700" />
          <div
            className="absolute h-1.5 rounded-full bg-blue-500 transition-all duration-150"
            style={{
              width: disabled || totalPlies <= 1 ? '0%' : `${(currentIndex / (totalPlies - 1)) * 100}%`,
            }}
          />
          {markers.map((marker) => (
            <div
              key={marker.ply}
              title={`ตาที่ ${marker.ply}: ${marker.classification}`}
              className={`pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full ring-2 ring-gray-900 ${MARKER_COLOR[marker.classification]}`}
              style={{ left: `${marker.percent}%` }}
            />
          ))}
          <input
            type="range"
            min={0}
            max={Math.max(0, totalPlies - 1)}
            step={1}
            value={Math.max(0, currentIndex)}
            onChange={handleSeek}
            disabled={disabled}
            className="absolute inset-0 h-5 w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-not-allowed"
          />
        </div>
      </div>

      {/* 2. ปุ่มควบคุม Playback & Speed */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="ตาแรกสุด"
            disabled={disabled || isAtStart}
            onClick={goFirst}
            className="flex h-8 w-8 items-center justify-center rounded-md bg-gray-800 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-30"
          >
            ⏮
          </button>
          <button
            type="button"
            title="ถอยหลัง"
            disabled={disabled || isAtStart}
            onClick={goPrev}
            className="flex h-8 w-8 items-center justify-center rounded-md bg-gray-800 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-30"
          >
            ◀
          </button>
          <button
            type="button"
            title={isPlaying ? 'พัก' : 'เล่นอัตโนมัติ'}
            disabled={disabled}
            onClick={togglePlay}
            className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-sm font-bold text-white shadow hover:bg-blue-700 active:scale-95 disabled:opacity-30"
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button
            type="button"
            title="เดินหน้า"
            disabled={disabled || isAtEnd}
            onClick={goNext}
            className="flex h-8 w-8 items-center justify-center rounded-md bg-gray-800 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-30"
          >
            ▶
          </button>
          <button
            type="button"
            title="ตาสุดท้าย"
            disabled={disabled || isAtEnd}
            onClick={goLast}
            className="flex h-8 w-8 items-center justify-center rounded-md bg-gray-800 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-30"
          >
            ⏭
          </button>
        </div>

        <div className="flex items-center gap-1 rounded-md bg-gray-800 p-0.5">
          {SPEED_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => setSpeed(option)}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                speed === option ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
            >
              {option}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default AnalysisControls;