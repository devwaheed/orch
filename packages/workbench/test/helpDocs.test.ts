import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = existsSync(join(process.cwd(), 'docs-site'))
  ? process.cwd()
  : join(process.cwd(), '../..');
const readmePath = join(root, 'docs-site', 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const linkedPages = [...readme.matchAll(/^\d+\. \[[^\]]+\]\(([^)]+\.md)\)/gm)].map((match) => match[1] ?? '');
const markdownFiles = readdirSync(join(root, 'docs-site')).filter((file) => file.endsWith('.md'));
const knownDiagrams = new Set(['overview', 'job-flow', 'spec-flow', 'accounts']);
const areaPages = { work: 'specs.md', newjob: 'new-spec.md', specs: 'specs.md', review: 'review.md', sessions: 'sessions.md', trust: 'trust.md', accounts: 'accounts.md' };

function liveDocProblems(): string[] {
  const problems: string[] = [];
  for (const page of linkedPages) if (!existsSync(join(root, 'docs-site', page))) problems.push(`README.md links to missing docs-site/${page}`);
  for (const page of markdownFiles) {
    const path = join(root, 'docs-site', page);
    if (!existsSync(path)) continue;
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/!\[[^\]]*\]\(images\/([^)?]+\.jpg)\)/g)) {
      for (const theme of ['light', 'dark']) {
        const themed = (match[1] ?? '').replace(/\.jpg$/i, `-${theme}.jpg`);
        if (!existsSync(join(root, 'docs-site', 'images', themed))) problems.push(`${page} references missing images/${themed}`);
      }
    }
    for (const match of source.matchAll(/^\[\[diagram:([^\]]+)\]\]$/gm)) if (!knownDiagrams.has(match[1] ?? '')) problems.push(`${page} names unknown diagram ${match[1]}`);
  }
  for (const [area, page] of Object.entries(areaPages)) if (!existsSync(join(root, 'docs-site', page))) problems.push(`${area} help mapping is missing docs-site/${page}`);
  const shotsPath = join(root, 'docs-site', 'shots.json');
  const shots = JSON.parse(readFileSync(shotsPath, 'utf8')) as { shots: { name: string }[] };
  const allDocs = markdownFiles.map((page) => readFileSync(join(root, 'docs-site', page), 'utf8')).join('\n');
  for (const shot of shots.shots) if (!new RegExp(`images/${shot.name}(?:-[^)]*)?\\.jpg`).test(allDocs)) problems.push(`shot ${shot.name} is unused by docs-site pages`);
  return problems;
}

describe('live help docs', () => {
  it('keeps README links, themed images, diagrams, area mappings, and shots in sync; fix missing items and run pnpm help:shots', () => {
    expect(liveDocProblems(), 'Help docs are out of sync. Fix the listed files and run pnpm help:shots.').toEqual([]);
  });
});

describe('bundled help pages', () => {
  it('the app loads every page README lists, each with content', async () => {
    const { pages: helpPages } = await import('../src/browser/contrib/help/pages.js');
    const { readFileSync } = await import('node:fs');
    const readme = readFileSync(new URL('../../../docs-site/README.md', import.meta.url), 'utf8');
    const listed = [...readme.matchAll(/^\d+\. \[[^\]]+\]\(([^)]+\.md)\)/gm)].length;
    expect(helpPages.length).toBe(listed + 1);
    expect(helpPages.filter((page) => page.blocks.length === 0).map((page) => page.file)).toEqual([]);
  });
});
