/**
 * xterm.js behind the TermLike interface (ARC-05, pinned in packages/workbench/package.json).
 * The only file in the dock that imports xterm. Colours and the font come from the
 * design tokens on the element, so light and dark themes follow the window.
 */
import { Terminal, type ILink } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { terminalStrings } from './strings.js';
import type { TermLike } from './terminalController.js';
import { terminalSize } from './terminalTabs.js';

/** Dock body text: 12px IBM Plex Mono at line height 1.6 (design/prototype/Main.dc.html, terminal dock). */
const FONT_SIZE = 12;
const LINE_HEIGHT = 1.6;
/** An agent's own sign-in in the Add account dialog: Antigravity's 25-line sign-in and code prompt must fit. */
const COMPACT = { fontSize: 11, lineHeight: 1.2 } as const;
// The full --font-mono stack, so glyphs Plex doesn't serve (✓) fall back like the design's terminal.
const FONT_FAMILY = "'IBM Plex Mono', Consolas, ui-monospace, monospace";

function readToken(source: HTMLElement, name: string): string {
  return getComputedStyle(source).getPropertyValue(name).trim();
}

/** Opens http/https URLs in the default browser through Electron's safe path. */
function openSafeUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (typeof window !== 'undefined' && window.orch?.app.openExternal) {
        void window.orch.app.openExternal(parsed.href);
      } else if (typeof window !== 'undefined') {
        window.open(parsed.href, '_blank', 'noopener,noreferrer');
      }
    }
  } catch {
    // Ignore invalid URLs
  }
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
    linkHandler: {
      activate(_event, text) {
        openSafeUrl(text);
      },
    },
  });
  // ponytail: xterm 6.0.0's built-in DECRQM handler throws ("s is not defined", a const enum lost in its
  // build) and the terminal then stops drawing; Antigravity sends DECRQM at start. Leaving the query
  // unanswered is what a terminal without DECRQM does. Drop these two lines after an xterm release fixes it.
  term.parser.registerCsiHandler({ intermediates: '$', final: 'p' }, () => true);
  term.parser.registerCsiHandler({ prefix: '?', intermediates: '$', final: 'p' }, () => true);

  // Link provider for plain URLs (http/https) in terminal output.
  term.registerLinkProvider({
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
      const line = term.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }

      let startY = bufferLineNumber;
      while (startY > 1) {
        const cur = term.buffer.active.getLine(startY - 1);
        if (cur?.isWrapped) startY--;
        else break;
      }
      let endY = bufferLineNumber;
      while (endY < term.buffer.active.length) {
        const next = term.buffer.active.getLine(endY);
        if (next?.isWrapped) endY++;
        else break;
      }

      let fullText = '';
      const lineOffsets: number[] = [];
      for (let y = startY; y <= endY; y++) {
        const l = term.buffer.active.getLine(y - 1);
        lineOffsets.push(fullText.length);
        fullText += l?.translateToString(y === endY) ?? '';
      }

      const urlRegex = /https?:\/\/[^\s"'`<>]+[^\s"'`<>\.,:;!?\(\)\[\]{}]/g;
      const links: ILink[] = [];
      let match: RegExpExecArray | null;

      while ((match = urlRegex.exec(fullText)) !== null) {
        const matchStart = match.index;
        const matchEnd = match.index + match[0].length;

        let linkStartY = startY;
        let linkStartX = 1;
        let linkEndY = endY;
        let linkEndX = 1;

        for (let i = 0; i < lineOffsets.length; i++) {
          const y = startY + i;
          const offset = lineOffsets[i] ?? 0;
          const nextOffset = lineOffsets[i + 1] ?? fullText.length;
          if (matchStart >= offset && matchStart < nextOffset) {
            linkStartY = y;
            linkStartX = matchStart - offset + 1;
          }
          if (matchEnd > offset && matchEnd <= nextOffset) {
            linkEndY = y;
            linkEndX = matchEnd - offset;
          }
        }

        if (bufferLineNumber >= linkStartY && bufferLineNumber <= linkEndY) {
          const uri = match[0];
          links.push({
            text: uri,
            range: {
              start: { x: linkStartX, y: linkStartY },
              end: { x: linkEndX, y: linkEndY },
            },
            activate(_event, text) {
              openSafeUrl(text);
            },
          });
        }
      }

      callback(links.length > 0 ? links : undefined);
    },
  });

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
    const cell = measureCell(fontFamily || 'monospace', fontSize, lineHeight);
    const rowEl = term.element?.querySelector('.xterm-rows > div') as HTMLElement | null;
    const screen = term.element?.querySelector('.xterm-screen');
    const cellWidth = screen && term.cols > 0 && screen.clientWidth > 0 ? screen.clientWidth / term.cols : cell.width;
    const cellHeight = rowEl && rowEl.offsetHeight > 0 ? rowEl.offsetHeight : cell.height;

    const { cols, rows } = terminalSize(parent.clientWidth, parent.clientHeight, { width: cellWidth, height: cellHeight });
    if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows);

    // xterm's row height comes from the font's real line box, which can be taller than the estimate:
    // drop the rows that would be cut off at the bottom.
    const updatedScreen = term.element?.querySelector('.xterm-screen');
    if (updatedScreen && term.rows > 1 && updatedScreen.clientHeight > parent.clientHeight) {
      const rowHeight = updatedScreen.clientHeight / term.rows;
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
