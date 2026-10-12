/**
 * xterm.js behind the TermLike interface (ARC-05, pinned in packages/workbench/package.json).
 * The only file in the dock that imports xterm. Colours and the font come from the
 * design tokens on the element, so light and dark themes follow the window.
 */
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { terminalStrings } from './strings.js';
import type { TermLike } from './terminalController.js';
import { terminalSize } from './terminalTabs.js';

/** Dock body text: 12px IBM Plex Mono at line height 1.6 (design/prototype/Main.dc.html, terminal dock). */
const FONT_SIZE = 12;
const LINE_HEIGHT = 1.6;
const FONT_FAMILY = "'IBM Plex Mono'";

function readToken(source: HTMLElement, name: string): string {
  return getComputedStyle(source).getPropertyValue(name).trim();
}

/** Width of one monospace character cell in CSS pixels, measured with the same font as the terminal. */
function measureCell(fontFamily: string): { width: number; height: number } {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return { width: FONT_SIZE * 0.6, height: FONT_SIZE * LINE_HEIGHT };
  context.font = `${FONT_SIZE}px ${fontFamily.includes('IBM Plex Mono') ? FONT_FAMILY : fontFamily}`;
  const sample = '0'.repeat(10);
  return { width: context.measureText(sample).width / sample.length, height: FONT_SIZE * LINE_HEIGHT };
}

export function createXterm(): TermLike {
  const term = new Terminal({
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    fontFamily: FONT_FAMILY,
    letterSpacing: 0,
  });
  const fit = (parent: HTMLElement) => {
    // A hidden tab has no size yet; its ResizeObserver refits it when it is shown.
    if (parent.clientWidth === 0 || parent.clientHeight === 0) return;
    if (!document.fonts.check(`${FONT_SIZE}px 'IBM Plex Mono'`)) {
      void document.fonts.load(`${FONT_SIZE}px 'IBM Plex Mono'`).then(() => {
        if (parent.isConnected && parent.clientWidth > 0 && parent.clientHeight > 0) fit(parent);
      });
      return;
    }
    const fontFamily = readToken(parent, '--font-mono');
    const { cols, rows } = terminalSize(parent.clientWidth, parent.clientHeight, measureCell(fontFamily || 'monospace'));
    if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows);
  };

  return {
    get cols() {
      return term.cols;
    },
    get rows() {
      return term.rows;
    },
    open(parent) {
      term.open(parent);
      term.textarea?.setAttribute('aria-label', terminalStrings.shellInputAria);
    },
    fit(parent) {
      fit(parent);
    },
    write(data) {
      term.write(data);
    },
    resize(cols, rows) {
      term.resize(cols, rows);
    },
    refreshTheme(source) {
      const background = readToken(source, '--term');
      const foreground = readToken(source, '--text');
      const selection = readToken(source, '--sel');
      const fontFamily = readToken(source, '--font-mono');
      term.options.theme = {
        ...(background ? { background } : {}),
        ...(foreground ? { foreground, cursor: foreground } : {}),
        ...(selection ? { selectionBackground: selection } : {}),
      };
      if (fontFamily) term.options.fontFamily = FONT_FAMILY;
    },
    onData(listener) {
      const subscription = term.onData((data) => listener(data));
      return () => subscription.dispose();
    },
    onResize(listener) {
      const subscription = term.onResize((size) => listener(size));
      return () => subscription.dispose();
    },
    dispose() {
      term.dispose();
    },
  };
}
