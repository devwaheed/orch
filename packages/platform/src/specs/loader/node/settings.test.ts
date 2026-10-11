import { SPEC_QUEUE_DEFAULTS } from '@orch/contracts';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSpecQueueSettings } from './settings.js';

describe('loadSpecQueueSettings', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'orch-settings-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns locked defaults when .orch/specs.yaml is missing', async () => {
    const res = await loadSpecQueueSettings(tmpDir);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.source).toBe('docs/specs');
      expect(res.value.order).toBe(SPEC_QUEUE_DEFAULTS.order);
      expect(res.value.advance).toBe(SPEC_QUEUE_DEFAULTS.advance);
      expect(res.value.on_fail).toBe(SPEC_QUEUE_DEFAULTS.onFail);
      expect(res.value.max_parallel).toBe(SPEC_QUEUE_DEFAULTS.maxParallel);
      expect(res.value.retries).toBe(SPEC_QUEUE_DEFAULTS.retries);
      expect(res.value.after_each).toEqual([]);
    }
  });

  it('parses valid custom .orch/specs.yaml', async () => {
    const orchDir = path.join(tmpDir, '.orch');
    await mkdir(orchDir, { recursive: true });
    await writeFile(
      path.join(orchDir, 'specs.yaml'),
      `source: specs/features
order: strict
advance: approved
on_fail: retry-skip
max_parallel: 1
retries: 3
after_each:
  - name: smoke
    run: npm test -- smoke
    timeout_s: 60
`,
      'utf8',
    );

    const res = await loadSpecQueueSettings(tmpDir);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.source).toBe('specs/features');
      expect(res.value.order).toBe('strict');
      expect(res.value.advance).toBe('approved');
      expect(res.value.on_fail).toBe('retry-skip');
      expect(res.value.max_parallel).toBe(1);
      expect(res.value.retries).toBe(3);
      expect(res.value.after_each).toEqual([
        { name: 'smoke', run: 'npm test -- smoke', timeout_s: 60 },
      ]);
    }
  });

  it('returns validation_failed on invalid YAML syntax', async () => {
    const orchDir = path.join(tmpDir, '.orch');
    await mkdir(orchDir, { recursive: true });
    await writeFile(path.join(orchDir, 'specs.yaml'), 'source: [unclosed', 'utf8');

    const res = await loadSpecQueueSettings(tmpDir);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('validation_failed');
    }
  });

  it('returns validation_failed on invalid schema values (e.g. max_parallel > 4)', async () => {
    const orchDir = path.join(tmpDir, '.orch');
    await mkdir(orchDir, { recursive: true });
    await writeFile(path.join(orchDir, 'specs.yaml'), 'max_parallel: 10\n', 'utf8');

    const res = await loadSpecQueueSettings(tmpDir);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('validation_failed');
    }
  });
});
