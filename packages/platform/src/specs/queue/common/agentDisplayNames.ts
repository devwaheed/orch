import type { AgentId } from '@orchagents/contracts';

/** Display names shared by spec queue messages without importing adapter implementations. */
export const AGENT_DISPLAY_NAMES: Record<AgentId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  agy: 'Antigravity',
};
