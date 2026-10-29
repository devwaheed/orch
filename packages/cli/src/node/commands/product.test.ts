import { describe, expect, it } from 'vitest';
import { ok } from '@orchagents/base';
import type { FactoryPipeline, ISpecsService } from '@orchagents/contracts';
import type { CliServices } from '../client.js';
import { productGateCommand, productStatusCommand } from './product.js';

const pipeline: FactoryPipeline = {
  product: 'demo',
  stages: [{ id: 'brief', title: 'Brief', group: 'planning', state: 'done', answer: null }],
  counts: { total: 1, done: 1, next: 0, needs_you: 0, left: 0, gates_ahead: 0 },
  groups: { planning: { total: 1, done: 1, next: 0, needs_you: 0, left: 0, gates_ahead: 0 } },
  now: null,
};

function services(): CliServices {
  const specs = {
    factoryPipeline: async () => ok(pipeline),
    answerFactoryGate: async () => ok(pipeline),
  } as unknown as ISpecsService;
  const client = { getService: () => specs };
  return { client } as unknown as CliServices;
}

describe('orch product CLI', () => {
  it('prints the pipeline status table', async () => {
    const output: string[] = [];
    expect(await productStatusCommand(services(), '/repo', false, (line) => output.push(line))).toBe(0);
    expect(output[0]).toContain('Brief');
    expect(output[0]).toContain('planning');
  });

  it('records a gate answer and prints the refreshed table', async () => {
    const output: string[] = [];
    expect(await productGateCommand(services(), '/repo', 'confirm-brief', 'yes', (line) => output.push(line))).toBe(0);
    expect(output[0]).toContain('Brief');
  });
});
