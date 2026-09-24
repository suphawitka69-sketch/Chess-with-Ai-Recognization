/**
 * src/state/useTelemetryStore.ts
 */
import { create } from 'zustand';

export const TIME_PRESSURE_RATIO_THRESHOLD = 0.25;

export interface TelemetryState {
  readonly currentPanicScore: number;
  readonly panicDelta: number;
  readonly hesitationIndex: number;
  readonly isUnderTimePressure: boolean;
  readonly triggerFlags: readonly string[];
  readonly lastCommittedPanicScore: number;
}

export interface LiveTelemetryUpdate {
  readonly panicScore?: number;
  readonly hesitationIndex?: number;
  readonly isUnderTimePressure?: boolean;
  readonly triggerFlags?: readonly string[];
}

export interface TelemetryActions {
  readonly updateLiveMetrics: (update: LiveTelemetryUpdate) => void;
  readonly setPanicScore: (score: number) => void;
  readonly setHesitationIndex: (index: number) => void;
  readonly setUnderTimePressure: (value: boolean) => void;
  readonly setTriggerFlags: (flags: readonly string[]) => void;
  readonly commitMove: () => void;
  readonly reset: () => void;
}

export interface TelemetryStore {
  readonly state: TelemetryState;
  readonly actions: TelemetryActions;
}

const initialTelemetryState: TelemetryState = {
  currentPanicScore: 0,
  panicDelta: 0,
  hesitationIndex: 0,
  isUnderTimePressure: false,
  triggerFlags: [],
  lastCommittedPanicScore: 0,
};

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function computeIsUnderTimePressure(remainingMs: number, baseMs: number): boolean {
  if (baseMs <= 0) return false;
  return remainingMs / baseMs < TIME_PRESSURE_RATIO_THRESHOLD;
}

export { clamp01 as clampHesitationIndex };

export const useTelemetryStore = create<TelemetryStore>()((set) => ({
  state: initialTelemetryState,

  actions: {
    updateLiveMetrics: (update) => {
      set((s) => {
        const nextPanicScore = update.panicScore ?? s.state.currentPanicScore;
        return {
          state: {
            ...s.state,
            currentPanicScore: nextPanicScore,
            panicDelta: nextPanicScore - s.state.lastCommittedPanicScore,
            hesitationIndex: update.hesitationIndex !== undefined ? clamp01(update.hesitationIndex) : s.state.hesitationIndex,
            isUnderTimePressure: update.isUnderTimePressure ?? s.state.isUnderTimePressure,
            triggerFlags: update.triggerFlags ?? s.state.triggerFlags,
          },
        };
      });
    },

    setPanicScore: (score) => {
      set((s) => ({
        state: {
          ...s.state,
          currentPanicScore: score,
          panicDelta: score - s.state.lastCommittedPanicScore,
        },
      }));
    },

    setHesitationIndex: (index) => {
      set((s) => ({ state: { ...s.state, hesitationIndex: clamp01(index) } }));
    },

    setUnderTimePressure: (value) => {
      set((s) => ({ state: { ...s.state, isUnderTimePressure: value } }));
    },

    setTriggerFlags: (flags) => {
      set((s) => ({ state: { ...s.state, triggerFlags: flags } }));
    },

    commitMove: () => {
      set((s) => ({
        state: {
          ...s.state,
          panicDelta: 0,
          hesitationIndex: 0,
          isUnderTimePressure: false,
          triggerFlags: [],
          lastCommittedPanicScore: s.state.currentPanicScore,
        },
      }));
    },

    reset: () => {
      set(() => ({ state: initialTelemetryState }));
    },
  },
}));

export function useTelemetryActions(): TelemetryActions {
  return useTelemetryStore((s) => s.actions);
}
export function usePanicScore(): number {
  return useTelemetryStore((s) => s.state.currentPanicScore);
}
export const useCurrentPanicScore = usePanicScore;
export function usePanicDelta(): number {
  return useTelemetryStore((s) => s.state.panicDelta);
}
export function useHesitationIndex(): number {
  return useTelemetryStore((s) => s.state.hesitationIndex);
}
export function useIsUnderTimePressure(): boolean {
  return useTelemetryStore((s) => s.state.isUnderTimePressure);
}
export function usePanicTriggerFlags(): readonly string[] {
  return useTelemetryStore((s) => s.state.triggerFlags);
}