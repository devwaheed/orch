import { z } from 'zod';
import type { BrowserWindow } from 'electron';

export const popupMenuArgsSchema = z.tuple([
  z.array(z.object({ id: z.string().min(1), label: z.string() }).strict()).max(50),
  z.number().finite(),
  z.number().finite(),
]);

export interface PopupMenuPort {
  buildFromTemplate(items: Array<{ id: string; label: string; click: () => void }>): {
    popup(options: { window: BrowserWindow; x: number; y: number; callback: () => void }): void;
  };
}

/** Builds a plain native menu and resolves with its selected id or null on dismissal. */
export function showPopupMenu(
  menu: PopupMenuPort,
  window: BrowserWindow,
  items: readonly { readonly id: string; readonly label: string }[],
  x: number,
  y: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    let selected: string | null = null;
    const nativeMenu = menu.buildFromTemplate(items.map(({ id, label }) => ({
      id,
      label,
      click: () => { selected = id; },
    })));
    nativeMenu.popup({ window, x, y, callback: () => resolve(selected) });
  });
}
