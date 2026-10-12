/** Editor groups state for the Work area. Pure rules live in model/paneState.ts. */
import { create } from 'zustand';
import { initialPaneState, paneReducer, type PaneAction, type PaneState } from '../model/paneState.js';

export interface PanesStore extends PaneState {
  dispatch(action: PaneAction): void;
}

const demo = typeof window !== 'undefined' && window.orch?.app.demo === true;
export const usePanesStore = create<PanesStore>()((set) => ({
  ...initialPaneState(demo),
  dispatch: (action) => set((state) => paneReducer(state, action)),
}));
