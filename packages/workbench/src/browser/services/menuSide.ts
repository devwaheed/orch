/**
 * Which side the activity bar sits on. Left by default (the design); the
 * user's choice is remembered in localStorage like the theme. As in VS Code,
 * the side bar follows the activity bar and the capacity panel takes the other
 * edge: CSS reads data-menu-side on the root element.
 */
import { create } from 'zustand';

export type MenuSide = 'left' | 'right';

const STORAGE_KEY = 'orch.menuSide';

function storedSide(): MenuSide {
  return typeof window !== 'undefined' && window.localStorage?.getItem(STORAGE_KEY) === 'right' ? 'right' : 'left';
}

export interface MenuSideState {
  side: MenuSide;
  setSide: (side: MenuSide) => void;
  toggleSide: () => void;
}

function apply(side: MenuSide): void {
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-menu-side', side);
}

export const useMenuSideStore = create<MenuSideState>((set, get) => {
  const initial = storedSide();
  apply(initial);
  return {
    side: initial,
    setSide(side: MenuSide): void {
      if (get().side === side) return;
      window.localStorage?.setItem(STORAGE_KEY, side);
      apply(side);
      set({ side });
    },
    toggleSide(): void {
      const next: MenuSide = get().side === 'left' ? 'right' : 'left';
      get().setSide(next);
    },
  };
});
