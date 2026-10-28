/**
 * Specs store: spec queues and their spec rows. Fed by queue.changed (replaces the
 * whole queue) and spec.changed (replaces one spec row inside its queue).
 */
import { create } from 'zustand';
import type { SpecQueue, SpecRun } from '@orchagents/contracts';

export interface SpecsState {
  readonly queues: readonly SpecQueue[];
  upsertQueue(queue: SpecQueue): void;
  /** Replaces one spec row. Ignored when its queue is not in the store yet. */
  upsertSpec(spec: SpecRun): void;
}

export const useSpecsStore = create<SpecsState>()((set) => ({
  queues: [],
  upsertQueue: (queue) =>
    set((s) => {
      const index = s.queues.findIndex((q) => q.id === queue.id);
      if (index === -1) {
        return { queues: [...s.queues, queue] };
      }
      return { queues: s.queues.map((q, i) => (i === index ? queue : q)) };
    }),
  upsertSpec: (spec) =>
    set((s) => ({
      queues: s.queues.map((q) => {
        const matchesQueue = q.id === spec.queueId;
        const hasSpec = q.specs.some((x) => x.id === spec.id);
        if (!matchesQueue && !hasSpec) {
          return q;
        }
        const specs = hasSpec
          ? q.specs.map((x) => (x.id === spec.id ? { ...x, ...spec } : x))
          : [...q.specs, spec];
        return { ...q, specs };
      }),
    })),
}));
