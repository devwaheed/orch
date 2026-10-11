/**
 * The engine host's own record of which account env each session and workflow
 * runs on. Claw strips `env` from the workflow specs it writes (patch, ADR 0011),
 * so the host keeps the mapping here and re-applies it on resume.
 *
 * The values are allowlisted profile paths (ENGINE_ENV_ALLOWLIST), not secrets.
 * The file is owner-only and written atomically.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AgentId, EngineEnv } from '@orch/contracts';

export const SessionRecord = z.object({
  agent: AgentId,
  cwd: z.string().min(1),
  env: EngineEnv,
  model: z.string().min(1).optional(),
  readOnly: z.boolean(),
  maxBudgetUsd: z.number().positive().optional(),
  workflow: z.string().optional(),
  node: z.string().optional(),
  cliSessionId: z.string().optional(),
});
export type SessionRecord = z.infer<typeof SessionRecord>;

export const WorkflowRecord = z.object({
  template: z.enum(['solve', 'compare', 'council', 'autoloop']),
  /** Keyed by agent name, or `implement` for a solve workflow's implementer. */
  envByNode: z.record(EngineEnv),
});
export type WorkflowRecord = z.infer<typeof WorkflowRecord>;

export const EngineState = z.object({
  version: z.literal(1),
  sessions: z.record(SessionRecord),
  workflows: z.record(WorkflowRecord),
});
export type EngineState = z.infer<typeof EngineState>;

export function emptyState(): EngineState {
  return { version: 1, sessions: {}, workflows: {} };
}

export class EngineStateFile {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** A missing or unreadable file starts empty. `corrupt` tells the caller it did. */
  async load(): Promise<{ state: EngineState; corrupt: boolean }> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch {
      return { state: emptyState(), corrupt: false };
    }
    try {
      const parsed = EngineState.safeParse(JSON.parse(raw));
      if (parsed.success) return { state: parsed.data, corrupt: false };
    } catch {
      // fall through
    }
    return { state: emptyState(), corrupt: true };
  }

  async save(state: EngineState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      await rename(tmp, this.filePath);
    } catch (error) {
      await unlink(tmp).catch(() => undefined);
      throw error;
    }
  }
}
