import { SpecFile } from '@orchagents/contracts';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { formatBmadFrontMatter, hasFrontMatter, parseBmadStory } from './bmad.js';

describe('BMAD story parser & skeleton generator (spec-queue.md §2)', () => {
  it('detects front matter presence', () => {
    expect(hasFrontMatter('---\nid: "1"\n---\nbody')).toBe(true);
    expect(hasFrontMatter('# Story 1\n\nNo front matter')).toBe(false);
  });

  it('extracts id, title, and criteria from standard BMAD story', () => {
    const markdown = `# Story 42: Callback flow

As a user, I want callback verification.

## Acceptance Criteria
- [ ] Unknown state returns 400
- [x] Error codes match docs
* Reused PKCE verifier fails
1. Successful exchange redirects
`;
    const parsed = parseBmadStory(markdown, '042-callback.md');
    expect(parsed.id).toBe('42');
    expect(parsed.title).toBe('Callback flow');
    expect(parsed.criteria).toEqual([
      'Unknown state returns 400',
      'Error codes match docs',
      'Reused PKCE verifier fails',
      'Successful exchange redirects',
    ]);
  });

  it('extracts id from filename if heading lacks id', () => {
    const markdown = `# Integration tests

## Acceptance Criteria
- Valid token passes
`;
    const parsed = parseBmadStory(markdown, '007-integration-tests.md');
    expect(parsed.id).toBe('7');
    expect(parsed.title).toBe('Integration tests');
    expect(parsed.criteria).toEqual(['Valid token passes']);
  });

  it('generates valid front-matter skeleton that passes SpecFile contract', () => {
    const story = {
      id: '42',
      title: 'Callback flow',
      criteria: ['Unknown state returns 400', 'Error codes match docs'],
    };
    const fm = formatBmadFrontMatter(story);
    expect(fm.startsWith('---\n')).toBe(true);
    expect(fm.endsWith('\n---')).toBe(true);

    const yamlContent = fm.split(/^---$/m)[1] ?? '';
    const parsedData: unknown = parse(yamlContent);
    const checked = SpecFile.safeParse(parsedData);
    expect(checked.success).toBe(true);
    if (checked.success) {
      expect(checked.data.id).toBe('42');
      expect(checked.data.title).toBe('Callback flow');
      expect(checked.data.depends_on).toEqual([]);
      expect(checked.data.scope).toEqual([]);
      expect(checked.data.agent).toBe('auto');
      expect(checked.data.done_when).toEqual([
        { by: 'audit', text: 'Unknown state returns 400' },
        { by: 'audit', text: 'Error codes match docs' },
      ]);
    }
  });
});
