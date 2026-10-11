/**
 * Shells: the core-side protocol (ShellsServiceImpl) talking to the PTY host
 * (PtyHost) over an in-memory port pair, plus real shells via node-pty.
 *
 * The real-shell tests spawn /bin/sh in a temp folder on macOS and Linux. They
 * are skipped on Windows only, because ConPTY is not exercised by this suite yet.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ShellsServiceImpl } from '../src/shells/node/shellsService.js';
import { PtyHost, ensureSpawnHelperExecutable } from '../src/shells/node/ptyHost.js';
import type { ShellPort, ShellRequest, ShellReply } from '../src/shells/common/shells.js';
import type { OrchEvent, ShellId } from '@orch/contracts';

function createPortPair(): [ShellPort, ShellPort] {
  const listeners1 = new Map<string, Set<(msg: unknown) => void>>();
  const listeners2 = new Map<string, Set<(msg: unknown) => void>>();

  const port1: ShellPort = {
    postMessage: (msg) => {
      listeners2.get('message')?.forEach((fn) => fn(msg));
    },
    on: (event, listener) => {
      if (!listeners1.has(event)) listeners1.set(event, new Set());
      listeners1.get(event)!.add(listener);
    },
    close: () => {},
  };

  const port2: ShellPort = {
    postMessage: (msg) => {
      listeners1.get('message')?.forEach((fn) => fn(msg));
    },
    on: (event, listener) => {
      if (!listeners2.has(event)) listeners2.set(event, new Set());
      listeners2.get(event)!.add(listener);
    },
    close: () => {},
  };

  return [port1, port2];
}

function baseEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for shell output');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function setup(): { service: ShellsServiceImpl; host: PtyHost } {
  const [servicePort, hostPort] = createPortPair();
  const service = new ShellsServiceImpl(servicePort);
  const host = new PtyHost(hostPort, {
    defaultShell: '/bin/sh',
    defaultShellArgs: [],
    baseEnv: baseEnv(),
  });
  cleanups.push(() => {
    service.dispose();
    host.dispose();
  });
  return { service, host };
}

describe('shells protocol (no shell spawned)', () => {
  it('replies not_found for write, resize and close on an unknown shell', async () => {
    const { service, host } = setup();
    await host.ready;
    const fakeId = 'sh-ffffffff' as ShellId;

    const write = await service.write(fakeId, 'echo hello\n');
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.error.code).toBe('not_found');

    const resize = await service.resize(fakeId, 120, 30);
    expect(resize.ok).toBe(false);
    if (!resize.ok) expect(resize.error.code).toBe('not_found');

    const close = await service.close(fakeId);
    expect(close.ok).toBe(false);
    if (!close.ok) expect(close.error.code).toBe('not_found');
  });

  it('replies validation_failed for an unknown operation', async () => {
    const [port1, port2] = createPortPair();
    const host = new PtyHost(port2, { defaultShell: '/bin/sh', defaultShellArgs: [], baseEnv: {} });
    cleanups.push(() => host.dispose());
    await host.ready;

    const reply = new Promise<ShellReply>((resolve) => {
      port1.on('message', (msg) => {
        const r = msg as ShellReply;
        if (r.id === 1) resolve(r);
      });
    });
    port1.postMessage({ id: 1, op: 'unknown', payload: {} } as unknown as ShellRequest);

    const r = await reply;
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('validation_failed');
  });
});

describe.skipIf(process.platform === 'win32')('real shells (macOS and Linux)', () => {
  it('the node-pty spawn helper check passes', () => {
    const check = ensureSpawnHelperExecutable();
    expect(check.ok).toBe(true);
  });

  it('opens a shell in a temp folder, runs a command, and closes it', async () => {
    const { service } = setup();
    const cwd = mkdtempSync(path.join(tmpdir(), 'orch-shell-'));
    cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));

    const output: string[] = [];
    service.onEvent((event: OrchEvent) => {
      if (event.type === 'shell.output') output.push(event.data);
    });

    const opened = await service.open(cwd, 80, 24);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    // $((1+2)) is evaluated by the shell, so "hi-3" can only come from running the command.
    const written = await service.write(opened.value, 'echo hi-$((1+2))\r');
    expect(written.ok).toBe(true);

    await waitFor(() => output.join('').includes('hi-3'), 10_000);

    const closed = await service.close(opened.value);
    expect(closed.ok).toBe(true);
 }, 30_000);

  it('reports live shells as exited when the PTY host goes away', async () => {
    const { service } = setup();
    const cwd = mkdtempSync(path.join(tmpdir(), 'orch-shell-'));
    cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));

    const exited: Array<{ shellId: string; code: number | null }> = [];
    service.onEvent((event: OrchEvent) => {
      if (event.type === 'shell.exited') exited.push({ shellId: event.shellId, code: event.code });
    });

    const opened = await service.open(cwd, 80, 24);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    service.onPtyHostClose();

    expect(exited).toEqual([{ shellId: opened.value, code: null }]);
    const after = await service.write(opened.value, 'echo late\r');
    expect(after.ok).toBe(false);
  });
});
