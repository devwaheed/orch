// Design tests: every screen in both themes must match its approved baseline,
// and the key behaviours from design/screens.md must work.
//
// The app runs with ORCH_DEMO=1, which loads the same sample data as the prototype
// (accounts Personal/Work/Team…, runs r-01…r-06, sessions s-0f9d…), so screenshots
// are comparable to the artboards.
//
// Baselines live in design/tests/__screenshots__/ and are approved by a person
// against the canvas. They are protected files: agents may not update them.
import { test, expect, type Page } from '@playwright/test';

const screens = [
  { name: 'work', path: '/work' },
  { name: 'new-job', path: '/jobs/new' },
  { name: 'new-job-council', path: '/jobs/new?mode=council' },
  { name: 'specs', path: '/specs' },
  { name: 'specs-map', path: '/specs?view=map' },
  { name: 'review', path: '/review' },
  { name: 'review-refuted', path: '/review?worktree=orch/r-05' },
  { name: 'sessions', path: '/sessions' },
  { name: 'trust', path: '/trust' },
  { name: 'accounts', path: '/accounts' },
  { name: 'accounts-config', path: '/accounts?view=config' },
  { name: 'capacity', path: '/work?panel=capacity&open=codex-personal' },
] as const;

const themes = ['dark', 'light'] as const;

async function open(page: Page, path: string, theme: (typeof themes)[number]) {
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.addInitScript((t) => localStorage.setItem('orch.theme', t), theme);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

for (const theme of themes) {
  for (const s of screens) {
    test(`${s.name} looks like the design (${theme})`, async ({ page }) => {
      await open(page, s.path, theme);
      await expect(page).toHaveScreenshot(`${s.name}-${theme}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
        animations: 'disabled',
      });
    });
  }
}

// ---- Behaviours (one per row in screens.md; extend as screens are built) ----

test('paused run resumes on another account', async ({ page }) => {
  await open(page, '/work', 'dark');
  await page.getByRole('button', { name: 'Resume now on Codex · Team' }).click();
  await expect(page.getByText('r-04').first()).toBeVisible();
  await expect(page.getByText('Running').first()).toBeVisible();
});

test('only verified work can be merged', async ({ page }) => {
  await open(page, '/review?worktree=orch/r-05', 'dark');
  await expect(page.getByRole('button', { name: 'Approve & merge' })).toBeDisabled();
  await page.goto('/review?worktree=orch/r-02');
  await page.getByRole('button', { name: 'Approve & merge' }).click();
  await expect(page.getByRole('button', { name: 'Merged into main' })).toBeVisible();
});

test('add account in three steps', async ({ page }) => {
  await open(page, '/accounts', 'dark');
  await page.getByRole('button', { name: 'Add account' }).first().click();
  await page.getByRole('button', { name: /Codex/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Client' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Open sign-in' }).click();
  await expect(page.getByText('Kept separate')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Client').first()).toBeVisible();
});

test('agents that allow one account cannot add another', async ({ page }) => {
  await open(page, '/accounts', 'dark');
  // Antigravity on macOS / Windows (demo OS: macOS)
  await page.getByRole('button', { name: 'Add account' }).first().click();
  await expect(page.getByRole('button', { name: /Antigravity/ })).toBeDisabled();
});

test('theme switch changes every surface', async ({ page }) => {
  await open(page, '/work', 'dark');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
