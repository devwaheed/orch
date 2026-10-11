/**
 * accounts.yaml on disk: read, validate, write (keeping comments), and watch
 * for outside edits. Every operation runs one at a time, so a watcher reload
 * never interleaves with an app write.
 */
import { randomUUID } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Emitter, err, ok, type Event } from '@orch/base';
import { ConfigFieldError, type OrchError, type OrchEvent, type Result } from '@orch/contracts';
import { parseDocument } from 'yaml';
import { sameConfig, type ConfigSnapshot, type IConfigService } from '../common/config.js';
import { parseAccountsYaml } from './parse.js';

export interface ConfigServiceOptions {
  /** Absolute path to accounts.yaml. The caller decides where it lives (ENG-03 style: ~/.orch/accounts.yaml). */
  readonly filePath: string;
  /** Quiet time after the last file event before the file is re-read. */
  readonly watchDebounceMs: number;
}

const SAVE_FAILED: OrchError = {
  code: 'internal',
  message: 'orch could not save accounts.yaml.',
  fix: 'Check that the file is not read-only, then try again.',
};

export class ConfigService implements IConfigService {
  readonly onDidChange: Event<OrchEvent>;

  private readonly emitter = new Emitter<OrchEvent>();
  private readonly filePath: string;
  private readonly folder: string;
  private readonly fileName: string;
  private lastGood: ConfigSnapshot | null = null;
  private lastInvalid: OrchError | null = null;
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ConfigServiceOptions) {
    this.filePath = options.filePath;
    this.folder = dirname(options.filePath);
    this.fileName = basename(options.filePath);
    this.onDidChange = this.emitter.event;
  }

  async start(): Promise<Result<ConfigSnapshot>> {
    const first = await this.enqueue(async () => {
      try {
        await mkdir(this.folder, { recursive: true });
      } catch {
        return err(SAVE_FAILED);
      }
      return this.loadFromDisk();
    });
    this.startWatching();
    return first;
  }

  read(): Promise<Result<ConfigSnapshot>> {
    return this.enqueue(() => this.loadFromDisk());
  }

  current(): ConfigSnapshot | null {
    return this.lastGood;
  }

  lastError(): OrchError | null {
    return this.lastInvalid;
  }

  setText(text: string): Promise<Result<ConfigSnapshot>> {
    return this.enqueue(() => this.applyText(text));
  }

  setValue(path: readonly string[], value: unknown): Promise<Result<ConfigSnapshot>> {
    return this.enqueue(async () => {
      if (path.length === 0) {
        return err({ code: 'validation_failed', message: 'Choose a setting to change.' });
      }
      const current = await this.readText();
      if (!current.ok) {
        return current;
      }
      const doc = parseDocument(current.value);
      if (doc.errors.length > 0) {
        return parseAccountsYaml(current.value);
      }
      // Changes the value in place, so comments and key order around it stay as they are.
      doc.setIn([...path], value);
      return this.applyText(doc.toString());
    });
  }

  dispose(): void {
    this.stopWatching();
    this.emitter.dispose();
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Reads the file text. A missing file counts as an empty file (all defaults). */
  private async readText(): Promise<Result<string>> {
    try {
      return ok(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (isMissingFile(error)) {
        return ok('');
      }
      return err({
        code: 'internal',
        message: 'orch could not read accounts.yaml.',
        fix: 'Check that the file is readable, then try again.',
      });
    }
  }

  private async loadFromDisk(): Promise<Result<ConfigSnapshot>> {
    const text = await this.readText();
    if (!text.ok) {
      return text;
    }
    const outcome = parseAccountsYaml(text.value);
    if (!outcome.ok) {
      this.lastInvalid = outcome.error;
      return outcome;
    }
    this.commit(outcome.value, 'file');
    return outcome;
  }

  private async applyText(text: string): Promise<Result<ConfigSnapshot>> {
    const outcome = parseAccountsYaml(text);
    if (!outcome.ok) {
      return outcome;
    }
    if (!(await this.writeAtomically(text))) {
      return err(SAVE_FAILED);
    }
    this.commit(outcome.value, 'app');
    return outcome;
  }

  /** Stores a valid snapshot and emits when the meaning changed. Starting from nothing emits nothing. */
  private commit(snapshot: ConfigSnapshot, source: 'file' | 'app'): void {
    const previous = this.lastGood;
    this.lastGood = snapshot;
    this.lastInvalid = null;
    if (previous !== null && !sameConfig(previous.parsed, snapshot.parsed)) {
      this.emitter.fire({ type: 'config.changed', source });
    }
  }

  /** Writes a temporary file next to the target, then renames it over the target. */
  private async writeAtomically(text: string): Promise<boolean> {
    const temporary = join(this.folder, `.${this.fileName}.${randomUUID()}.tmp`);
    try {
      await mkdir(this.folder, { recursive: true });
      await writeFile(temporary, text, 'utf8');
      await rename(temporary, this.filePath);
      return true;
    } catch {
      await unlink(temporary).catch(() => undefined);
      return false;
    }
  }

  private startWatching(): void {
    if (this.watcher !== null) {
      return;
    }
    try {
      this.watcher = watch(this.folder, (_event, changed) => {
        // Watching the folder also catches editors that save by writing a new file and renaming it over the old one.
        if (changed === null || String(changed) === this.fileName) {
          this.scheduleReload();
        }
      });
      this.watcher.on('error', () => this.stopWatching());
    } catch {
      this.watcher = null;
    }
  }

  private scheduleReload(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.enqueue(() => this.loadFromDisk()).then((outcome) => this.reportInvalidEdit(outcome));
    }, this.options.watchDebounceMs);
  }

  /** An outside edit that does not validate: tell the clients which fields are wrong. */
  private reportInvalidEdit(outcome: Result<ConfigSnapshot>): void {
    if (outcome.ok) {
      return;
    }
    // The field list comes from OrchError.details, so it is checked against the contract before it is sent.
    const checked = ConfigFieldError.array().safeParse(outcome.error.details?.fields);
    if (checked.success) {
      this.emitter.fire({ type: 'config.invalid', errors: checked.data });
    }
  }

  private stopWatching(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.watcher?.close();
    this.watcher = null;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}
