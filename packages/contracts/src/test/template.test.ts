import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { SpecFile } from '../common/index.js';

describe('docs/specs/templates/spec.md', () => {
  it('front matter passes the SpecFile schema', () => {
    const path = fileURLToPath(new URL('../../../../docs/specs/templates/spec.md', import.meta.url));
    const text = readFileSync(path, 'utf8');
    const fm = text.split(/^---$/m)[1];
    const r = SpecFile.safeParse(parse(fm ?? ''));
    if (!r.success) console.error(r.error.issues);
    expect(r.success).toBe(true);
  });
});
