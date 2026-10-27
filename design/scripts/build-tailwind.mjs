// Builds packages/workbench/src/browser/design/tailwind.css from design/tokens/tokens.css.
// Run: node design/scripts/build-tailwind.mjs
// Every Tailwind theme value points at a token variable, so light/dark switching and the design
// rules keep working. Tailwind's default palette and preflight are not loaded: tokens only.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(root, 'design/tokens/tokens.css'), 'utf8');
const names = [...new Set([...css.matchAll(/^\s*--([a-z0-9-]+):/gm)].map((m) => m[1]))];

const SIZES = new Set(['activitybar-w', 'sidebar-w', 'capacity-w', 'titlebar-h', 'statusbar-h', 'tab-h', 'hit-min']);
const lines = [];
for (const name of names) {
  const ref = `var(--${name})`;
  if (name.startsWith('space-')) lines.push(`  --spacing-${name.slice(6)}: ${ref};`);
  else if (SIZES.has(name)) lines.push(`  --spacing-${name}: ${ref};`);
  else if (name.startsWith('text-')) lines.push(`  --text-${name.slice(5)}: ${ref};`);
  else if (name.startsWith('radius-')) lines.push(`  --radius-${name.slice(7)}: ${ref};`);
  else if (name.startsWith('weight-')) lines.push(`  --font-weight-${name.slice(7)}: ${ref};`);
  else if (name === 'font-sans' || name === 'font-mono') lines.push(`  --${name}: ${ref};`);
  else if (name === 'leading') lines.push(`  --leading-normal: ${ref};`);
  else if (name === 'leading-code') lines.push(`  --leading-code: ${ref};`);
  else lines.push(`  --color-${name}: ${ref};`);
}

// Shadows the design uses (dialogs and popovers); colours still come from tokens.
lines.push('  --shadow-dialog: 0 24px 60px var(--shadow);');

const out = `/*
 * Tailwind theme generated from design/tokens/tokens.css by design/scripts/build-tailwind.mjs.
 * Do not hand-edit: change the tokens, then rerun the script.
 * Utilities only: no Tailwind preflight and no default palette, so every value is a token.
 */
@layer theme, base, components, utilities;
@import 'tailwindcss/utilities.css' layer(utilities);

@theme inline reference {
  --*: initial;
${lines.join('\n')}
}
`;
writeFileSync(join(root, 'packages/workbench/src/browser/design/tailwind.css'), out);
console.log(`tailwind.css: ${lines.length} theme values`);
