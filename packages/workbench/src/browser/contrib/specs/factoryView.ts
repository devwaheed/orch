/**
 * The Specs screen's read of the SaaS Factory status: stage labels, the story that
 * matches a spec file, and the delivery count. Pure functions; the factory owns the
 * rules and orch only renders what `factoryStatus()` returns.
 */
import type { FactoryStatus, FactoryStory } from '@orchagents/contracts';

/** "05-references" → "references", "02-value-map" → "value map". */
export function factoryStageLabel(stage: string): string {
  return stage.replace(/^\d+[-_]/, '').replace(/[-_]/g, ' ');
}

/** Compares relative paths: backslashes, a leading "./" and repeated slashes don't matter. */
export function normalizeSpecPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/{2,}/g, '/');
}

/** The delivery story whose file is the spec's file, or null. */
export function findFactoryStory(status: FactoryStatus | null, file: string): FactoryStory | null {
  if (!status?.delivery) return null;
  const target = normalizeSpecPath(file);
  for (const epic of status.delivery.epics) {
    for (const story of epic.stories) {
      if (story.file && normalizeSpecPath(story.file) === target) return story;
    }
  }
  return null;
}

/** Stories done / stories total across every epic. */
export function factoryStoryCounts(delivery: FactoryStatus['delivery']): { done: number; total: number } {
  if (!delivery) return { done: 0, total: 0 };
  const stories = delivery.epics.flatMap((epic) => epic.stories);
  return { done: stories.filter((story) => story.done).length, total: stories.length };
}
