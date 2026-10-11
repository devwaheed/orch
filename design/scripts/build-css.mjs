// Rebuilds design/tokens/tokens.css from tokens.json. Run: node design/scripts/build-css.mjs
// Keeps the group order and comments stable so diffs stay readable.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tok = JSON.parse(readFileSync(join(root, 'tokens/tokens.json'), 'utf8')).color;
const groups=[
 ['Surfaces (backgrounds, from page to raised)',['bg','chrome','chrome2','panel','panel2','card','btn','raised','neutral','active','sel','rowsel','seg','term']],
 ['Lines and borders',['line','line2','btnline','kbdline','strongline']],
 ['Text (strongest to faintest)',['text','text2','text3','muted','muted2','faint','faint2','disabled','lnum']],
 ['Status: success / verified / available',['ok','ok-bg','ok-dot','ok-diff','ok-strong']],
 ['Status: warning / limited / paused',['warn','warn-bg','warn-bg2','warn-solid','warn-line','warn-text','warn-strong','warn-soft','warn-bar','on-warn','on-badge']],
 ['Status: error / refuted / signed out',['err','err-bg','err-dot','err-line','err-diff','err-strong']],
 ['Status: info / running',['info','info-bg','info-dot','info-line','info-tool','info-strong']],
 ['Diff hunks and spawn events',['hunk-bg','hunk','spawn']],
 ['Agent badges (one pair per agent; never reuse for anything else)',['cc-bg','cc-fg','cx-bg','cx-fg','gm-bg','gm-fg','oc-bg','oc-fg','ag-bg','ag-fg']],
 ['Effects',['overlay','shadow']]
];
const used=new Set(groups.flatMap(g=>g[1]));
const missing=Object.keys(tok.dark).filter(k=>!used.has(k));
if(missing.length) throw new Error('unmapped '+missing);
const block=(theme)=>groups.map(([title,keys])=>`  /* ${title} */\n`+keys.map(k=>`  --${k}: ${tok[theme][k]};`).join('\n')).join('\n\n');
const css=`/*
 * orch design tokens — generated from the design canvas. Do not hand-edit values;
 * change the design first, then regenerate. Every colour in the app must come
 * from these variables (enforced by lint, see design/lint/).
 *
 * Theme: set data-theme="dark" | "light" on <html>. Dark is the default.
 */

:root,
[data-theme="dark"] {
  color-scheme: dark;

  /* Accent (buttons, focus, selection marks) */
  --accent: #7AA7FF;
  --on-accent: #0B1424;
  --focus: var(--accent);

${block('dark')}
}

[data-theme="light"] {
  color-scheme: light;

  --accent: #2F6FEB;
  --on-accent: #FFFFFF;
  --focus: var(--accent);

${block('light')}
}

/* Follow the operating system when the user hasn't picked a theme */
@media (prefers-color-scheme: light) {
  :root:not([data-theme]) {
    color-scheme: light;
    --accent: #2F6FEB;
    --on-accent: #FFFFFF;
${Object.entries(tok.light).map(([k,v])=>`    --${k}: ${v};`).join('\n')}
  }
}

:root {
  /* Type: two families only */
  --font-sans: 'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', Consolas, ui-monospace, monospace;

  /* Type scale (px). Use these steps only. */
  --text-2xs: 10.5px;  /* badges, tiny meta */
  --text-xs: 11.5px;   /* secondary meta, captions */
  --text-sm: 12px;     /* dense UI text, buttons */
  --text-base: 13px;   /* default body */
  --text-md: 14px;     /* section headings */
  --text-lg: 15px;     /* panel titles */
  --text-xl: 20px;     /* page titles */
  --text-2xl: 26px;    /* stat numbers */
  --leading: 1.45;
  --leading-code: 1.65;

  /* Weights */
  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;

  /* Spacing (px). Use these steps only. */
  --space-1: 4px;
  --space-2: 6px;
  --space-3: 8px;
  --space-4: 10px;
  --space-5: 12px;
  --space-6: 14px;
  --space-7: 16px;
  --space-8: 20px;
  --space-9: 24px;
  --space-10: 28px;

  /* Radius */
  --radius-xs: 4px;    /* key caps, tiny tiles */
  --radius-sm: 6px;    /* small buttons, tabs */
  --radius-md: 8px;    /* buttons, inputs, rows */
  --radius-lg: 10px;   /* cards, notices */
  --radius-xl: 12px;   /* panels, sections */
  --radius-2xl: 14px;  /* dialogs */
  --radius-pill: 999px;

  /* Fixed layout sizes from the design */
  --titlebar-h: 48px;
  --statusbar-h: 28px;
  --activitybar-w: 56px;
  --sidebar-w: 264px;
  --capacity-w: 288px;
  --tab-h: 38px;
  --hit-min: 32px;     /* smallest clickable size; prefer 44px for primary targets */
}
`;
writeFileSync(join(root, 'tokens/tokens.css'), css);
console.log('tokens.css rebuilt');
