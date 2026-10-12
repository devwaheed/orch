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
  // PTY host (S2-06, S5-01b): built to dist/pty-host.cjs.
  { name: 'pty-host', entry: 'src/electron-utility/ptyHost.ts' },
  // Plain Node entries used by `orch serve` and the headless core host's children.
  { name: 'coreHost', entry: 'src/node/coreHost.ts', format: 'es' },
  { name: 'engineHost', entry: 'src/node/engineHost.ts' },
  { name: 'ptyHost', entry: 'src/node/ptyHost.ts' },
  { name: 'orch', entry: 'src/node/bin.ts', format: 'es' },
];

const external = ['electron', 'better-sqlite3', 're2', 'node-pty', /^node:/];

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
          format: item.format ?? 'cjs',
          entryFileNames: item.format === 'es' ? `${item.name}.js` : `${item.name}.cjs`,
          inlineDynamicImports: true,
        },
      },
    },
  });
}

await copyFile(`${appRoot}build/placeholder.html`, `${outDir}/placeholder.html`);
