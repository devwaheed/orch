import { describe, expect, it } from 'vitest';
import { formatResetTime, maskEmail } from '../../src/browser/contrib/accounts/format.js';

describe('maskEmail (ACC-04)', () => {
  it('keeps the first character, then •••, @ and the domain', () => {
    expect(maskEmail('davidhenry@gmail.com')).toBe('d•••@gmail.com');
  });

  it('masks an unmasked address the core did not mask', () => {
    expect(maskEmail('ab@acme.dev')).toBe('a•••@acme.dev');
  });

  it('leaves an already masked address as it is', () => {
    expect(maskEmail('a•••@acme.dev')).toBe('a•••@acme.dev');
  });

  it('returns undefined for missing or malformed values', () => {
    expect(maskEmail(undefined)).toBeUndefined();
    expect(maskEmail('')).toBeUndefined();
    expect(maskEmail('no-at-sign')).toBeUndefined();
    expect(maskEmail('name@')).toBeUndefined();
  });

  it('never returns the full local part', () => {
    const masked = maskEmail('secretname@example.com') ?? '';
    expect(masked.includes('secretname')).toBe(false);
  });
});

describe('formatResetTime', () => {
  it('shows local 24-hour HH:mm', () => {
    const iso = new Date(2026, 9, 11, 15, 0).toISOString();
    expect(formatResetTime(iso)).toBe('15:00');
    expect(formatResetTime(new Date(2026, 9, 11, 7, 5).toISOString())).toBe('07:05');
  });

  it('returns null when the time is unknown or invalid', () => {
    expect(formatResetTime(null)).toBeNull();
    expect(formatResetTime(undefined)).toBeNull();
    expect(formatResetTime('not a date')).toBeNull();
  });
});
