import { describe, expect, it } from 'vitest';
import type { ConfigFieldError } from '@orch/contracts';
import {
  findLineForPath,
  markErrors,
  numberedLines,
  parseFieldErrors,
  reconcileDraft,
} from '../../src/browser/contrib/accounts/configFile.js';

const yaml = [
  '# Everything orch needs.',
  '',
  'routing: primary-first',
  '',
  'accounts:',
  '  claude:',
  '    work: {}',
  '',
  'limits:',
  '  max_runs_per_account: 3',
  '  near_limit_at: 85%',
].join('\n');

describe('findLineForPath', () => {
  it('finds the line that declares the last segment of a dot path', () => {
    expect(findLineForPath(yaml, 'limits.max_runs_per_account')).toBe(10);
    expect(findLineForPath(yaml, 'routing')).toBe(3);
    expect(findLineForPath(yaml, 'accounts.claude.work')).toBe(7);
  });

  it('returns null when no line declares the key', () => {
    expect(findLineForPath(yaml, 'limits.missing')).toBeNull();
    expect(findLineForPath(yaml, '')).toBeNull();
  });

  it('escapes regular-expression characters in keys', () => {
    expect(findLineForPath('b+c: 1\nbbc: 2', 'a.b+c')).toBe(1);
  });
});

describe('markErrors', () => {
  it('uses the error line when the core sends one', () => {
    const errors: ConfigFieldError[] = [{ path: 'routing', line: 3, message: 'Unknown routing rule.' }];
    const marks = markErrors(yaml, errors);
    expect(marks.byLine.get(3)).toEqual(['Unknown routing rule.']);
    expect(marks.fileLevel).toEqual([]);
  });

  it('finds the line from the path when the error has no line', () => {
    const errors: ConfigFieldError[] = [
      { path: 'limits.max_runs_per_account', line: null, message: 'Must be a whole number from 1 to 20.' },
    ];
    expect(markErrors(yaml, errors).byLine.get(10)).toEqual(['Must be a whole number from 1 to 20.']);
  });

  it('keeps errors without a usable line at file level', () => {
    const errors: ConfigFieldError[] = [
      { path: '', line: null, message: 'The file is empty.' },
      { path: 'limits.missing', line: null, message: 'Unknown key.' },
      { path: 'routing', line: 999, message: 'Past the end.' },
    ];
    const marks = markErrors(yaml, errors);
    expect(marks.byLine.size).toBe(0);
    expect(marks.fileLevel).toEqual(['The file is empty.', 'Unknown key.', 'Past the end.']);
  });

  it('collects several messages on one line', () => {
    const errors: ConfigFieldError[] = [
      { path: 'routing', line: 3, message: 'First.' },
      { path: 'routing', line: 3, message: 'Second.' },
    ];
    expect(markErrors(yaml, errors).byLine.get(3)).toEqual(['First.', 'Second.']);
  });
});

describe('parseFieldErrors', () => {
  it('reads valid entries from details.errors and drops malformed ones', () => {
    const details = {
      errors: [
        { path: 'routing', line: 3, message: 'Unknown routing rule.' },
        { path: 'routing', line: 'three', message: 'Bad line type.' },
        { message: 'No path.' },
      ],
    };
    expect(parseFieldErrors(details)).toEqual([{ path: 'routing', line: 3, message: 'Unknown routing rule.' }]);
  });

  it('returns an empty list when details has no errors', () => {
    expect(parseFieldErrors(undefined)).toEqual([]);
    expect(parseFieldErrors({ other: true })).toEqual([]);
  });
});

describe('reconcileDraft (visual and config file stay in sync)', () => {
  it('follows the core text while the draft is clean', () => {
    expect(reconcileDraft({ serverText: 'routing: most-headroom', draft: 'old', dirty: false })).toBe(
      'routing: most-headroom',
    );
  });

  it('keeps the user edit while the draft is dirty', () => {
    expect(reconcileDraft({ serverText: 'routing: primary-first', draft: 'routing: x', dirty: true })).toBe(
      'routing: x',
    );
  });
});

describe('numberedLines', () => {
  it('numbers each line from 1', () => {
    expect(numberedLines('a\nb')).toEqual([
      { n: 1, text: 'a' },
      { n: 2, text: 'b' },
    ]);
  });
});
