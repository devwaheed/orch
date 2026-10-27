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
/** An agent's own sign-in in the Add account dialog: Antigravity's 25-line sign-in and code prompt must fit. */
const COMPACT = { fontSize: 11, lineHeight: 1.3 } as const;
// The full --font-mono stack, so glyphs Plex doesn't serve (✓) fall back like the design's terminal.
const FONT_FAMILY = "'IBM Plex Mono', Consolas, ui-monospace, monospace";

function readToken(source: HTMLElement, name: string): string {
  return getComputedStyle(source).getPropertyValue(name).trim();
}

/** One monospace cell in CSS pixels, measured with the same font as the terminal. xterm draws rows at whole pixels, so the height rounds up. */
function measureCell(fontFamily: string, fontSize: number, lineHeight: number): { width: number; height: number } {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return { width: fontSize * 0.6, height: Math.ceil(fontSize * lineHeight) };
  context.font = `${fontSize}px ${fontFamily.includes('IBM Plex Mono') ? FONT_FAMILY : fontFamily}`;
  const sample = '0'.repeat(10);
  return { width: context.measureText(sample).width / sample.length, height: Math.ceil(fontSize * lineHeight) };
}

export function createXterm(compact = false): TermLike {
  const { fontSize, lineHeight } = compact ? COMPACT : { fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT };
  const term = new Terminal({
    fontSize,
    lineHeight,
    fontFamily: FONT_FAMILY,
    letterSpacing: 0,
  });
  // ponytail: xterm 6.0.0's built-in DECRQM handler throws ("s is not defined", a const enum lost in its
  // build) and the terminal then stops drawing; Antigravity sends DECRQM at start. Leaving the query
  // unanswered is what a terminal without DECRQM does. Drop these two lines after an xterm release fixes it.
  term.parser.registerCsiHandler({ intermediates: '$', final: 'p' }, () => true);
  term.parser.registerCsiHandler({ prefix: '?', intermediates: '$', final: 'p' }, () => true);
  const fit = (parent: HTMLElement) => {
    // A hidden tab has no size yet; its ResizeObserver refits it when it is shown.
    if (parent.clientWidth === 0 || parent.clientHeight === 0) return;
    if (!document.fonts.check(`${fontSize}px 'IBM Plex Mono'`)) {
      void document.fonts.load(`${fontSize}px 'IBM Plex Mono'`).then(() => {
        if (parent.isConnected && parent.clientWidth > 0 && parent.clientHeight > 0) fit(parent);
      });
      return;
    }
    const fontFamily = readToken(parent, '--font-mono');
    const { cols, rows } = terminalSize(parent.clientWidth, parent.clientHeight, measureCell(fontFamily || 'monospace', fontSize, lineHeight));
    if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows);
    // xterm's row height comes from the font's real line box, which can be taller than the estimate:
    // drop the rows that would be cut off at the bottom.
    const screen = term.element?.querySelector('.xterm-screen');
    if (screen && term.rows > 1 && screen.clientHeight > parent.clientHeight) {
      const rowHeight = screen.clientHeight / term.rows;
      term.resize(term.cols, Math.max(1, Math.floor(parent.clientHeight / rowHeight)));
    }
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
    focus() {
      term.focus();
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
      // ANSI colours follow the design tokens too, so shell output reads the same in both themes.
      const ansi = { green: '--ok', red: '--err', yellow: '--warn', blue: '--info', magenta: '--spawn', cyan: '--info-tool' } as const;
      const colours = Object.fromEntries(
        Object.entries(ansi).flatMap(([name, token]) => {
          const value = readToken(source, token);
          return value ? [[name, value]] : [];
        }),
      );
      term.options.theme = {
        ...(background ? { background } : {}),
        ...(foreground ? { foreground, cursor: foreground } : {}),
        ...(selection ? { selectionBackground: selection } : {}),
        ...colours,
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
