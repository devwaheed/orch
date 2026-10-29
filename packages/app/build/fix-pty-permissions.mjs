/** Make node-pty's Unix spawn helpers executable for local, test, and packaged use. */
import { chmodSync, lstatSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

if (process.platform === 'darwin' || process.platform === 'linux') {
  const require = createRequire(import.meta.url);
  const packageRoot = dirname(dirname(require.resolve('node-pty')));

  function makeSpawnHelpersExecutable(directory) {
    for (const entry of readdirSync(directory)) {
      const fullPath = join(directory, entry);
      const stat = lstatSync(fullPath);
      if (stat.isDirectory()) {
        makeSpawnHelpersExecutable(fullPath);
      } else if (entry === 'spawn-helper') {
        chmodSync(fullPath, 0o755);
      }
    }
  }

  makeSpawnHelpersExecutable(packageRoot);
}
