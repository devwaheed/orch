import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { useThemeStore } from '../src/browser/services/theme.js';

interface MockDocument {
  documentElement: {
    setAttribute: (name: string, val: string) => void;
    getAttribute: (name: string) => string | null;
  };
}

interface MockStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  clear: () => void;
}

interface MockWindow {
  localStorage: MockStorage;
}

describe('Theme Service (UI-02)', () => {
  let originalDocument: unknown;
  let originalWindow: unknown;
  let mockAttributes: Record<string, string>;
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    mockAttributes = {};
    mockStorage = {};

    originalDocument = (globalThis as unknown as { document?: unknown }).document;
    originalWindow = (globalThis as unknown as { window?: unknown }).window;

    const mockDoc: MockDocument = {
      documentElement: {
        setAttribute: (name: string, val: string) => {
          mockAttributes[name] = val;
        },
        getAttribute: (name: string) => mockAttributes[name] ?? null,
      },
    };

    const mockWin: MockWindow = {
      localStorage: {
        getItem: (k: string) => mockStorage[k] ?? null,
        setItem: (k: string, v: string) => {
          mockStorage[k] = v;
        },
        clear: () => {
          mockStorage = {};
        },
      },
    };

    (globalThis as unknown as { document?: MockDocument }).document = mockDoc;
    (globalThis as unknown as { window?: MockWindow }).window = mockWin;

    useThemeStore.getState().setTheme('system');
  });

  afterEach(() => {
    (globalThis as unknown as { document?: unknown }).document = originalDocument;
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
  });

  it('can set theme explicitly to dark or light and updates DOM and storage', () => {
    const { setTheme } = useThemeStore.getState();

    setTheme('light');
    expect(useThemeStore.getState().choice).toBe('light');
    expect(useThemeStore.getState().resolvedTheme).toBe('light');
    expect(
      (globalThis as unknown as { document: MockDocument }).document.documentElement.getAttribute(
        'data-theme',
      ),
    ).toBe('light');
    expect(
      (globalThis as unknown as { window: MockWindow }).window.localStorage.getItem('orch.theme'),
    ).toBe('light');

    setTheme('dark');
    expect(useThemeStore.getState().choice).toBe('dark');
    expect(useThemeStore.getState().resolvedTheme).toBe('dark');
    expect(
      (globalThis as unknown as { document: MockDocument }).document.documentElement.getAttribute(
        'data-theme',
      ),
    ).toBe('dark');
    expect(
      (globalThis as unknown as { window: MockWindow }).window.localStorage.getItem('orch.theme'),
    ).toBe('dark');
  });

  it('toggles between dark and light', () => {
    const { setTheme, toggleTheme } = useThemeStore.getState();

    setTheme('light');
    expect(useThemeStore.getState().resolvedTheme).toBe('light');

    toggleTheme();
    expect(useThemeStore.getState().choice).toBe('dark');
    expect(useThemeStore.getState().resolvedTheme).toBe('dark');

    toggleTheme();
    expect(useThemeStore.getState().choice).toBe('light');
    expect(useThemeStore.getState().resolvedTheme).toBe('light');
  });

  it('restores system mode', () => {
    const { setTheme } = useThemeStore.getState();
    setTheme('dark');
    expect(useThemeStore.getState().choice).toBe('dark');

    setTheme('system');
    expect(useThemeStore.getState().choice).toBe('system');
    expect(['dark', 'light']).toContain(useThemeStore.getState().resolvedTheme);
  });
});
