// Regenerates design/tokens/tokens.json and design/icons/icons.ts from the prototype.
// Run after the design canvas changes and design/prototype/Main.dc.html is re-exported:
//   node design/scripts/extract-tokens.mjs
// tokens.css is then rebuilt from tokens.json by design/scripts/build-css.mjs (same repo).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'prototype/Main.dc.html'), 'utf8');

const tok = JSON.parse(src.match(/const TOK = (\{.*?\});\n/s)[1]);
const icSrc = src.match(/const ic = (\{[\s\S]*?\n {4}\});/)[1];
const ic = Function(`return (${icSrc});`)();

const accent = { dark: { accent: '#7AA7FF', onAccent: '#0B1424' }, light: { accent: '#2F6FEB', onAccent: '#FFFFFF' } };
writeFileSync(join(root, 'tokens/tokens.json'), JSON.stringify({ accent, color: tok }, null, 2));
writeFileSync(
  join(root, 'icons/icons.ts'),
  `// orch icon set — generated from the design canvas. 24×24 viewBox, stroked paths.\n// Use ONLY these icons (enforced by lint). To add one, add it to the design first.\nexport const iconPaths = ${JSON.stringify(ic, null, 2)} as const;\n\nexport type IconName = keyof typeof iconPaths;\n\n/** Icons drawn filled instead of stroked. */\nexport const filledIcons: ReadonlySet<IconName> = new Set<IconName>(['playFill', 'starFill']);\n`
);
console.log(`tokens: ${Object.keys(tok.dark).length} per theme, icons: ${Object.keys(ic).length}`);
