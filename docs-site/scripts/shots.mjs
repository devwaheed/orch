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

for (const theme of ['light', 'dark']) {
  for (const shot of shots) {
    const home = mkdtempSync(join(tmpdir(), 'orch-help-'));
    const app = await electron.launch({ executablePath: join(root, exe), env: { ...process.env, HOME: home, USERPROFILE: home, ORCH_DEMO: '1' } });
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
    // 1440 px wide JPEG (Electron captures at the screen's scale; resize so the bundle stays small)
    const jpeg = await app.evaluate(async ({ BrowserWindow }) => {
      const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
      return image.resize({ width: 1440, quality: 'best' }).toJPEG(82).toString('base64');
    });
    writeFileSync(join(site, 'images', `${shot.name}-${theme}.jpg`), Buffer.from(jpeg, 'base64'));
    await app.close();
    console.log(`${shot.name}-${theme}.jpg`);
  }
}
