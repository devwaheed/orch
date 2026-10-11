import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OrchEvent } from '@orch/contracts';
import { ConfigService } from './configService.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../../test/fixtures/config');
const fixture = (name: string): string => readFileSync(join(fixtures, name), 'utf8');

const DEBOUNCE_MS = 10;

let folder: string;
let filePath: string;
const services: ConfigService[] = [];

function makeService(): ConfigService {
  const service = new ConfigService({ filePath, watchDebounceMs: DEBOUNCE_MS });
  services.push(service);
  return service;
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'orch-config-'));
  filePath = join(folder, 'accounts.yaml');
});

afterEach(async () => {
  for (const service of services.splice(0)) {
    service.dispose();
  }
  await rm(folder, { recursive: true, force: true });
});

describe('ConfigService: app edits and round trips', () => {
  it('keeps comments and key order when the app changes a value', async () => {
    await writeFile(filePath, fixture('full.yaml'), 'utf8');
    const app = makeService();
    expect((await app.start()).ok).toBe(true);

    const changed = await app.setValue(['routing'], 'primary-first');
    expect(changed.ok).toBe(true);

    const text = await readFile(filePath, 'utf8');
    expect(text).toContain('# orch accounts. Edit this file or change values in the app; both keep the same rules.');
    // yaml re-spaces inline comments on write; the comment text itself is kept.
    expect(text).toContain('routing: primary-first # primary-first | most-headroom');
    expect(text).toContain('# slug: lowercase letters, digits, single dashes');
    expect(text.indexOf('routing:')).toBeLessThan(text.indexOf('accounts:'));
    expect(text.indexOf('limits:')).toBeLessThan(text.indexOf('share_skills:'));
  });

  it('round trips: app edit to file, then a fresh service reads the same value back', async () => {
    await writeFile(filePath, fixture('full.yaml'), 'utf8');
    const app = makeService();
    await app.start();
    await app.setValue(['limits', 'max_runs_per_account'], 7);
    await app.setValue(['share_skills', 'gemini'], true);

    const reader = makeService();
    const read = await reader.start();
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.parsed.limits.max_runs_per_account).toBe(7);
    expect(read.value.parsed.share_skills).toEqual({ claude: true, codex: false, gemini: true });
    expect(read.value.text).toContain('max_runs_per_account: 7 # 1 to 20');
    expect(read.value.text).toContain('# one switch for all agents, or one per agent');
  });

  it('round trips a full text edit (setText) with its comments intact', async () => {
    const app = makeService();
    const text = fixture('boolean-and-percent.yaml');
    const saved = await app.setText(text);
    expect(saved.ok).toBe(true);
    expect(await readFile(filePath, 'utf8')).toBe(text);

    const reader = makeService();
    const read = await reader.start();
    expect(read.ok && read.value.text).toBe(text);
  });

  it('creates the file with defaults-plus-change when it does not exist yet', async () => {
    const app = makeService();
    const first = await app.start();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.text).toBe('');
    expect(first.value.parsed.routing).toBe('primary-first');

    const saved = await app.setValue(['routing'], 'most-headroom');
    expect(saved.ok).toBe(true);
    expect(await readFile(filePath, 'utf8')).toContain('routing: most-headroom');
  });

  it('refuses a value the schema rejects, reports its line, and leaves the file untouched', async () => {
    await writeFile(filePath, fixture('full.yaml'), 'utf8');
    const before = await readFile(filePath, 'utf8');
    const app = makeService();
    await app.start();

    const result = await app.setValue(['routing'], 'fastest');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('validation_failed');
    // Line 1 of full.yaml is a comment, so the routing key is on line 2.
    expect(result.error.details?.fields).toEqual([expect.objectContaining({ path: 'routing', line: 2 })]);
    expect(await readFile(filePath, 'utf8')).toBe(before);
  });

  it('refuses setText with invalid YAML and keeps the last good config', async () => {
    await writeFile(filePath, fixture('full.yaml'), 'utf8');
    const app = makeService();
    await app.start();
    const good = app.current();

    const result = await app.setText(fixture('syntax-error.yaml'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details?.fields).toEqual([expect.objectContaining({ line: 6 })]);
    expect(app.current()).toBe(good);
    expect(await readFile(filePath, 'utf8')).toBe(fixture('full.yaml'));
  });
});

describe('ConfigService: outside edits and the watcher', () => {
  it('emits config.changed with source file when an editor changes the parsed config', async () => {
    await writeFile(filePath, fixture('full.yaml'), 'utf8');
    const app = makeService();
    await app.start();
    const events: OrchEvent[] = [];
    app.onDidChange((event) => events.push(event));

    await writeFile(filePath, fixture('full.yaml').replace('routing: most-headroom', 'routing: primary-first'), 'utf8');

    await waitFor(() => events.length > 0);
    expect(events).toEqual([{ type: 'config.changed', source: 'file' }]);
    expect(app.current()?.parsed.routing).toBe('primary-first');
  });

  it('emits when an editor saves by writing a new file and renaming it over the old one', async () => {
    await writeFile(filePath, fixture('full.yaml'), 'utf8');
    const app = makeService();
    await app.start();
    const events: OrchEvent[] = [];
    app.onDidChange((event) => events.push(event));

    const temporary = join(folder, 'accounts.yaml.swap');
    await writeFile(temporary, fixture('full.yaml').replace('use: false', 'use: true'), 'utf8');
    await rename(temporary, filePath);

    await waitFor(() => events.length > 0);
    expect(events).toEqual([{ type: 'config.changed', source: 'file' }]);
    expect(app.current()?.parsed.accounts.claude?.['personal-2']).toEqual({ use: true });
  });

  it('does not emit for a comment-only edit, because the parsed config did not change', async () => {
    await writeFile(filePath, fixture('full.yaml'), 'utf8');
    const app = makeService();
    await app.start();
    const events: OrchEvent[] = [];
    app.onDidChange((event) => events.push(event));

    await writeFile(filePath, fixture('full.yaml').replace('# whole number, 1 to 100', '# edited'), 'utf8');
    await pause(100);
    // A real change afterwards proves the watcher has run; its event must be the first one.
    await writeFile(filePath, fixture('full.yaml').replace('routing: most-headroom', 'routing: primary-first'), 'utf8');
    await waitFor(() => events.length > 0);

    expect(events).toHaveLength(1);
  });

  it('keeps the last good config when an outside edit is invalid, and reports the line', async () => {
    await writeFile(filePath, fixture('full.yaml'), 'utf8');
    const app = makeService();
    await app.start();
    const good = app.current();
    const events: OrchEvent[] = [];
    app.onDidChange((event) => events.push(event));

    await writeFile(filePath, fixture('syntax-error.yaml'), 'utf8');
    await waitFor(() => app.lastError() !== null);

    expect(app.current()).toBe(good);
    expect(events).toEqual([]);
    const error = app.lastError();
    expect(error?.code).toBe('validation_failed');
    expect(error?.details?.fields).toEqual([expect.objectContaining({ line: 6 })]);

    // Fixing the file clears the error and emits the new config.
    await writeFile(filePath, fixture('full.yaml').replace('routing: most-headroom', 'routing: primary-first'), 'utf8');
    await waitFor(() => events.length > 0);
    expect(app.lastError()).toBeNull();
    expect(app.current()?.parsed.routing).toBe('primary-first');
  });

  it('emits source app once for an app save, and does not emit again for its own write', async () => {
    await writeFile(filePath, fixture('full.yaml'), 'utf8');
    const app = makeService();
    await app.start();
    const events: OrchEvent[] = [];
    app.onDidChange((event) => events.push(event));

    await app.setValue(['routing'], 'primary-first');
    await pause(100);

    expect(events).toEqual([{ type: 'config.changed', source: 'app' }]);
  });

  it('stops watching after dispose', async () => {
    await writeFile(filePath, fixture('full.yaml'), 'utf8');
    const app = makeService();
    await app.start();
    const events: OrchEvent[] = [];
    app.onDidChange((event) => events.push(event));
    app.dispose();

    await writeFile(filePath, fixture('full.yaml').replace('routing: most-headroom', 'routing: primary-first'), 'utf8');
    await pause(100);

    expect(events).toEqual([]);
  });
});
