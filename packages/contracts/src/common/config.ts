/**
 * Schema for ~/.orch/accounts.yaml — the only file users edit.
 * The Accounts screen and the file must always round-trip through this schema.
 */
import { z } from 'zod';
import { AgentId } from './ids.js';

export const RoutingRule = z.enum(['primary-first', 'most-headroom']);
export type RoutingRule = z.infer<typeof RoutingRule>;

const AccountEntry = z
  .object({
    primary: z.boolean().optional(),
    /** false = signed in but never routed to */
    use: z.boolean().optional(),
  })
  .strict();

/** Account names in the file are slugs: `team`, `personal-2`. */
const Slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

const Percent = z.union([
  z.number().int().min(1).max(100),
  z.string().regex(/^([1-9][0-9]?|100)%$/),
]);

export const AccountsFile = z
  .object({
    routing: RoutingRule.default('primary-first'),
    accounts: z.record(AgentId, z.record(Slug, AccountEntry)).default({}),
    limits: z
      .object({
        max_runs_per_account: z.number().int().min(1).max(20).default(3),
        near_limit_at: Percent.default('85%'),
      })
      .strict()
      .default({}),
    /** true = link each agent's own skills folder into all its accounts; per-agent map allowed */
    share_skills: z.union([z.boolean(), z.record(AgentId, z.boolean())]).default(true),
  })
  .strict()
  .superRefine((file, ctx) => {
    for (const [agent, accounts] of Object.entries(file.accounts)) {
      const primaries = Object.entries(accounts ?? {}).filter(([, a]) => a.primary);
      if (primaries.length > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['accounts', agent],
          message: `Only one ${agent} account can be primary.`,
        });
      }
    }
  });
export type AccountsFile = z.infer<typeof AccountsFile>;
