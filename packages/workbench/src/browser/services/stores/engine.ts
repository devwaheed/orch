/**
 * Engine health store. Fed by engine.health. 'unknown' until the first event arrives.
 */
import { create } from 'zustand';

export type EngineHealthState = 'unknown' | 'starting' | 'ready' | 'restarting' | 'failed';

export interface EngineState {
  readonly state: EngineHealthState;
  readonly message: string | null;
  setHealth(state: Exclude<EngineHealthState, 'unknown'>, message: string | null): void;
}

/**
 * ENG-07 bar: shown once the engine keeps stopping. Between automatic retries the state reads
 * 'starting' or 'restarting' but still carries that message, so the bar stays until the engine is ready.
 */
export function engineKeepsStopping(s: Pick<EngineState, 'state' | 'message'>): boolean {
  return s.state === 'failed' || (s.message !== null && s.state !== 'ready');
}

export const useEngineStore = create<EngineState>()((set) => ({
  state: 'unknown',
  message: null,
  setHealth: (state, message) => set({ state, message }),
}));
