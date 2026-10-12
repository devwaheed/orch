/**
 * Shared start-up for the engine host, used by the Node child-process entry and
 * the Electron utility-process entry (ADR 0006). Both run the same code; only the
 * port differs.
 *
 * Sets the environment Claw reads when it loads (ADR 0011, ENG-03, ENG-04), then
 * starts the host. Claw is imported only after this runs, inside the host.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { EnginePort } from '@orchagents/platform/src/engine/common/engineClient.js';
import { createEngineHost, serveEngine, type HomeEnv } from '@orchagents/platform/src/engine/node/index.js';
import type { EngineAgentBins } from './argv.js';

export { AGENT_BIN_FLAGS, type EngineAgentBins } from './argv.js';

export interface EngineHostMainOptions {
  /** Absolute engine data folder, e.g. ~/.orch/engine (ENG-03). */
  readonly engineDir: string;
  readonly port: EnginePort;
  /** Optional claude binary (tests point this at the fake agent). */
  readonly claudeBin?: string;
  /** Optional binaries for the other agents (tests point these at the fake agent). */
  readonly agentBins?: EngineAgentBins;
}

export interface RunningEngineHost {
  stop(): Promise<void>;
}

export async function runEngineHost(options: EngineHostMainOptions): Promise<RunningEngineHost> {
  const engineDir = path.resolve(options.engineDir);
  const engineHome = path.join(engineDir, 'home');

  // The user's real home, read before the host redirects it (ADR 0011).
  const realHome: HomeEnv = {
    ...(process.env.HOME !== undefined ? { HOME: process.env.HOME } : {}),
    ...(process.env.USERPROFILE !== undefined ? { USERPROFILE: process.env.USERPROFILE } : {}),
  };

  await mkdir(engineHome, { recursive: true, mode: 0o700 });
  process.env.HOME = engineHome;
  process.env.USERPROFILE = engineHome;
  process.env.CLAWO_NO_EMBEDDED_SERVER = '1';
  process.env.CLAWO_WF_DIR = path.join(engineDir, 'wf');
  process.env.CLAWO_RUNS_DIR = path.join(engineDir, 'runs');

  const host = await createEngineHost({
    engineDir,
    realHome,
    ...(options.claudeBin ? { claudeBin: options.claudeBin } : {}),
    ...(options.agentBins ? { agentBins: { ...options.agentBins } } : {}),
  });
  const served = serveEngine(host, options.port);
  return {
    async stop() {
      served.close();
      await host.dispose();
    },
  };
}

export { readFlag } from './argv.js';
