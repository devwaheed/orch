/**
 * Theme service (UI-02).
 * Follows the system until the user picks one; the choice is remembered in localStorage.
 * Sets data-theme="dark" | "light" on document.documentElement.
 */
import { create } from 'zustand';

export type ThemeChoice = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'orch.theme';

function getSystemTheme(): ResolvedTheme {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

function getStoredChoice(): ThemeChoice {
  if (typeof window !== 'undefined' && window.localStorage) {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light' || stored === 'system') {
      return stored;
    }
  }
  return 'system';
}

function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') {
    return getSystemTheme();
  }
  return choice;
}

function applyThemeToDOM(theme: ResolvedTheme, choice: ThemeChoice): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (choice === 'system') {
    // When following system, data-theme reflects the resolved theme
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.setAttribute('data-theme', choice);
  }
}

export interface ThemeState {
  choice: ThemeChoice;
  resolvedTheme: ResolvedTheme;
  setTheme: (choice: ThemeChoice) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initialChoice = getStoredChoice();
  const initialResolved = resolveTheme(initialChoice);
  applyThemeToDOM(initialResolved, initialChoice);

  if (typeof window !== 'undefined' && window.matchMedia) {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    media.addEventListener('change', () => {
      const currentChoice = get().choice;
      if (currentChoice === 'system') {
        const nextResolved = getSystemTheme();
        applyThemeToDOM(nextResolved, 'system');
        set({ resolvedTheme: nextResolved });
      }
    });
  }

  return {
    choice: initialChoice,
    resolvedTheme: initialResolved,
    setTheme(choice: ThemeChoice): void {
      const resolved = resolveTheme(choice);
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, choice);
      }
      applyThemeToDOM(resolved, choice);
      set({ choice, resolvedTheme: resolved });
    },
    toggleTheme(): void {
      const current = get().resolvedTheme;
      const nextChoice: ThemeChoice = current === 'light' ? 'dark' : 'light';
      get().setTheme(nextChoice);
    },
  };
});
