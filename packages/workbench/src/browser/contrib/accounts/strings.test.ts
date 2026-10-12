import { describe, expect, it } from 'vitest';
import { accountsStrings } from './strings.js';

describe('shared skills copy', () => {
  it('names saas-factory only when it is among the shared skills', () => {
    expect(accountsStrings.agent.skillsShared(12, 'Claude Code', true)).toBe(
      '12 skills (incl. saas-factory) shared with all Claude Code accounts from',
    );
    expect(accountsStrings.agent.skillsShared(12, 'Claude Code', false)).toBe(
      '12 skills shared with all Claude Code accounts from',
    );
  });
});
