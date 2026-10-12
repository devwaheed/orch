/**
 * Which side the activity bar sits on. Left by default (the design); the
 * user's choice is remembered in localStorage like the theme.
 */
import { create } from 'zustand';

export type MenuSide = 'left' | 'right';

const STORAGE_KEY = 'orch.menuSide';

function storedSide(): MenuSide {
  return typeof window !== 'undefined' && window.localStorage?.getItem(STORAGE_KEY) === 'right' ? 'right' : 'left';
}

export interface MenuSideState {
  side: MenuSide;
  toggleSide: () => void;
}

export const useMenuSideStore = create<MenuSideState>((set, get) => ({
  side: storedSide(),
  toggleSide(): void {
    const side: MenuSide = get().side === 'left' ? 'right' : 'left';
    window.localStorage?.setItem(STORAGE_KEY, side);
    set({ side });
  },
}));
