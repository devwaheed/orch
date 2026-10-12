/**
 * Config file view logic: line numbers, mapping field errors to lines, and keeping the
 * editor draft in step with the text the core holds. Pure functions.
 */
import { ConfigFieldError } from '@orchagents/contracts';

export interface NumberedLine {
  readonly n: number;
  readonly text: string;
}

export function numberedLines(text: string): NumberedLine[] {
  return text.split('\n').map((line, index) => ({ n: index + 1, text: line }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The 1-based line that declares the last segment of a dot path, e.g.
 * `limits.max_runs_per_account` -> the line starting `max_runs_per_account:`.
 * Null when no line declares it.
 */
export function findLineForPath(text: string, path: string): number | null {
  const segments = path.split('.').filter((segment) => segment.length > 0);
  const last = segments[segments.length - 1];
  if (!last) return null;
  const pattern = new RegExp(`^\\s*(?:-\\s+)?["']?${escapeRegExp(last)}["']?\\s*:`);
  const index = text.split('\n').findIndex((line) => pattern.test(line));
  return index === -1 ? null : index + 1;
}

export interface LineMarks {
  /** Messages per 1-based line. */
  readonly byLine: ReadonlyMap<number, readonly string[]>;
  /** Errors that do not point at a line (the whole file, or a line that no longer exists). */
  readonly fileLevel: readonly string[];
}

/**
 * Maps field errors to lines. Uses the error's own line when it has one, otherwise finds
 * the line by path. An error whose line is past the end of the text stays file-level.
 */
export function markErrors(text: string, errors: readonly ConfigFieldError[]): LineMarks {
  const lineCount = text.split('\n').length;
  const byLine = new Map<number, string[]>();
  const fileLevel: string[] = [];
  for (const error of errors) {
    const line = error.line ?? (error.path ? findLineForPath(text, error.path) : null);
    if (line === null || line < 1 || line > lineCount) {
      fileLevel.push(error.message);
      continue;
    }
    byLine.set(line, [...(byLine.get(line) ?? []), error.message]);
  }
  return { byLine, fileLevel };
}

/**
 * Reads field errors from an OrchError.details object (`details.errors`). Entries that do
 * not match the ConfigFieldError schema are dropped.
 */
export function parseFieldErrors(details: Readonly<Record<string, unknown>> | undefined): ConfigFieldError[] {
  const raw = details?.errors;
  if (!Array.isArray(raw)) return [];
  const out: ConfigFieldError[] = [];
  for (const entry of raw) {
    const parsed = ConfigFieldError.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * The editor shows the core's text unless the user has unsaved edits, which win until saved.
 * Visual changes replace serverText, so the draft follows them when it is clean.
 */
export function reconcileDraft(input: { readonly serverText: string; readonly draft: string; readonly dirty: boolean }): string {
  return input.dirty ? input.draft : input.serverText;
}

/** Colour of a config line, as the design draws it: comments faint, top-level keys info, the rest text2. */
export type ConfigLineTone = 'comment' | 'key' | 'text';
export function configLineTone(line: string): ConfigLineTone {
  if (line.trim().startsWith('#')) return 'comment';
  if (line.includes('#')) return 'text';
  return /^\S/.test(line) ? 'key' : 'text';
}
