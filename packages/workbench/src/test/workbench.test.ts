import { describe, expect, it } from 'vitest';
import { name } from '../common/index.js';

describe('@orchagents/workbench', () => {
  it('loads successfully', () => {
    expect(name).toBe('@orchagents/workbench');
  });
});
