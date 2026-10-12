import { describe, expect, it } from 'vitest';
import { name } from '../common/index.js';

describe('@orchagents/platform', () => {
  it('loads successfully', () => {
    expect(name).toBe('@orchagents/platform');
  });
});
