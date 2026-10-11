/** Editor groups state for the Work area. Pure rules live in model/paneState.ts. */
import { create } from 'zustand';
import { EMPTY_PANE_STATE, paneReducer, type PaneAction, type PaneState } from '../model/paneState.js';

export interface PanesStore extends PaneState {
  dispatch(action: PaneAction): void;
}

export const usePanesStore = create<PanesStore>()((set) => ({
  ...EMPTY_PANE_STATE,
  dispatch: (action) => set((state) => paneReducer(state, action)),
}));
