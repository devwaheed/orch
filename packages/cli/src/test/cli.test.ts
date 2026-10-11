import { describe, expect, it } from 'vitest';
import { name } from '../common/index.js';

describe('@orch/cli', () => {
  it('loads successfully', () => {
    expect(name).toBe('@orch/cli');
  });
});
