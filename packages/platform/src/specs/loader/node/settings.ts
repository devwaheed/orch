/**
 * Reads and validates `.orch/specs.yaml` (docs/specs/spec-queue.md §3).
 * Uses locked defaults if the file does not exist.
 */
import { err, ok } from '@orchagents/base';
import { SpecQueueSettings, type Result } from '@orchagents/contracts';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { parseDocument } from 'yaml';

export async function loadSpecQueueSettings(repoPath: string): Promise<Result<SpecQueueSettings>> {
  const settingsPath = path.join(repoPath, '.orch', 'specs.yaml');
  let content: string;
  try {
    content = await readFile(settingsPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ok(SpecQueueSettings.parse({}));
    }
    return err({
      code: 'internal',
      message: `Failed to read .orch/specs.yaml: ${(error as Error).message}`,
      fix: 'Check file permissions for .orch/specs.yaml.',
    });
  }

  const doc = parseDocument(content, { prettyErrors: true });
  if (doc.errors.length > 0) {
    const firstErr = doc.errors[0]?.message.split('\n')[0]?.trim() ?? 'syntax error';
    return err({
      code: 'validation_failed',
      message: `.orch/specs.yaml has YAML syntax error: ${firstErr}`,
      fix: 'Fix the syntax error in .orch/specs.yaml and try again.',
    });
  }

  const raw: unknown = doc.contents === null ? {} : doc.toJS();
  const checked = SpecQueueSettings.safeParse(raw);
  if (!checked.success) {
    const firstIssue = checked.error.issues[0];
    const pathDesc = firstIssue && firstIssue.path.length > 0 ? `${firstIssue.path.join('.')}: ` : '';
    const message = firstIssue?.message ?? 'schema validation failed';
    return err({
      code: 'validation_failed',
      message: `.orch/specs.yaml validation failed: ${pathDesc}${message}`,
      fix: 'Check .orch/specs.yaml against valid settings (see docs/specs/spec-queue.md §3).',
    });
  }

  return ok(checked.data);
}
