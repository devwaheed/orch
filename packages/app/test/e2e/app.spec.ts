/**
 * Playwright-Electron checks for S2-01 / S5-01. Runs the unpacked packaged app
 * from `electron-builder --dir`. Each test gets its own HOME, so the real
 * ~/.orch is never touched.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const appRoot = fileURLToPath(new URL('../..', import.meta.url));

function getUnpackedExecutable(): string {
  const releaseDirs = [
    resolve(appRoot, 'dist/release'),
    resolve(appRoot, 'release'),
  ];
  for (const releaseDir of releaseDirs) {
    if (process.platform === 'darwin') {
      for (const dir of ['mac-arm64', 'mac-x64', 'mac-universal', 'mac']) {
        const candidate = join(releaseDir, dir, 'orch.app/Contents/MacOS/orch');
        if (existsSync(candidate)) return candidate;
      }
    } else if (process.platform === 'win32') {
      const candidate = join(releaseDir, 'win-unpacked', 'orch.exe');
      if (existsSync(candidate)) return candidate;
    } else {
      const candidate = join(releaseDir, 'linux-unpacked', 'orch');
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`Unpacked app executable not found in dist/release or release. Run pnpm --filter @orchagents/app dist:dir first.`);
}

async function launch(home: string, args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): Promise<ElectronApplication> {
  const executablePath = getUnpackedExecutable();
  return electron.launch({
    executablePath,
    args,
    env: { ...process.env, HOME: home, USERPROFILE: home, ...extraEnv },
  });
}

test('application menu offers CLI install and Help report problem', async () => {
  test.skip(process.platform === 'win32', 'CLI installation is offered only on macOS and Linux AppImage');
  const home = mkdtempSync(join(tmpdir(), 'orch-e2e-menu-'));
  const app = await launch(home, [], process.platform === 'darwin' ? {} : { APPIMAGE: join(home, 'orch.AppImage') });
  try {
    const labels = await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      return menu?.items.map((item) => ({ label: item.label, children: item.submenu?.items.map((child) => child.label) }));
    });
    const allLabels = labels?.flatMap((item) => [item.label, ...(item.children ?? [])]);
    expect(allLabels).toContain('Install orch command');
    expect(allLabels).toContain('Report a problem…');
  } finally {
    await closeApp(app);
  }
});

type Metric = { pid: number; type: string; name?: string };

async function hostMetrics(app: ElectronApplication): Promise<Metric[]> {
  const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics());
  return metrics.filter((m) => m.type === 'Utility' && m.name?.startsWith('orch-'));
}

async function closeApp(app: ElectronApplication): Promise<void> {
  const proc = app.process();
  try {
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
  } catch {
    await app.close().catch(() => {});
  }
  if (proc.exitCode === null) {
    await new Promise<void>((resolve) => {
      proc.once('exit', () => resolve());
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
        resolve();
      }, 3000);
    });
  }
}

async function waitFor<T>(read: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for the condition');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
}

test('opens the window with the bridge and reaches the core host', async () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-e2e-'));
  const app = await launch(home);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    const bridgeKeys = await page.evaluate(() => Object.keys(globalThis as object).includes('orch'));
    expect(bridgeKeys).toBe(true);

    const reply = await page.evaluate(async () => {
      type Port = {
        postMessage(message: unknown): void;
        start(): void;
        onmessage: ((event: { data: unknown }) => void) | null;
      };
      const page = globalThis as unknown as {
        orch: { connect(): Promise<void> };
        addEventListener(type: 'message', listener: (event: { data: unknown; ports: readonly unknown[] }) => void): void;
      };
      // The core port arrives as a window message from the preload (window.orch.connect).
      const port = await new Promise<Port>((resolvePort, rejectPort) => {
        const timer = setTimeout(() => rejectPort(new Error('no core port')), 15_000);
        page.addEventListener('message', (event) => {
          if (event.data !== 'orch:port' || event.ports.length === 0) return;
          clearTimeout(timer);
          resolvePort(event.ports[0] as Port);
        });
        page.orch.connect().catch(rejectPort);
      });
      return new Promise<unknown>((resolveReply, rejectReply) => {
        const timer = setTimeout(() => rejectReply(new Error('no reply from the core host')), 15_000);
        port.onmessage = (event) => {
          clearTimeout(timer);
          resolveReply(event.data);
        };
        port.start();
        port.postMessage({ jsonrpc: '2.0', id: 1, method: 'accounts.listAgents', params: [] });
      });
    });
    expect(reply).toMatchObject({ jsonrpc: '2.0', id: 1 });
    expect(reply).toHaveProperty('result');
  } finally {
    await closeApp(app);
  }
});

test('a killed host is restarted', async () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-e2e-'));
  const app = await launch(home);
  try {
    await app.firstWindow();
    for (const name of ['orch-core', 'orch-engine']) {
      const current = await waitFor(async () => {
        const hosts = await hostMetrics(app);
        return hosts.find((h) => h.name === name);
      });
      expect(current, `${name} is running`).toBeDefined();
      const oldPid = current!.pid;
      process.kill(oldPid, 'SIGKILL');
      const restarted = await waitFor(async () => {
        const hosts = await hostMetrics(app);
        const again = hosts.find((h) => h.name === name);
        return again && again.pid !== oldPid ? again : undefined;
      });
      expect(restarted.pid).not.toBe(oldPid);
    }
  } finally {
    await closeApp(app);
  }
});

test('a second launch focuses the first window instead of opening another', async () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-e2e-'));
  const app = await launch(home);
  try {
    await app.firstWindow();
    const executablePath = getUnpackedExecutable();
    const second = spawn(executablePath, [], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: 'ignore',
    });
    const code = await new Promise<number | null>((resolveExit) => second.on('exit', (exitCode) => resolveExit(exitCode)));
    expect(code).toBe(0);

    const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    expect(windows).toBe(1);
  } finally {
    await closeApp(app);
  }
});

test('core reports the engine ready over the window port', async () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-e2e-'));
  const app = await launch(home);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    type DoctorReportType = {
      engineVersion: string;
      checks: Array<{ id: string; status: string; title: string }>;
    };

    const report = await page.evaluate(async () => {
      type Port = {
        postMessage(message: unknown): void;
        start(): void;
        onmessage: ((event: { data: unknown }) => void) | null;
      };
      const win = globalThis as unknown as {
        orch: { connect(): Promise<void> };
        addEventListener(type: 'message', listener: (event: { data: unknown; ports: readonly unknown[] }) => void): void;
      };
      const port = await new Promise<Port>((resolvePort, rejectPort) => {
        const timer = setTimeout(() => rejectPort(new Error('no core port')), 15_000);
        win.addEventListener('message', (event) => {
          if (event.data !== 'orch:port' || event.ports.length === 0) return;
          clearTimeout(timer);
          resolvePort(event.ports[0] as Port);
        });
        win.orch.connect().catch(rejectPort);
      });
      port.start();

      type JsonRpcReply = {
        jsonrpc: string;
        id: number;
        result?: {
          ok: boolean;
          value?: DoctorReportType;
        };
      };

      let id = 10;
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const reqId = id++;
        const reply = await new Promise<JsonRpcReply>((resolveReply, rejectReply) => {
          const timer = setTimeout(() => rejectReply(new Error('doctor.run timed out')), 5_000);
          port.onmessage = (event) => {
            const data = event.data as JsonRpcReply;
            if (data.id === reqId) {
              clearTimeout(timer);
              resolveReply(data);
            }
          };
          port.postMessage({ jsonrpc: '2.0', id: reqId, method: 'doctor.run', params: [] });
        });
        const rep = reply.result?.value;
        const engineCheck = rep?.checks?.find((c) => c.id === 'engine');
        if (engineCheck?.status === 'pass' && rep?.engineVersion) {
          return rep;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error('Engine was not reported ready in time');
    });

    expect(report.engineVersion).toBeTruthy();
    const engineCheck = report.checks.find((c) => c.id === 'engine');
    expect(engineCheck?.status).toBe('pass');
  } finally {
    await closeApp(app);
  }
});

test('the terminal opens a shell and echoes', async () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-e2e-'));
  const app = await launch(home);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    const output = await page.evaluate(async (homeDir) => {
      type Port = {
        postMessage(message: unknown): void;
        start(): void;
        onmessage: ((event: { data: unknown }) => void) | null;
      };
      const win = globalThis as unknown as {
        orch: { connect(): Promise<void> };
        addEventListener(type: 'message', listener: (event: { data: unknown; ports: readonly unknown[] }) => void): void;
      };
      const port = await new Promise<Port>((resolvePort, rejectPort) => {
        const timer = setTimeout(() => rejectPort(new Error('no core port')), 15_000);
        win.addEventListener('message', (event) => {
          if (event.data !== 'orch:port' || event.ports.length === 0) return;
          clearTimeout(timer);
          resolvePort(event.ports[0] as Port);
        });
        win.orch.connect().catch(rejectPort);
      });
      port.start();

      type JsonRpcMessage = {
        jsonrpc: string;
        id?: number;
        method?: string;
        params?: unknown[];
        result?: { ok: boolean; value?: unknown; error?: { message: string } };
      };

      const replies = new Map<number, (res: JsonRpcMessage) => void>();
      const shellChunks: string[] = [];

      port.onmessage = (event) => {
        const msg = event.data as JsonRpcMessage;
        if (msg.id !== undefined && replies.has(msg.id)) {
          const handler = replies.get(msg.id);
          replies.delete(msg.id);
          handler?.(msg);
        } else if (msg.method === 'events.event' && Array.isArray(msg.params)) {
          const ev = msg.params[0] as { type?: string; data?: string };
          if (ev?.type === 'shell.output' && typeof ev.data === 'string') {
            shellChunks.push(ev.data);
          }
        }
      };

      const call = (method: string, params: unknown[]): Promise<JsonRpcMessage> => {
        const id = Math.floor(Math.random() * 100000) + 1;
        return new Promise<JsonRpcMessage>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`call ${method} timed out`)), 15_000);
          replies.set(id, (msg) => {
            clearTimeout(timer);
            resolve(msg);
          });
          port.postMessage({ jsonrpc: '2.0', id, method, params });
        });
      };

      // 1. Subscribe to events
      await call('events.subscribe', []);

      // 2. Open a shell (with retry while PTY host starts up)
      let openReply: JsonRpcMessage | null = null;
      const deadlineOpen = Date.now() + 15_000;
      while (Date.now() < deadlineOpen) {
        openReply = await call('shells.open', [homeDir, 80, 24]);
        if (openReply.result?.ok && typeof openReply.result.value === 'string') {
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!openReply?.result?.ok || typeof openReply.result.value !== 'string') {
        throw new Error(`Failed to open shell: ${JSON.stringify(openReply?.result)}`);
      }
      const shellId = openReply.result.value;

      // 3. Write echo command
      await call('shells.write', [shellId, 'echo pty-echo-success\r']);

      // 4. Wait for echo output
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (shellChunks.join('').includes('pty-echo-success')) {
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      // 5. Close shell
      await call('shells.close', [shellId]);

      return shellChunks.join('');
    }, home);

    expect(output).toContain('pty-echo-success');
  } finally {
    await closeApp(app);
  }
});

test('orch <path> opens that repo in the title bar (CLI-04 b)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-e2e-'));
  const repo = join(home, 'code', 'checkout-svc');
  const app = await launch(home, ['--open-repo', repo]);
  try {
    const window = await app.firstWindow();
    await expect(window.getByRole('button', { name: /checkout-svc/ })).toContainText('checkout-svc', { timeout: 15_000 });
  } finally {
    await closeApp(app);
  }
});

test('the terminal keeps drawing after a DECRQM query (agy sends one; xterm 6.0.0 threw on it)', async () => {
  test.skip(process.platform === 'win32', 'printf with escapes is a POSIX shell check');
  const home = mkdtempSync(join(tmpdir(), 'orch-e2e-'));
  const repo = join(home, 'code', 'svc');
  mkdirSync(repo, { recursive: true });
  const app = await launch(home, ['--open-repo', repo]);
  try {
    const window = await app.firstWindow();
    await expect(window.getByRole('button', { name: /svc/ }).first()).toBeVisible({ timeout: 15_000 });
    await window.keyboard.press('Control+Backquote');
    const input = window.getByRole('textbox', { name: /terminal|shell/i }).first();
    await expect(input).toBeAttached({ timeout: 15_000 });
    await window.waitForTimeout(1500);
    await input.pressSequentially("printf '\\033[?2026$p'; echo after-$((40+2))\n");
    // The typed line shows after-$((40+2)); only output drawn after the query shows after-42.
    await expect(window.locator('.xterm-rows')).toContainText('after-42', { timeout: 15_000 });
  } finally {
    await closeApp(app);
  }
});

test('Help → Report a problem saves a zip and shows where (BUG-02, BUG-04)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-e2e-'));
  const app = await launch(home);
  try {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    // Keep the test from opening Finder / Explorer windows.
    await app.evaluate(({ shell }) => {
      shell.showItemInFolder = () => undefined;
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.send('orch:report-problem'));
    const dialog = window.getByRole('dialog', { name: /Report a problem/ });
    await expect(dialog).toContainText('Nothing is sent anywhere.', { timeout: 15_000 });
    await expect(dialog).toContainText('versions.json');
    await dialog.getByRole('button', { name: 'Save report' }).click();
    await expect(dialog).toContainText(join(home, '.orch', 'bug-reports'), { timeout: 30_000 });
  } finally {
    await closeApp(app);
  }
});

test('View → Move menu to the other side moves the activity bar across and remembers it', async () => {
  // ponytail: on macOS the window's storage lives in the shared userData folder (it ignores HOME), so the test flips back when done.
  const home = mkdtempSync(join(tmpdir(), 'orch-e2e-'));
  const app = await launch(home);
  const toggle = () =>
    app.evaluate(({ Menu }) => {
      const view = Menu.getApplicationMenu()?.items.find((item) => item.role === 'viewMenu' || item.label === 'View');
      view?.submenu?.items.find((item) => item.label === 'Move menu to the other side')?.click();
    });
  let flipped = false;
  try {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    const nav = window.getByRole('navigation').first();
    await expect(nav).toBeVisible({ timeout: 15_000 });
    const onRight = async () => ((await nav.boundingBox())?.x ?? 0) > 600;
    const before = await onRight();
    await toggle();
    flipped = true;
    await expect.poll(onRight).toBe(!before);
    await window.reload();
    await expect(nav).toBeVisible({ timeout: 15_000 });
    expect(await onRight()).toBe(!before);
    await toggle();
    flipped = false;
    await expect.poll(onRight).toBe(before);
  } finally {
    if (flipped) await toggle();
    await closeApp(app);
  }
});

test('userData path is scoped to ~/.orch/userData and respects HOME', async () => {
  const home = mkdtempSync(join(tmpdir(), 'orch-e2e-userdata-'));
  const app = await launch(home);
  try {
    const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    expect(userData).toBe(join(home, '.orch', 'userData'));
  } finally {
    await closeApp(app);
  }
});

test('concurrent instances with separate HOME directories do not collide on single-instance lock', async () => {
  const home1 = mkdtempSync(join(tmpdir(), 'orch-e2e-inst1-'));
  const home2 = mkdtempSync(join(tmpdir(), 'orch-e2e-inst2-'));
  const app1 = await launch(home1);
  const app2 = await launch(home2);
  try {
    const win1 = await app1.firstWindow();
    const win2 = await app2.firstWindow();
    await expect(win1.getByRole('navigation').first()).toBeVisible({ timeout: 15_000 });
    await expect(win2.getByRole('navigation').first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await Promise.all([closeApp(app1), closeApp(app2)]);
  }
});

test('rapid sequential launches with fresh HOME do not die (opt-in soak)', async () => {
  test.skip(process.env.ORCH_LAUNCH_SOAK !== '1', 'opt-in soak test; run with ORCH_LAUNCH_SOAK=1');
  const N = 60;
  for (let i = 0; i < N; i++) {
    const home = mkdtempSync(join(tmpdir(), `orch-e2e-soak-${i}-`));
    const app = await launch(home, [], i % 5 !== 0 ? { ORCH_DEMO: '1' } : {});
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await expect(win.getByRole('navigation').first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await closeApp(app);
    }
  }
});

