import { describe, expect, it } from 'vitest';
import { err, ok } from '../common/index.js';

describe('Result helpers', () => {
  it('ok wraps a value', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('err wraps an error', () => {
    expect(err('nope')).toEqual({ ok: false, error: 'nope' });
  });
});
