/**
 * Detects sprint-status.yaml per docs/specs/spec-queue.md §2:
 * "if docs/sprint-status.yaml or docs/stories/sprint-status.yaml exists, orch is its only writer"
 */
import { stat } from 'node:fs/promises';
import * as path from 'node:path';

export async function detectSprintStatus(repoPath: string): Promise<string | null> {
  const candidates = [
    path.join('docs', 'sprint-status.yaml'),
    path.join('docs', 'stories', 'sprint-status.yaml'),
  ];

  for (const candidate of candidates) {
    const fullPath = path.join(repoPath, candidate);
    try {
      const s = await stat(fullPath);
      if (s.isFile()) {
        return candidate.replaceAll('\\', '/');
      }
    } catch {
      // not found, check next
    }
  }

  return null;
}
