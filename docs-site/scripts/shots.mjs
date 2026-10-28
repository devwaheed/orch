// Regenerates the help screenshots in docs-site/images from the packaged demo app.
// Run: pnpm help:shots (builds the app first). Needs no real accounts: ORCH_DEMO=1 and a temp home.
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(site, '..');
const { shots } = JSON.parse(readFileSync(join(site, 'shots.json'), 'utf8'));
const exe = {
  darwin: 'packages/app/dist/release/mac-arm64/orch.app/Contents/MacOS/orch',
  linux: 'packages/app/dist/release/linux-unpacked/orch',
  win32: 'packages/app/dist/release/win-unpacked/orch.exe',
}[process.platform];
mkdirSync(join(site, 'images'), { recursive: true });

let shotsTaken = 0;
let exitCode = 0;

try {
  for (const theme of ['light', 'dark']) {
    for (const shot of shots) {
      // An app launch now and then closes before its first page settles; retry that shot instead of losing the run.
      for (let attempt = 1; ; attempt++) {
        try {
          await takeShot(shot, theme);
          shotsTaken++;
          break;
        } catch (error) {
          if (attempt === 3) throw error;
          console.log(`retrying ${shot.name}-${theme}: ${String(error).split('\n')[0]}`);
        }
      }
    }
  }
} catch (error) {
  exitCode = 1;
  console.error(`help screenshots failed: ${String(error).split('\n')[0]}`);
} finally {
  console.log(`help screenshots: ${shotsTaken} taken`);
  // Some Electron/Playwright handles can remain open after close() settles. Do not let them
  // keep this maintenance script alive after reporting its result.
  process.exit(exitCode);
}

async function takeShot(shot, theme) {
  let app;
  let child;
  try {
    const home = mkdtempSync(join(tmpdir(), 'orch-help-'));
    app = await electron.launch({ executablePath: join(root, exe), env: { ...process.env, HOME: home, USERPROFILE: home, ORCH_DEMO: '1' } });
    child = app.process();
    const win = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    await win.addInitScript((t) => localStorage.setItem('orch.theme', t), theme);
    await win.evaluate((t) => localStorage.setItem('orch.theme', t), theme);
    await win.reload();
    await win.getByRole('navigation').first().waitFor({ timeout: 15_000 });
    await win.waitForTimeout(1500);
    for (const step of shot.steps) {
      if (step.nav) await win.locator(`nav >> role=button[name=/^${step.nav}/]`).first().click();
      if (step.click) await win.locator(step.click).first().click();
      await win.waitForTimeout(800);
    }
    // A close-up when the shot names a `clip` element (with 8 px of room around it), else the whole window.
    // Scroll a clipped element into view first: the status bar sits at the bottom of the document,
    // which can be below the fold on a long screen, and a crop outside the capture is empty.
    const clip = shot.clip ? win.locator(shot.clip).first() : null;
    if (clip) await clip.scrollIntoViewIfNeeded();
    const box = clip ? await clip.boundingBox() : null;
    const rect = box ? { x: Math.max(0, Math.floor(box.x - 8)), y: Math.max(0, Math.floor(box.y - 8)), width: Math.ceil(box.width + 16), height: Math.ceil(box.height + 16) } : null;
    // Saved at CSS-pixel size (Electron captures at the screen's scale; resize so the bundle stays small)
    const jpeg = await app.evaluate(async ({ BrowserWindow }, r) => {
      const win = BrowserWindow.getAllWindows()[0];
      let image = await win.webContents.capturePage();
      if (r) {
        // capturePage(rect) fails on some GPUs; crop the full capture instead, in device pixels.
        const scale = image.getSize().width / win.getContentSize()[0];
        image = image.crop({ x: Math.round(r.x * scale), y: Math.round(r.y * scale), width: Math.round(r.width * scale), height: Math.round(r.height * scale) });
      }
      return image.resize({ width: r ? r.width : 1440, quality: 'best' }).toJPEG(85).toString('base64');
    }, rect);
    const bytes = Buffer.from(jpeg, 'base64');
    if (bytes.length < 1024) {
      throw new Error(`${shot.name}-${theme}.jpg is ${bytes.length} bytes; check the ${shot.clip ? `clip selector ${shot.clip}` : 'window capture'}.`);
    }
    writeFileSync(join(site, 'images', `${shot.name}-${theme}.jpg`), bytes);
    console.log(`${shot.name}-${theme}.jpg`);
  } finally {
    if (app) await closeApp(app, child);
  }
}

async function closeApp(app, child) {
  let timeout;
  try {
    await Promise.race([
      app.close(),
      new Promise((resolve) => {
        timeout = setTimeout(resolve, 10_000);
      }),
    ]);
  } catch {
    // Closing is best-effort; a written shot must remain successful.
  } finally {
    clearTimeout(timeout);
  }

  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill();
    } catch {
      // It may have exited between the check and kill.
    }
  }
}
