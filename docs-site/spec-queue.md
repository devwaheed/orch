# Spec queue

The spec queue runs an ordered list of specs, each as its own job. It starts the next spec when the queue rules allow and shows its done-when criteria and agent map.

## Prepare specs

By default, put Markdown spec files in `docs/specs`. Set another source folder in `.orch/specs.yaml` if needed. Each file needs YAML front matter validated by the spec format; see `docs/specs/templates/spec.md`. The numeric `id` determines order. The body after the title becomes the implementer's goal.

Run `orch specs check` to find load problems. `orch specs init` can add a front-matter skeleton to BMAD stories that lack one. Review the generated criteria before starting the queue; orch does not infer criteria from prose.

## Queue rules

The default order is **Parallel when files don't overlap**, with at most two active specs. A spec with an empty scope runs alone. The default dependency advance point is **Verified**. The default failure policy retries twice after the first try, then pauses for you. You can change these settings in the Specs view or `.orch/specs.yaml`.

For each spec, orch implements, runs check criteria and both guardrails, then runs an audit. The auditor cannot edit files. The queue never merges a spec without your approval. Review and merge approved specs in dependency order.

Pause stops new specs from starting; active specs finish. Cancel stops active jobs and keeps their worktrees.

<!-- Source: LOCKED SQ-ALL; spec-queue.md §§1–7, 9, 13 -->
