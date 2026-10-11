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

export const useEngineStore = create<EngineState>()((set) => ({
  state: 'unknown',
  message: null,
  setHealth: (state, message) => set({ state, message }),
}));
