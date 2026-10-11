# orch design handoff

Everything needed to build the orch app exactly as designed, and to stop it drifting. Commit this folder to the repo as `design/`.

Canvas (source of truth until phase 2 ships): https://claude.ai/artifact/9KkN8ggG1cZsfFaEo4kkua

## What's here

| Path | What it is | Who edits it |
| --- | --- | --- |
| `DESIGN_RULES.md` | The 14 rules and how each is enforced; a snippet for `AGENTS.md` | People |
| `screens.md` | Every screen: route, plan phase, prototype file, components, behaviours, copy to keep | People |
| `tokens/tokens.css` | All colours (dark and light), type, spacing, radius and layout sizes as CSS variables | Generated, protected |
| `tokens/tokens.json` | The same colours as data, for tools and tests | Generated, protected |
| `icons/icons.ts`, `icons/Icon.tsx` | The 59 icons from the design and the one component that draws them | Generated, protected |
| `lint/stylelint.config.mjs` | CSS rules: tokens only for colour, type, spacing, radius; no gradients | Protected |
| `lint/eslint.design.mjs` | TSX rules: no raw colours, inline styles, stray SVGs, icon libraries or UI kits | Protected |
| `tests/design.spec.ts` | Playwright: every screen in both themes against approved screenshots, plus key behaviours | People |
| `prototype/` | The artboard source files and `canvas.json` | Re-exported from the canvas |
| `scripts/` | Regenerate tokens and icons from the prototype | People |

## How to use it

1. **Wire it in (phase 2, day 1).** Import `tokens/tokens.css` once in the web app; use `Icon.tsx`; add both lint configs to the web package and CI; add `tests/design.spec.ts` to the Playwright suite; add the snippet from `DESIGN_RULES.md` to `AGENTS.md`; add `design/tokens`, `design/icons`, `design/lint` and `design/tests/__screenshots__` to orch's protected files.
2. **Build screen by screen.** For each screen in the current plan phase, give the agent its section of `screens.md` plus `prototype/Main.dc.html`. The prototype has the exact layout, spacing, copy and behaviour; the real app replaces its sample data with live data.
3. **Approve baselines once.** When a screen is first built, a person compares its screenshot with the canvas and commits the baseline. From then on, any visual change fails CI until a person approves it.
4. **Change the design first.** New UI is sketched on the canvas, then built. See "When the design changes" in `DESIGN_RULES.md`.

## About the prototype files

They are single-file prototypes for the design canvas: inline styles, sample data, and a small runtime that only the canvas provides, so they won't open on their own in a browser. Use them as the precise reference for structure, values and wording, and open the canvas to see them rendered. Don't ship or copy their code as-is; rebuild with components, CSS modules and tokens.

All screen artboards are one prototype (`Main.dc.html`) opened in different states; the small files (`Review.dc.html`, `AccountsWindows.dc.html`…) only set that state.

## Demo mode for tests

Visual tests need the app to show the same data as the prototype. Add a demo mode (`ORCH_DEMO=1`) that loads the prototype's sample data, found in `renderVals()` of `Main.dc.html`: the accounts (`AG`), runs (`R`), agent output (`LN`), sessions (`SS`), worktrees (`WT`) and trust figures (`TRA`).
