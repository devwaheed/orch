import { describe, expect, it } from 'vitest';
import { accountsStrings } from './strings.js';

describe('shared skills copy', () => {
  it('includes the prototype sample skill in demo mode only', () => {
    expect(accountsStrings.agent.skillsShared(12, 'Claude Code', true)).toBe(
      '12 skills (incl. saas-factory) shared with all Claude Code accounts from',
    );
    expect(accountsStrings.agent.skillsShared(12, 'Claude Code')).toBe(
      '12 skills shared with all Claude Code accounts from',
    );
  });
});
