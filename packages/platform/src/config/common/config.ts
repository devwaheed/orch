/**
 * Config service contract for `~/.orch/accounts.yaml`. `common` code: plain
 * TypeScript only. The file-system implementation lives in `../node`.
 */
import type { IDisposable, Event } from '@orch/base';
import { createServiceId } from '@orch/base';
import type { AccountsFile, OrchError, OrchEvent, Result } from '@orch/contracts';

/** The parsed file plus the exact text it was parsed from. */
export interface ConfigSnapshot {
  readonly text: string;
  readonly parsed: AccountsFile;
}

/** One problem in the file, with the 1-based line it sits on (null when the file has no line for it). */
export interface ConfigFieldError {
  /** Dot path to the field, e.g. `limits.max_runs_per_account`. Empty for the whole file. */
  readonly path: string;
  readonly line: number | null;
  readonly message: string;
}

export interface IConfigService extends IDisposable {
  /** Fires `{ type: 'config.changed', source }` when the parsed config changes. */
  readonly onDidChange: Event<OrchEvent>;
  /** Loads the file once, then watches it for outside edits. Returns the first load's result. */
  start(): Promise<Result<ConfigSnapshot>>;
  /** Reads the file from disk. Invalid files return `validation_failed` with `details.fields`. */
  read(): Promise<Result<ConfigSnapshot>>;
  /** The last valid config, or null if none has loaded yet. Invalid saves never replace it. */
  current(): ConfigSnapshot | null;
  /** The error from the most recent invalid read, or null when the file is valid. */
  lastError(): OrchError | null;
  /** Validates the YAML text, then writes it. Comments in the text are kept as given. */
  setText(text: string): Promise<Result<ConfigSnapshot>>;
  /** Sets one value by path and writes the file, keeping every other comment and key. */
  setValue(path: readonly string[], value: unknown): Promise<Result<ConfigSnapshot>>;
}

export const IConfigService = createServiceId<IConfigService>('config');

/** Joins a path such as `['limits', 'near_limit_at']` into `limits.near_limit_at`. */
export function fieldPath(path: readonly PropertyKey[]): string {
  return path.map((segment) => String(segment)).join('.');
}

/** Stable JSON: object keys sorted, so key order in the file does not count as a change. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** True when two parsed configs mean the same thing (key order and comments do not count). */
export function sameConfig(a: AccountsFile, b: AccountsFile): boolean {
  return canonical(a) === canonical(b);
}
