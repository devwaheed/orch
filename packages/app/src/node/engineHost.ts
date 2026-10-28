/**
 * Headless entry: the engine host as a plain Node child process (ADR 0006).
 * The core host forks this with IPC. Usage:
 *   node engineHost.js --engine-dir <absolute path> [--claude-bin <path>] [--codex-bin|--gemini-bin|--opencode-bin|--agy-bin <path>]
 * The engine folder may also come from ORCH_ENGINE_DIR.
 */
import type { EnginePort } from '@orchagents/platform/src/engine/common/engineClient.js';
import { readAgentBins, readFlag } from './argv.js';
import { runEngineHost } from './engineHostMain.js';

async function main(): Promise<void> {
  const engineDir = readFlag(process.argv, 'engine-dir') ?? process.env.ORCH_ENGINE_DIR;
  if (!engineDir) {
    process.stderr.write('The engine needs an engine folder: pass --engine-dir.\n');
    process.exitCode = 2;
    return;
  }

  const port: EnginePort = {
    postMessage: (message) => {
      process.send?.(message);
    },
    on: (_event, listener) => {
      process.on('message', listener);
      return undefined;
    },
  };

  const started = await runEngineHost({
    engineDir,
    port,
    freshAppStart: process.argv.includes('--fresh-app-start'),
    ...(readFlag(process.argv, 'claude-bin') ? { claudeBin: readFlag(process.argv, 'claude-bin') as string } : {}),
    agentBins: readAgentBins(process.argv),
  });

  // The core host owns our lifetime: when its channel closes, stop cleanly.
  process.on('disconnect', () => {
    void started.stop().finally(() => process.exit(0));
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
