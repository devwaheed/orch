import { describe, expect, it } from 'vitest';
import { parseMarkdown, slugHeading, themedImagePath } from '../src/browser/contrib/help/markdown.js';

describe('help markdown', () => {
  it('parses headings with stable slugs', () => {
    expect(slugHeading('A **Good** Guide!')).toBe('a-good-guide');
    expect(parseMarkdown('# Hello, world!')[0]).toEqual({ type: 'heading', level: 1, text: 'Hello, world!', id: 'hello-world' });
  });
  it('parses one nested list level', () => {
    expect(parseMarkdown('- one\n  - child\n- two')[0]).toMatchObject({ type: 'list', items: [{ nested: { items: [[{ type: 'text', value: 'child' }]] } }, {}] });
  });
  it('parses a simple pipe table and fenced code block', () => {
    expect(parseMarkdown('| Name | Value |\n| --- | --- |\n| a | b |')[0]?.type).toBe('table');
    expect(parseMarkdown('```ts\nconst x = 1;\n```')[0]).toEqual({ type: 'code', language: 'ts', value: 'const x = 1;' });
  });
  it('resolves both themed image names', () => {
    expect(themedImagePath('images/work.jpg', 'light')).toBe('images/work-light.jpg');
    expect(themedImagePath('images/work.jpg', 'dark')).toBe('images/work-dark.jpg');
  });
  it('parses diagram directives and distinguishes internal and external links', () => {
    expect(parseMarkdown('[[diagram:job-flow]]')[0]).toEqual({ type: 'diagram', name: 'job-flow' });
    const block = parseMarkdown('[page](other.md) [section](other.md#anchor) [site](https://example.com)')[0];
    expect(block).toMatchObject({ type: 'paragraph', children: [{ type: 'link', internal: true, target: 'other.md' }, { type: 'text', value: ' ' }, { type: 'link', internal: true, target: 'other.md#anchor' }, { type: 'text', value: ' ' }, { type: 'link', internal: false, target: 'https://example.com' }] });
  });
});
