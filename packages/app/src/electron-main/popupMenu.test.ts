import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { popupMenuArgsSchema, showPopupMenu, type PopupMenuPort } from './popupMenu.js';

describe('native popup menu', () => {
  it('accepts only plain id and label items with finite coordinates', () => {
    expect(popupMenuArgsSchema.safeParse([[{ id: 'spec', label: 'New spec' }], 12, 24]).success).toBe(true);
    expect(popupMenuArgsSchema.safeParse([[{ id: 'spec', label: 'New spec', type: 'checkbox' }], 12, 24]).success).toBe(false);
    expect(popupMenuArgsSchema.safeParse([[{ id: '', label: 'New spec' }], 12, 24]).success).toBe(false);
    expect(popupMenuArgsSchema.safeParse([[], Number.NaN, 24]).success).toBe(false);
  });

  it('resolves with the clicked item id', async () => {
    let options: { window: BrowserWindow; x: number; y: number; callback: () => void } | undefined;
    let template: Array<{ id: string; label: string; click: () => void }> = [];
    const menu: PopupMenuPort = {
      buildFromTemplate: (items) => {
        template = items;
        return { popup: (value) => { options = value; } };
      },
    };
    const window = {} as BrowserWindow;
    const result = showPopupMenu(menu, window, [{ id: 'product', label: 'New product' }], 12, 24);
    expect(template.map(({ id, label }) => ({ id, label }))).toEqual([{ id: 'product', label: 'New product' }]);
    expect(options).toMatchObject({ window, x: 12, y: 24 });
    template[0]?.click();
    options?.callback();
    await expect(result).resolves.toBe('product');
  });

  it('resolves null when the menu is dismissed', async () => {
    const callback = vi.fn();
    const menu: PopupMenuPort = { buildFromTemplate: () => ({ popup: (options) => { callback.mockImplementation(options.callback); } }) };
    const result = showPopupMenu(menu, {} as BrowserWindow, [], 0, 0);
    callback();
    await expect(result).resolves.toBeNull();
  });
});
