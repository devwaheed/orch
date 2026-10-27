# ADR 0012: Tailwind utilities themed from the design tokens

- **Status:** Accepted (owner decision, 2026-10-27; replaces design rule 5's "CSS modules + tokens only")
- **Date:** 2026-10-27

## Context

The workbench was styled with about 25 hand-written CSS modules (about 7,700 lines). The owner asked to stop hand-writing CSS and use Tailwind, to migrate every screen now, and to keep the design tokens as the only source of values.

## Decision

- Tailwind CSS 4.3.3 with `@tailwindcss/vite` in `packages/workbench`.
- The theme is generated from `design/tokens/tokens.css` by `design/scripts/build-tailwind.mjs` into `packages/workbench/src/browser/design/tailwind.css`. Every colour, spacing, type, radius, weight and leading utility resolves to a token variable (`bg-panel` → `var(--panel)`, `p-4` → `var(--space-4)`), so light and dark themes keep switching through the tokens.
- Tailwind's default palette and preflight are not loaded (`--*: initial`, utilities only), so no value outside the tokens can appear. `base.css` sits in `@layer base`, below the utilities.
- ESLint bans arbitrary values for type, spacing, radius and fonts (`p-[13px]`); raw colours stay banned. Layout sizes (`w-[240px]`) are allowed, as plain CSS allowed them.
- CSS modules are removed screen by screen, with before/after screenshots of every screen in both themes.

## Consequences

- Changing a token means rerunning the generator. The generated file is not hand-edited.
- During the migration, CSS modules and utilities coexist. Modules are unlayered and win over utilities, so a component is migrated whole, never half.
