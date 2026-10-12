/**
 * Updates sprint-status.yaml when a spec merges (docs/specs/spec-queue.md §2, SQ-22).
 * orch is its only writer.
 */
import { err, ok } from '@orchagents/base';
import type { Result } from '@orchagents/contracts';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { parseDocument, isMap } from 'yaml';
import { detectSprintStatus } from '../../loader/node/sprintStatus.js';

export async function updateSprintStatusOnMerge(
  repoPath: string,
  specId: string,
): Promise<Result<boolean>> {
  const relPath = await detectSprintStatus(repoPath);
  if (!relPath) {
    // sprint-status.yaml does not exist in this repo
    return ok(false);
  }

  const fullPath = path.resolve(repoPath, relPath);
  let content: string;
  try {
    content = await readFile(fullPath, 'utf8');
  } catch (error) {
    return err({
      code: 'internal',
      message: `Failed to read sprint-status file: ${(error as Error).message}`,
    });
  }

  const doc = parseDocument(content, { prettyErrors: true });
  if (doc.errors.length > 0) {
    return err({
      code: 'validation_failed',
      message: `Failed to parse sprint status YAML: ${doc.errors[0]?.message}`,
    });
  }

  const targetNum = Number(specId);
  let updatedKey = false;

  const storiesNode = doc.get('stories');
  if (isMap(storiesNode)) {
    for (const pair of storiesNode.items) {
      const k = String(pair.key);
      const kNum = Number(k.replace(/^(?:story|s)[-_]/i, ''));
      if (k === specId || (!Number.isNaN(kNum) && kNum === targetNum)) {
        doc.setIn(['stories', pair.key], 'done');
        updatedKey = true;
        break;
      }
    }
    if (!updatedKey) {
      doc.setIn(['stories', specId], 'done');
      updatedKey = true;
    }
  } else if (isMap(doc.contents)) {
    for (const pair of doc.contents.items) {
      const k = String(pair.key);
      const kNum = Number(k.replace(/^(?:story|s)[-_]/i, ''));
      if (k === specId || (!Number.isNaN(kNum) && kNum === targetNum)) {
        doc.set(pair.key, 'done');
        updatedKey = true;
        break;
      }
    }
    if (!updatedKey) {
      doc.set(specId, 'done');
      updatedKey = true;
    }
  }

  try {
    await writeFile(fullPath, doc.toString(), 'utf8');
    return ok(true);
  } catch (error) {
    return err({
      code: 'internal',
      message: `Failed to write sprint-status file: ${(error as Error).message}`,
    });
  }
}
