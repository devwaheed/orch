/**
 * Terminal controller (S2-06): opens a shell per tab, routes output and input, and
 * keeps the dock's tab state in step with shell.exited (stopped and restart).
 * The shell service and the terminal are fakes, so no shell or DOM is needed.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ShellId, type OrchEvent, type Result } from '@orch/contracts';
import { EMPTY_TERMINAL_TABS } from '../src/browser/parts/terminal/terminalTabs.js';
import { useTerminalStore } from '../src/browser/parts/terminal/terminalStore.js';
import {
  TerminalController,
  type TermLike,
  type TerminalShells,
} from '../src/browser/parts/terminal/terminalController.js';

interface OpenCall {
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
  readonly resolve: (result: Result<ShellId>) => void;
}

/** Shell service fake: `open` waits until the test resolves it. */
class FakeShells implements TerminalShells {
  readonly opens: OpenCall[] = [];
  readonly writes: Array<[string, string]> = [];
  readonly resizes: Array<[string, number, number]> = [];
  readonly closes: string[] = [];

  open(cwd: string, cols: number, rows: number): Promise<Result<ShellId>> {
    return new Promise((resolve) => this.opens.push({ cwd, cols, rows, resolve }));
  }
  async write(shellId: ShellId, data: string): Promise<Result<void>> {
    this.writes.push([shellId, data]);
    return { ok: true, value: undefined };
  }
  async resize(shellId: ShellId, cols: number, rows: number): Promise<Result<void>> {
    this.resizes.push([shellId, cols, rows]);
    return { ok: true, value: undefined };
  }
  async close(shellId: ShellId): Promise<Result<void>> {
    this.closes.push(shellId);
    return { ok: true, value: undefined };
  }
}

/** Terminal fake: records what it was given and lets the test type and resize. */
class FakeTerm implements TermLike {
  cols = 80;
  rows = 24;
  readonly written: string[] = [];
  disposed = false;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly resizeListeners = new Set<(size: { cols: number; rows: number }) => void>();

  open(): void {}
  fit(): void {}
  refreshTheme(): void {}
  write(data: string): void {
    this.written.push(data);
  }
  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    for (const listener of this.resizeListeners) listener({ cols, rows });
  }
  onData(listener: (data: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }
  onResize(listener: (size: { cols: number; rows: number }) => void): () => void {
    this.resizeListeners.add(listener);
    return () => this.resizeListeners.delete(listener);
  }
  dispose(): void {
    this.disposed = true;
  }
  type(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }
}

const sh = (id: string) => ShellId.parse(id);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let shells: FakeShells;
let terms: FakeTerm[];
let projectFolder: string;
let lastClosed: number;
let controller: TerminalController;

function build(): void {
  shells = new FakeShells();
  terms = [];
  projectFolder = '/Users/me/code/api-server';
  lastClosed = 0;
  controller = new TerminalController({
    shells,
    createTerminal: () => {
      const term = new FakeTerm();
      terms.push(term);
      return term;
    },
    projectFolder: () => projectFolder,
    onLastTabClosed: () => {
      lastClosed += 1;
    },
  });
}

function tabState(key: string) {
  return useTerminalStore.getState().tabs.find((tab) => tab.key === key);
}

beforeEach(() => {
  useTerminalStore.setState(EMPTY_TERMINAL_TABS);
  build();
});

describe('opening shells', () => {
  it('opens a shell in the project folder at the terminal size and shows it running', async () => {
    const key = controller.openTab();
    expect(tabState(key)).toMatchObject({ cwd: projectFolder, label: 'api-server', status: 'opening' });
    expect(shells.opens[0]).toMatchObject({ cwd: projectFolder, cols: 80, rows: 24 });

    shells.opens[0]?.resolve({ ok: true, value: sh('sh-1') });
    await flush();
    expect(tabState(key)).toMatchObject({ status: 'running', shellId: 'sh-1' });
  });

  it('a folder that is not open fails the tab without asking the core', () => {
    projectFolder = '';
    const key = controller.openTab();
    expect(shells.opens).toHaveLength(0);
    expect(tabState(key)?.status).toBe('failed');
  });

  it('a failed open marks the tab failed', async () => {
    const key = controller.openTab();
    shells.opens[0]?.resolve({ ok: false, error: { code: 'internal', message: 'Could not open a shell.', fix: 'Check.' } });
    await flush();
    expect(tabState(key)?.status).toBe('failed');
  });

  it('a shell that finishes opening after its tab closed is closed again', async () => {
    const key = controller.openTab();
    controller.closeTab(key);
    shells.opens[0]?.resolve({ ok: true, value: sh('sh-9') });
    await flush();
    expect(shells.closes).toEqual(['sh-9']);
  });
});

describe('output and input', () => {
  it('writes shell output into the tab terminal', async () => {
    const key = controller.openTab();
    shells.opens[0]?.resolve({ ok: true, value: sh('sh-1') });
    await flush();
    controller.handleEvent({ type: 'shell.output', shellId: sh('sh-1'), data: 'hello\r\n' });
    expect(terms[0]?.written).toEqual(['hello\r\n']);
    expect(tabState(key)?.status).toBe('running');
  });

  it('keeps output that arrives before the open reply and writes it once the tab knows the shell', async () => {
    controller.openTab();
    controller.handleEvent({ type: 'shell.output', shellId: sh('sh-1'), data: 'prompt ' });
    expect(terms[0]?.written).toEqual([]);

    shells.opens[0]?.resolve({ ok: true, value: sh('sh-1') });
    await flush();
    expect(terms[0]?.written).toEqual(['prompt ']);
  });

  it('sends typed input to the tab shell and resizes the shell when the terminal resizes', async () => {
    controller.openTab();
    shells.opens[0]?.resolve({ ok: true, value: sh('sh-1') });
    await flush();
    terms[0]?.type('ls\r');
    terms[0]?.resize(100, 30);
    expect(shells.writes).toEqual([['sh-1', 'ls\r']]);
    expect(shells.resizes).toEqual([['sh-1', 100, 30]]);
  });

  it('ignores output for shells the dock does not show', () => {
    controller.handleEvent({ type: 'shell.output', shellId: sh('sh-7'), data: 'x' });
    expect(terms).toHaveLength(0);
  });

  it('ignores events that are not shell events', () => {
    const other: OrchEvent = { type: 'config.changed', source: 'file' };
    expect(() => controller.handleEvent(other)).not.toThrow();
  });
});

describe('stopped and restart', () => {
  it('shell.exited with code null shows the tab as stopped, and Restart opens a new shell in the same folder', async () => {
    const key = controller.openTab();
    shells.opens[0]?.resolve({ ok: true, value: sh('sh-1') });
    await flush();

    controller.handleEvent({ type: 'shell.exited', shellId: sh('sh-1'), code: null });
    expect(tabState(key)).toMatchObject({ status: 'stopped', shellId: null });

    controller.restartTab(key);
    expect(tabState(key)?.status).toBe('opening');
    expect(shells.opens[1]).toMatchObject({ cwd: projectFolder });

    shells.opens[1]?.resolve({ ok: true, value: sh('sh-2') });
    await flush();
    expect(tabState(key)).toMatchObject({ status: 'running', shellId: 'sh-2' });
    expect(terms).toHaveLength(1);
  });

  it('a numeric exit code does not offer restart', async () => {
    const key = controller.openTab();
    shells.opens[0]?.resolve({ ok: true, value: sh('sh-1') });
    await flush();
    controller.handleEvent({ type: 'shell.exited', shellId: sh('sh-1'), code: 0 });
    controller.restartTab(key);
    expect(shells.opens).toHaveLength(1);
    expect(tabState(key)?.status).toBe('exited');
  });

  it('restart does nothing on a running tab', async () => {
    const key = controller.openTab();
    shells.opens[0]?.resolve({ ok: true, value: sh('sh-1') });
    await flush();
    controller.restartTab(key);
    expect(shells.opens).toHaveLength(1);
  });
});

describe('closing tabs', () => {
  it('closes the shell, disposes the terminal, and hides the dock after the last tab', async () => {
    const first = controller.openTab();
    const second = controller.openTab();
    shells.opens[0]?.resolve({ ok: true, value: sh('sh-1') });
    shells.opens[1]?.resolve({ ok: true, value: sh('sh-2') });
    await flush();

    controller.closeTab(first);
    expect(shells.closes).toEqual(['sh-1']);
    expect(terms[0]?.disposed).toBe(true);
    expect(lastClosed).toBe(0);

    controller.closeTab(second);
    expect(lastClosed).toBe(1);
    expect(useTerminalStore.getState()).toEqual({ tabs: [], activeKey: null });
  });

  it('closing a stopped tab does not try to close a shell that is already gone', async () => {
    const key = controller.openTab();
    shells.opens[0]?.resolve({ ok: true, value: sh('sh-1') });
    await flush();
    controller.handleEvent({ type: 'shell.exited', shellId: sh('sh-1'), code: null });
    controller.closeTab(key);
    expect(shells.closes).toEqual([]);
  });

  it('selects tabs', () => {
    const first = controller.openTab();
    controller.openTab();
    controller.selectTab(first);
    expect(useTerminalStore.getState().activeKey).toBe(first);
  });
});
