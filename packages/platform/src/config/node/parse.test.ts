import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OrchError } from '@orch/contracts';
import { parseAccountsYaml } from './parse.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../../test/fixtures/config');
const fixture = (name: string): string => readFileSync(join(fixtures, name), 'utf8');

function fieldsOf(error: OrchError | undefined): { path: string; line: number | null; message: string }[] {
  const fields = error?.details?.fields;
  expect(Array.isArray(fields)).toBe(true);
  return fields as { path: string; line: number | null; message: string }[];
}

describe('parseAccountsYaml: valid files', () => {
  it('parses a file that sets every field', () => {
    const result = parseAccountsYaml(fixture('full.yaml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parsed).toEqual({
      routing: 'most-headroom',
      accounts: {
        claude: { team: { primary: true, use: true }, 'personal-2': { use: false } },
        codex: { work: { primary: true } },
        gemini: { default: { primary: true } },
        opencode: {},
        agy: { main: { primary: true } },
      },
      limits: { max_runs_per_account: 5, near_limit_at: 90 },
      share_skills: { claude: true, codex: false },
    });
    expect(result.value.text).toBe(fixture('full.yaml'));
  });

  it('accepts the other forms of the same fields: a percent string and one boolean for skills', () => {
    const result = parseAccountsYaml(fixture('boolean-and-percent.yaml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parsed.limits).toEqual({ max_runs_per_account: 1, near_limit_at: '90%' });
    expect(result.value.parsed.share_skills).toBe(false);
    expect(result.value.parsed.routing).toBe('primary-first');
  });

  it('fills every default when the file sets nothing (a comment-only file)', () => {
    const result = parseAccountsYaml(fixture('empty.yaml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parsed).toEqual({
      routing: 'primary-first',
      accounts: {},
      limits: { max_runs_per_account: 3, near_limit_at: '85%' },
      share_skills: true,
    });
  });

  it('treats a completely empty file as all defaults', () => {
    const result = parseAccountsYaml('');
    expect(result.ok && result.value.parsed.routing).toBe('primary-first');
  });
});

describe('parseAccountsYaml: field-level errors with line numbers', () => {
  it('reports a bad enum at its line', () => {
    const result = parseAccountsYaml('routing: fastest\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('validation_failed');
    expect(fieldsOf(result.error)).toEqual([
      expect.objectContaining({ path: 'routing', line: 1 }),
    ]);
    expect(result.error.message).toContain('line 1');
    expect(result.error.fix).toBeTruthy();
  });

  it('reports an unknown key at the key itself, not at its parent', () => {
    const result = parseAccountsYaml('routing: primary-first\n\nmystery: 1\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(fieldsOf(result.error)).toEqual([expect.objectContaining({ path: 'mystery', line: 3 })]);
  });

  it('reports an out-of-range number and a bad percent string at their own lines', () => {
    const result = parseAccountsYaml(
      ['limits:', '  max_runs_per_account: 0', '  near_limit_at: "101%"', ''].join('\n'),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const fields = fieldsOf(result.error);
    expect(fields.map((f) => [f.path, f.line])).toEqual([
      ['limits.max_runs_per_account', 2],
      ['limits.near_limit_at', 3],
    ]);
  });

  it('reports an invalid account slug at the slug line', () => {
    const result = parseAccountsYaml(
      ['accounts:', '  claude:', '    Second Account:', '      primary: true', ''].join('\n'),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(fieldsOf(result.error)).toEqual([
      expect.objectContaining({ path: 'accounts.claude.Second Account', line: 3 }),
    ]);
  });

  it('reports a second primary for one agent at the agent line', () => {
    const result = parseAccountsYaml(
      [
        'accounts:',
        '  codex:',
        '    work:',
        '      primary: true',
        '    home:',
        '      primary: true',
        '',
      ].join('\n'),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(fieldsOf(result.error)).toEqual([
      { path: 'accounts.codex', line: 2, message: 'Only one codex account can be primary.' },
    ]);
  });

  it('reports every problem in a file, sorted by line', () => {
    const result = parseAccountsYaml(fixture('schema-errors.yaml'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const fields = fieldsOf(result.error);
    expect(fields.map((f) => f.line)).toEqual([1, 6, 13, 15, 16, 17, 18]);
    const lines = fields.map((f) => f.line ?? 0);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(fields.find((f) => f.path === 'routing')?.line).toBe(1);
    expect(fields.find((f) => f.path === 'mystery')?.line).toBe(18);
    expect(result.error.message).toContain(`${fields.length} problems`);
  });

  it('reports a YAML syntax error at its line', () => {
    const result = parseAccountsYaml(fixture('syntax-error.yaml'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('validation_failed');
    expect(fieldsOf(result.error)).toEqual([expect.objectContaining({ line: 6 })]);
  });

  it('rejects a file whose top level is not a mapping', () => {
    const result = parseAccountsYaml('- one\n- two\n');
    expect(result.ok).toBe(false);
  });
});
