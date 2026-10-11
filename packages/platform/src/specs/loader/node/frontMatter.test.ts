import { describe, expect, it } from 'vitest';
import { parseSpecContent } from './frontMatter.js';

describe('parseSpecContent', () => {
  it('parses valid front matter and extracts body', () => {
    const content = `---
id: "42"
title: "Callback tests"
depends_on: ["41"]
scope: ["test/auth/**"]
done_when:
  - by: audit
    text: "Status 400"
---
Goal description here.
`;
    const res = parseSpecContent(content, 'docs/specs/042-callback.md');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.spec.id).toBe('42');
      expect(res.data.spec.title).toBe('Callback tests');
      expect(res.data.spec.depends_on).toEqual(['41']);
      expect(res.data.spec.scope).toEqual(['test/auth/**']);
      expect(res.data.spec.agent).toBe('auto');
      expect(res.data.body).toBe('Goal description here.');
    }
  });

  it('reports missing front matter with exact problem format', () => {
    const content = '# No front matter';
    const res = parseSpecContent(content, 'docs/specs/001-story.md');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.problem.code).toBe('invalid_front_matter');
      expect(res.problem.file).toBe('docs/specs/001-story.md');
      expect(res.problem.message).toBe(
        'docs/specs/001-story.md: missing front matter. See docs/specs/templates/spec.md.',
      );
    }
  });

  it('reports unclosed front matter', () => {
    const content = '---\nid: "1"\ntitle: "Unclosed"';
    const res = parseSpecContent(content, 'docs/specs/001-story.md');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.problem.code).toBe('invalid_front_matter');
      expect(res.problem.message).toBe(
        'docs/specs/001-story.md: unclosed front matter. See docs/specs/templates/spec.md.',
      );
    }
  });

  it('reports YAML syntax error', () => {
    const content = `---
id: [unclosed list
---
`;
    const res = parseSpecContent(content, 'docs/specs/001-syntax.md');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.problem.code).toBe('invalid_front_matter');
      expect(res.problem.message).toContain('docs/specs/001-syntax.md:');
      expect(res.problem.message).toContain('See docs/specs/templates/spec.md.');
    }
  });

  it('reports schema errors (missing done_when)', () => {
    const content = `---
id: "1"
title: "No criteria"
---
`;
    const res = parseSpecContent(content, 'docs/specs/001-story.md');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.problem.code).toBe('invalid_front_matter');
      expect(res.problem.message).toBe(
        'docs/specs/001-story.md: done_when: Required. See docs/specs/templates/spec.md.',
      );
    }
  });

  it('reports unrecognized keys', () => {
    const content = `---
id: "1"
title: "Extra key"
extra: "bad"
done_when:
  - by: audit
    text: "Pass"
---
`;
    const res = parseSpecContent(content, 'docs/specs/001-story.md');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.problem.code).toBe('invalid_front_matter');
      expect(res.problem.message).toContain("Unrecognized key(s) in object: 'extra'");
      expect(res.problem.message).toContain('See docs/specs/templates/spec.md.');
    }
  });
});
