import { expect, it } from 'vitest';
import { failure } from './engineHost.js';

it('keeps the redacted first line from a plain Claw session error', () => {
  expect(failure(new Error('Could not read /Users/tester/private/token\nmore detail'), { HOME: '/Users/tester' })).toMatchObject({
    code: 'internal',
    message: 'Could not read ~/private/token',
  });
});
