import { describe, expect, it } from 'vitest';
import { name } from '../common/index.js';

describe('@orch/app', () => {
  it('loads successfully', () => {
    expect(name).toBe('@orch/app');
  });
});
