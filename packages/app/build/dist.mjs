/**
 * Packages orch with electron-builder while preserving Node-ABI native modules
 * in the workspace for Vitest (S5-01).
 *
 * Sequence:
 * 1. Build workbench: packages/workbench Vite build -> dist
 * 2. Build electron bundles: build/build-electron.mjs -> dist
 * 3. Snapshot existing Node-ABI native modules in node_modules
 * 4. Run electron-builder with passed CLI flags (defaulting to --dir)
 * 5. Restore Node-ABI native modules so workspace Vitest continues to pass
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '../..');

// 1. Build workbench if not yet built or ensure it's up to date
console.log('[dist] Building workbench...');
const wbBuild = spawnSync('pnpm', ['--filter', '@orch/workbench', 'build'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (wbBuild.status !== 0) {
  process.exit(wbBuild.status ?? 1);
}

// 2. Build electron main, preload and utility bundles
console.log('[dist] Building electron bundles...');
const elBuild = spawnSync(process.execPath, [join(here, 'build-electron.mjs')], {
  cwd: appRoot,
  stdio: 'inherit',
});
if (elBuild.status !== 0) {
  process.exit(elBuild.status ?? 1);
}

// 3. Find and snapshot native module binaries (.node) in node_modules
function findNativeBinaries(dir, list = []) {
  if (!existsSync(dir)) return list;
  try {
    for (const entry of readdirSync(dir)) {
      if (entry === '.git' || entry === 'dist' || entry === 'release') continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        findNativeBinaries(full, list);
      } else if (entry.endsWith('.node')) {
        list.push({ path: full, data: readFileSync(full) });
      }
    }
  } catch {
    // Ignore read errors
  }
  return list;
}

const nodeModulesDir = join(repoRoot, 'node_modules');
console.log('[dist] Snapshotting workspace Node-ABI native modules...');
const snapshot = findNativeBinaries(nodeModulesDir);
console.log(`[dist] Cached ${snapshot.length} native binaries for post-packaging restoration.`);

const extraArgs = process.argv.slice(2);
const passArgs = extraArgs.length > 0 ? extraArgs : ['--dir'];
const builderArgs = ['exec', 'electron-builder', '--config', 'electron-builder.config.cjs', ...passArgs];

let exitCode = 0;
try {
  console.log(`[dist] Running electron-builder ${passArgs.join(' ')}...`);
  const buildResult = spawnSync('pnpm', builderArgs, {
    cwd: appRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  exitCode = buildResult.status ?? 0;
} finally {
  console.log('[dist] Restoring workspace Node-ABI native modules...');
  // Restore all snapshotted binaries
  for (const item of snapshot) {
    try {
      writeFileSync(item.path, item.data);
    } catch (err) {
      console.warn(`[dist] Failed to restore ${item.path}:`, err);
    }
  }

  // Remove any newly compiled build/Release .node files that were not in snapshot
  const currentBinaries = findNativeBinaries(nodeModulesDir);
  const snapshottedPaths = new Set(snapshot.map((s) => s.path));
  for (const item of currentBinaries) {
    if (!snapshottedPaths.has(item.path) && item.path.includes('build/Release')) {
      try {
        rmSync(item.path, { force: true });
      } catch {
        // ignore
      }
    }
  }

  // Verify that Node can load re2 and better-sqlite3; if not, run pnpm -r rebuild
  const testNode = spawnSync(
    process.execPath,
    ['-e', "require('better-sqlite3'); require('re2');"],
    { cwd: appRoot, stdio: 'ignore' },
  );
  if (testNode.status !== 0) {
    console.log('[dist] Verifying native modules for Node ABI via pnpm rebuild...');
    spawnSync('pnpm', ['-r', 'rebuild', 're2', 'better-sqlite3'], {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  } else {
    console.log('[dist] Workspace Node-ABI verified.');
  }
}

process.exit(exitCode);
