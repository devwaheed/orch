/**
 * SaaS Factory status for a project, as the factory's own `factory-status.mjs --json`
 * prints it (devwaheed/saas-factory). orch only reads it; the factory owns the rules.
 * Unknown fields are dropped so a newer factory doesn't break orch.
 */
import { z } from 'zod';

export const FactoryStory = z.object({
  /** BMAD story key, e.g. "1-2-sign-in" */
  key: z.string(),
  /** BMAD sprint status, e.g. backlog, ready-for-dev, in-progress, review, done */
  status: z.string(),
  /** Story file, relative to the product */
  file: z.string().nullable(),
  openTasks: z.number().int().nullable(),
  /** The linked Kiro feature spec has requirements, design and tasks */
  spec: z.boolean(),
  specPath: z.string().nullable(),
  openSpecTasks: z.number().int().nullable(),
  done: z.boolean(),
  drift: z.string().nullable(),
});
export type FactoryStory = z.infer<typeof FactoryStory>;

export const FactoryEpic = z.object({
  id: z.string(),
  status: z.string().optional(),
  retro: z.string().optional(),
  stories: z.array(FactoryStory),
  storiesDone: z.number().int(),
  done: z.boolean(),
});
export type FactoryEpic = z.infer<typeof FactoryEpic>;

export const FactoryStatus = z.object({
  product: z.string(),
  path: z.string(),
  done: z.boolean(),
  missing: z.array(z.string()),
  /** The factory's next action, e.g. "write 05-references.md (saas-design-reference) — run /factory" */
  next: z.string().nullable(),
  stages: z.array(z.object({ stage: z.string(), by: z.string(), done: z.boolean() })),
  design: z.array(z.object({ step: z.string(), done: z.boolean() })),
  delivery: z
    .object({ file: z.string(), updated: z.string().nullable(), epics: z.array(FactoryEpic) })
    .nullable(),
});
export type FactoryStatus = z.infer<typeof FactoryStatus>;
