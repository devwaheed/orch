/**
 * The Specs screen's read of the SaaS Factory status: stage labels and matching a spec
 * file to a delivery story.
 */
import { describe, expect, it } from 'vitest';
import type { FactoryStatus } from '@orchagents/contracts';
import {
  factoryStageLabel,
  findFactoryStory,
} from '../src/browser/contrib/specs/factoryView.js';

describe('factoryStageLabel', () => {
  it('drops the number prefix and turns dashes into words', () => {
    expect(factoryStageLabel('05-references')).toBe('references');
    expect(factoryStageLabel('02-value-map')).toBe('value map');
  });
});

describe('findFactoryStory', () => {
  it('matches a story file with and without a leading ./', () => {
    const status: FactoryStatus = {
      product: 'Acme',
      path: '/work/acme',
      done: false,
      missing: [],
      next: null,
      stages: [],
      design: [],
      delivery: {
        file: 'docs/delivery.md',
        updated: null,
        epics: [
          {
            id: '1',
            stories: [
              {
                key: '1-2-sign-in',
                status: 'in-progress',
                file: './docs/stories/1-2-sign-in.md',
                openTasks: 1,
                spec: true,
                specPath: null,
                openSpecTasks: 3,
                done: false,
                drift: null,
              },
            ],
            storiesDone: 0,
            done: false,
          },
        ],
      },
    };

    expect(findFactoryStory(status, 'docs/stories/1-2-sign-in.md')?.key).toBe('1-2-sign-in');
    expect(findFactoryStory(status, './docs/stories/1-2-sign-in.md')?.key).toBe('1-2-sign-in');
    expect(findFactoryStory(status, 'docs/stories/other.md')).toBeNull();
  });
});
