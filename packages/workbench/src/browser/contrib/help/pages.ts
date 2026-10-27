/// <reference types="vite/client" />
/** The help pages the app bundles from docs-site/ (the single source; see AGENTS.md "Help pages are live docs"). */
import { parseMarkdown } from './markdown.js';

export const docs = import.meta.glob('../../../../../../docs-site/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
export const pageKey = (filename: string) => `../../../../../../docs-site/${filename}`;
const readme = docs[pageKey('README.md')] ?? '';
const pageNames = [...readme.matchAll(/^\d+\. \[([^\]]+)\]\(([^)]+\.md)\)/gm)].map((m) => ({ label: m[1] ?? '', file: m[2] ?? '' }));
export const pages = [{ label: 'orch user guide', file: 'README.md', title: 'orch user guide', source: readme, blocks: parseMarkdown(readme) }, ...pageNames.map((item) => {
  const source = docs[pageKey(item.file)] ?? '';
  const title = /^#\s+(.+)$/m.exec(source)?.[1] ?? item.label;
  return { ...item, title, source, blocks: parseMarkdown(source) };
}).filter((page) => page.source)];
