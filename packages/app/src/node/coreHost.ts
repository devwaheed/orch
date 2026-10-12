/**
 * Headless entry: the core host as a plain Node process (`orch serve`, `pnpm dev:headless`). Usage:
 *   node coreHost.js [--claude-bin <path>] [--codex-bin|--gemini-bin|--opencode-bin|--agy-bin <path>]
 * The home folder is os.homedir(). The engine and PTY hosts are forked as child processes.
 */
import { runHeadlessServe } from './serve.js';

process.exit(await runHeadlessServe());
