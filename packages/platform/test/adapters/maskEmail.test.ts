import { describe, expect, it } from 'vitest';
import { maskEmail } from '../../src/adapters/common/maskEmail.js';

describe('maskEmail (LOCKED ACC-04)', () => {
  it('masks standard email with first character, •••, @, domain', () => {
    expect(maskEmail('alex@acme.dev')).toBe('a•••@acme.dev');
    expect(maskEmail('devwaheed@gmail.com')).toBe('d•••@gmail.com');
  });

  it('handles single character local part', () => {
    expect(maskEmail('a@acme.dev')).toBe('a•••@acme.dev');
  });

  it('handles empty local part', () => {
    expect(maskEmail('@acme.dev')).toBe('•••@acme.dev');
  });

  it('handles already masked emails idempotently', () => {
    expect(maskEmail('a•••@acme.dev')).toBe('a•••@acme.dev');
  });

  it('handles subdomain email addresses', () => {
    expect(maskEmail('john.doe@corp.example.co.uk')).toBe('j•••@corp.example.co.uk');
  });

  it('handles strings without @', () => {
    expect(maskEmail('admin')).toBe('a•••');
    expect(maskEmail('')).toBe('•••');
  });
});
