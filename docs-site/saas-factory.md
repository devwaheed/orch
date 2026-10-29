# SaaS Factory

orch integrates with SaaS Factory to track product planning stages, guide next actions, and execute product stories through the spec queue.

![The SaaS Factory strip showing product stages, progress, and the next action button](images/factory-strip.jpg)

## What you see

When you open a project created with SaaS Factory, a dedicated strip appears at the top of the [specs.md](specs.md) screen:

- **Factory title and product**: displays **SaaS Factory** along with the product key.
- **Planning stages**: pills showing the product's sequential design and architecture stages (such as `brief`, `research`, `value map`, `architecture`, `references`, and `spec`). Completed stages show a checkmark icon. Hovering over a stage displays its stage folder and responsible skill or command (`{stage} · {by}`, e.g. `01-research · saas-idea-research`).
- **Story delivery**: shows total story progress (such as `3/12 stories`) once delivery has begun.
- **Next action**: displays the exact next step recommended by the factory (e.g. `Next: write 05-references.md (saas-design-reference) — run /factory`).
- **Run next step**: a primary action button with a play icon to launch the next step.

## How to run the next factory step

1. Navigate to **Specs** (press ⌘1 on macOS, Ctrl+1 elsewhere).
2. Review the **Next** action on the SaaS Factory strip.
3. Click **Run next step**.
4. orch opens the [new-spec.md](new-spec.md) screen and automatically prefills the title with the step name and the instructions in **What to do** with:
   `Run the SaaS Factory's next step for this project: <next>. Use the factory skill (/factory, or $factory in Codex).`
5. Click **Add spec**.
6. The agent reads the project context and advances the product to its next stage.

## How factory stories show up as specs

When you break a product down into executable stories, each story appears as a spec in the spec queue:

- In the Specs **Plan** view, selecting a spec that matches a factory story reveals its factory metadata in the details panel:
  `Factory story: <key> · <status> · <n> spec tasks open` (or `spec tasks done`, or `no Kiro spec yet`).
- When a spec passes all checks, is approved in [review.md](review.md), and merges into `main`, orch updates the story count in the factory strip automatically.

## Product pipeline commands

Run these commands from a factory product repository:

- `orch product status` prints the pipeline stages and their status.
- `orch product gate <id> "<words>"` records your answer to an open gate through SaaS Factory.

The gate command refreshes the product status after recording your answer.

## Where orch finds SaaS Factory

orch detects SaaS Factory products and scripts without manual configuration:

- **Product detection**: a repository is recognized as a factory product if it contains `docs/00-brief.md`, `00-brief.md`, or a `.factory/` directory.
- **Script discovery**: orch searches the plugin caches of installed agents to find `scripts/factory-status.mjs`, checking in this order:
  1. Claude plugin cache: `~/.claude/plugins/cache/saas-factory/saas-factory/<version>/scripts/factory-status.mjs`
  2. Codex plugin cache: `~/.codex/plugins/cache/saas-factory/saas-factory/<version>/scripts/factory-status.mjs`
  3. Gemini CLI plugin directory: `~/.gemini/config/plugins/saas-factory/scripts/factory-status.mjs`
  4. OpenCode plugin directory: `~/.config/opencode/plugins/saas-factory/scripts/factory-status.mjs`
- **What happens if it is not installed**:
  - If a repository is not a factory product, or if the factory plugin is not installed in any agent cache, the strip stays completely hidden.
  - To install SaaS Factory, run `npx github:devwaheed/saas-factory` in your terminal and reopen the project in orch.

## Shared skills

orch automatically symlinks installed agent skills from your personal user folder into each account's isolated profile. In [accounts.md](accounts.md), the agent section confirms shared availability:
`<count> skills (incl. saas-factory) shared with all <name> accounts`.
