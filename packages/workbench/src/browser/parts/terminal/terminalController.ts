/**
 * Owns the dock's shells (S2-06): opens a shell per tab through the shells service,
 * routes shell.output into the right terminal, writes typed input and resizes back,
 * and keeps the tab state in step with shell.exited.
 *
 * The terminal itself (xterm.js) is created by a factory passed in, so this file
 * has no DOM or xterm import and its logic is tested with a fake terminal.
 */
import type { IShellService, OrchEvent, ShellId } from '@orchagents/contracts';
import { useTerminalStore } from './terminalStore.js';
import {
  addTab,
  closeTab,
  folderName,
  markOpenFailed,
  markOpened,
  markRestarting,
  selectTab,
  shellExited,
  canRestart,
  tabKeyForShell,
  type TerminalTab,
} from './terminalTabs.js';

/** The part of xterm.js the controller uses. The xterm adapter implements it. */
export interface TermLike {
  readonly cols: number;
  readonly rows: number;
  /** Attaches the terminal to an element. Called once per terminal. */
  open(parent: HTMLElement): void;
  /** Measures the element and resizes the terminal to fill it. */
  fit(parent: HTMLElement): void;
  /** Moves keyboard focus into the terminal input. */
  focus(): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Re-reads colours and font from the design tokens on the element. */
  refreshTheme(source: HTMLElement): void;
  onData(listener: (data: string) => void): () => void;
  onResize(listener: (size: { cols: number; rows: number }) => void): () => void;
  dispose(): void;
}

export type TerminalShells = Pick<IShellService, 'open' | 'write' | 'resize' | 'close'>;

interface Session {
  readonly term: TermLike;
  readonly unsubscribes: Array<() => void>;
  host: HTMLElement | null;
  observer: { disconnect(): void } | null;
}

export interface TerminalControllerOptions {
  readonly shells: TerminalShells;
  /** compact: the smaller font an agent's own sign-in uses (attachShell). */
  readonly createTerminal: (compact?: boolean) => TermLike;
  /** The folder new shells start in: the project folder. Empty when none is open. */
  readonly projectFolder: () => string;
  /** Called after the last tab closes, so the dock can hide. */
  readonly onLastTabClosed: () => void;
}

export class TerminalController {
  private readonly sessions = new Map<string, Session>();
  /** Output that arrived before the open reply named its shell. Flushed when it does. */
  private readonly pendingOutput = new Map<ShellId, string[]>();
  /** Typed input for a tab whose shell is still opening. Flushed when the shell is known. */
  private readonly pendingInput = new Map<string, string>();
  /** Exits of shells no tab or view holds yet (a sign-in that ends before its view attaches). */
  private readonly pendingExit = new Map<ShellId, number | null>();
  /** Shells started elsewhere (an agent's sign-in) and shown outside the dock. */
  private readonly views = new Map<ShellId, { readonly term: TermLike; readonly onExit: (code: number | null) => void }>();
  private nextKey = 1;

  constructor(private readonly options: TerminalControllerOptions) {}

  /** Adds a tab and opens a shell in `cwd` (the project folder by default). Returns the tab key. */
  openTab(cwd: string = this.options.projectFolder(), label: string = folderName(cwd)): string {
    const key = `term-${this.nextKey}`;
    this.nextKey += 1;
    const term = this.options.createTerminal();
    this.sessions.set(key, { term, unsubscribes: [this.bindTerminal(key, term)], host: null, observer: null });
    useTerminalStore.setState((state) => addTab(state, { key, cwd, label }));
    if (cwd === '') {
      useTerminalStore.setState((state) => markOpenFailed(state, key));
    } else {
      void this.start(key);
    }
    return key;
  }

  selectTab(key: string): void {
    useTerminalStore.setState((state) => selectTab(state, key));
  }

  /**
   * Writes typed input (no newline) to the active tab's shell, opening a tab in the project
   * folder when the dock has none. Input for a shell that is still opening is queued and
   * flushed once the shell is known. Returns an undo that types one DEL per character.
   */
  insertIntoActiveTab(text: string): (() => void) | null {
    const state = useTerminalStore.getState();
    const activeKey = state.activeKey;
    const key =
      activeKey && state.tabs.some((tab) => tab.key === activeKey)
        ? activeKey
        : state.tabs[0]?.key ?? this.openTab();
    this.writeTypedInput(key, text);
    return () => this.writeTypedInput(key, '\x7f'.repeat(text.length));
  }

  /** Restart on a stopped tab: opens a new shell in the same folder. Other tabs are left alone. */
  restartTab(key: string): void {
    const tab = findTab(key);
    if (!tab || !canRestart(tab)) return;
    useTerminalStore.setState((state) => markRestarting(state, key));
    void this.start(key);
  }

  /** Closes a tab: closes its shell (if it has one), disposes its terminal, and hides the dock after the last tab. */
  closeTab(key: string): void {
    const tab = findTab(key);
    if (!tab) return;
    if (tab.shellId) void this.options.shells.close(tab.shellId);
    this.pendingInput.delete(key);
    const session = this.sessions.get(key);
    if (session) this.disposeSession(session);
    this.sessions.delete(key);
    useTerminalStore.setState((state) => closeTab(state, key));
    if (useTerminalStore.getState().tabs.length === 0) this.options.onLastTabClosed();
  }

  /**
   * Shows a tab's terminal inside an element. The first call opens xterm in it; every
   * later size change refits it. Returns a function that stops watching the element.
   */
  attach(key: string, host: HTMLElement): () => void {
    const session = this.sessions.get(key);
    if (!session) return () => undefined;
    if (!session.host) {
      session.term.open(host);
      session.host = host;
      session.term.refreshTheme(host);
    }
    session.term.fit(host);
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => session.term.fit(host));
      observer.observe(host);
      session.observer = observer;
    }
    return () => {
      session.observer?.disconnect();
      session.observer = null;
    };
  }

  /**
   * Shows a shell that was started elsewhere (an agent's own sign-in) in `host`, outside the
   * dock: its output, typing and size go to that shell. onExit runs once when it ends.
   * Returns a function that disposes the view (the shell itself is not closed).
   */
  attachShell(shellId: ShellId, host: HTMLElement, onExit: (code: number | null) => void): () => void {
    const term = this.options.createTerminal(true);
    term.open(host);
    term.refreshTheme(host);
    term.fit(host);
    void this.options.shells.resize(shellId, term.cols, term.rows);
    const offData = term.onData((data) => void this.options.shells.write(shellId, data));
    const offResize = term.onResize(({ cols, rows }) => void this.options.shells.resize(shellId, cols, rows));
    // The dialog may grow after it opens (e.g. the sign-in view appears): refit when the host resizes.
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        term.fit(host);
        void this.options.shells.resize(shellId, term.cols, term.rows);
      });
      observer.observe(host);
    }
    this.views.set(shellId, { term, onExit });
    for (const data of this.pendingOutput.get(shellId) ?? []) term.write(data);
    this.pendingOutput.delete(shellId);
    if (this.pendingExit.has(shellId)) {
      const code = this.pendingExit.get(shellId) ?? null;
      this.pendingExit.delete(shellId);
      this.views.delete(shellId);
      onExit(code);
    }
    term.focus();
    return () => {
      observer?.disconnect();
      this.views.delete(shellId);
      offData();
      offResize();
      term.dispose();
    };
  }

  /** Re-reads the design tokens into every open terminal (light and dark theme). */
  refreshThemes(): void {
    for (const session of this.sessions.values()) {
      if (session.host) session.term.refreshTheme(session.host);
    }
  }

  /** Routes shell events from the events channel. Other events are ignored. */
  handleEvent(event: OrchEvent): void {
    const view = event.type === 'shell.output' || event.type === 'shell.exited' ? this.views.get(event.shellId) : undefined;
    if (view) {
      if (event.type === 'shell.output') view.term.write(event.data);
      else if (event.type === 'shell.exited') {
        this.views.delete(event.shellId);
        view.onExit(event.code);
      }
      return;
    }
    if (event.type === 'shell.output') {
      const key = tabKeyForShell(useTerminalStore.getState(), event.shellId);
      const session = key ? this.sessions.get(key) : undefined;
      if (session) {
        session.term.write(event.data);
      } else {
        const queued = this.pendingOutput.get(event.shellId) ?? [];
        this.pendingOutput.set(event.shellId, [...queued, event.data]);
      }
    } else if (event.type === 'shell.exited') {
      if (tabKeyForShell(useTerminalStore.getState(), event.shellId) === null) {
        // ponytail: kept until a view claims it; a few bytes per unclaimed shell.
        this.pendingExit.set(event.shellId, event.code);
      } else {
        this.pendingOutput.delete(event.shellId);
      }
      useTerminalStore.setState((state) => shellExited(state, event.shellId, event.code));
    }
  }

  dispose(): void {
    for (const session of this.sessions.values()) this.disposeSession(session);
    this.sessions.clear();
    this.pendingOutput.clear();
    this.pendingInput.clear();
    this.pendingExit.clear();
    for (const view of this.views.values()) view.term.dispose();
    this.views.clear();
  }

  private async start(key: string): Promise<void> {
    const session = this.sessions.get(key);
    const tab = findTab(key);
    if (!session || !tab) return;
    const result = await this.options.shells.open(tab.cwd, session.term.cols, session.term.rows);

    // The tab was closed while the shell was opening: close the shell we just got.
    if (!this.sessions.has(key)) {
      if (result.ok) void this.options.shells.close(result.value);
      return;
    }
    if (!result.ok) {
      this.pendingInput.delete(key);
      useTerminalStore.setState((state) => markOpenFailed(state, key));
      return;
    }
    const shellId = result.value;
    useTerminalStore.setState((state) => markOpened(state, key, shellId));
    const queuedInput = this.pendingInput.get(key);
    this.pendingInput.delete(key);
    if (queuedInput) void this.options.shells.write(shellId, queuedInput);
    const queued = this.pendingOutput.get(shellId);
    this.pendingOutput.delete(shellId);
    for (const data of queued ?? []) session.term.write(data);
  }

  private writeTypedInput(key: string, data: string): void {
    const tab = findTab(key);
    if (!tab) return;
    if (tab.shellId) {
      void this.options.shells.write(tab.shellId, data);
      return;
    }
    this.pendingInput.set(key, (this.pendingInput.get(key) ?? '') + data);
  }

  private bindTerminal(key: string, term: TermLike): () => void {
    const offData = term.onData((data) => {
      const shellId = findTab(key)?.shellId;
      if (shellId) void this.options.shells.write(shellId, data);
    });
    const offResize = term.onResize(({ cols, rows }) => {
      const shellId = findTab(key)?.shellId;
      if (shellId) void this.options.shells.resize(shellId, cols, rows);
    });
    return () => {
      offData();
      offResize();
    };
  }

  private disposeSession(session: Session): void {
    session.observer?.disconnect();
    session.observer = null;
    for (const unsubscribe of session.unsubscribes) unsubscribe();
    session.unsubscribes.length = 0;
    session.term.dispose();
  }
}

function findTab(key: string): TerminalTab | undefined {
  return useTerminalStore.getState().tabs.find((tab) => tab.key === key);
}
