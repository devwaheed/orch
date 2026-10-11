/**
 * Playwright-Electron checks for S2-01 / S5-01. Runs the unpacked packaged app
 * from `electron-builder --dir`. Each test gets its own HOME, so the real
 * ~/.orch is never touched.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
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
  throw new Error(`Unpacked app executable not found in dist/release or release. Run pnpm --filter @orch/app dist:dir first.`);
}

async function launch(home: string): Promise<ElectronApplication> {
  const executablePath = getUnpackedExecutable();
  return electron.launch({
    executablePath,
    args: [],
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

type Metric = { pid: number; type: string; name?: string };

async function hostMetrics(app: ElectronApplication): Promise<Metric[]> {
  const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics());
  return metrics.filter((m) => m.type === 'Utility' && m.name?.startsWith('orch-'));
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
    await app.close();
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
    await app.close();
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
    await app.close();
  }
});
