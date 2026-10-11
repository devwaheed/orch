/**
 * Builds the Electron main, preload and utility-process bundles into dist/ (S2-01).
 * Each entry is one CommonJS file: sandboxed preloads must be CommonJS, and the
 * utility hosts load their dependencies from the bundle. Electron, Node built-ins
 * and the native modules (better-sqlite3, re2, rebuilt for Electron separately) stay external.
 * Run with `pnpm build:electron` from packages/app.
 */
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const outDir = fileURLToPath(new URL('../dist', import.meta.url));

const entries = [
  { name: 'main', entry: 'src/electron-main/index.ts' },
  { name: 'preload', entry: 'src/electron-preload/index.ts' },
  { name: 'core-host', entry: 'src/electron-utility/coreProcess.ts' },
  { name: 'engine-host', entry: 'src/electron-utility/engineProcess.ts' },
  // PTY host (S2-06): built when its entry exists.
  { name: 'pty-host', entry: 'src/electron-utility/ptyProcess.ts', optional: true },
];

const external = ['electron', 'better-sqlite3', 're2', /^node:/];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const item of entries) {
  if (item.optional && !existsSync(`${appRoot}${item.entry}`)) continue;
  await build({
    root: appRoot,
    configFile: false,
    logLevel: 'warn',
    ssr: { noExternal: true, target: 'node' },
    build: {
      ssr: `${appRoot}${item.entry}`,
      outDir,
      emptyOutDir: false,
      target: 'node22',
      minify: false,
      sourcemap: false,
      rollupOptions: {
        external,
        output: {
          format: 'cjs',
          entryFileNames: `${item.name}.cjs`,
          inlineDynamicImports: true,
        },
      },
    },
  });
}

await copyFile(`${appRoot}build/placeholder.html`, `${outDir}/placeholder.html`);
