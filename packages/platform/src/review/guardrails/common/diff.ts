/**
 * Parses `git diff --no-color` output into the files it changed. Plain
 * TypeScript; no Node APIs. The guardrails use this so they can tell an added
 * file from a deleted one, and a rename that kept a file's contents from a
 * rename that changed them (JOB-05, JOB-06).
 */

export type DiffFileStatus = 'added' | 'deleted' | 'modified' | 'renamed';

export interface DiffFile {
  /** Path before the change; null when the file was added. */
  oldPath: string | null;
  /** Path after the change; null when the file was deleted. */
  newPath: string | null;
  status: DiffFileStatus;
  /** Added content lines (a leading `+`, never the `+++` header). */
  addedLines: string[];
  /** How many content lines were removed (a leading `-`). */
  removedLines: number;
  /** A rename with no content change (similarity 100%). */
  unchangedRename: boolean;
}

interface PartialFile {
  oldPath: string | null;
  newPath: string | null;
  renameFrom: string | null;
  renameTo: string | null;
  added: boolean;
  deleted: boolean;
  addedLines: string[];
  removedLines: number;
  inHunk: boolean;
}

function unquote(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Drops git's `a/` or `b/` prefix; leaves `/dev/null` alone. */
function stripPrefix(raw: string): string {
  const path = unquote(raw);
  if (path === '/dev/null') return path;
  if (path.startsWith('a/') || path.startsWith('b/')) return path.slice(2);
  return path;
}

/** Splits `a/<path> b/<path>` respecting git's double-quoting of odd paths. */
function splitHeader(rest: string): { a: string | null; b: string | null } {
  const tokens: string[] = [];
  let i = 0;
  while (i < rest.length && tokens.length < 2) {
    while (rest[i] === ' ') i++;
    if (rest[i] === '"') {
      let j = i + 1;
      let escaped = false;
      while (j < rest.length) {
        const ch = rest[j];
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') break;
        j++;
      }
      tokens.push(rest.slice(i, j + 1));
      i = j + 1;
    } else {
      let j = i;
      while (j < rest.length && rest[j] !== ' ') j++;
      tokens.push(rest.slice(i, j));
      i = j;
    }
  }
  return {
    a: tokens[0] === undefined ? null : stripPrefix(tokens[0]),
    b: tokens[1] === undefined ? null : stripPrefix(tokens[1]),
  };
}

function flush(files: DiffFile[], current: PartialFile | null): void {
  if (current === null) return;
  const status: DiffFileStatus = current.added
    ? 'added'
    : current.deleted
      ? 'deleted'
      : current.renameFrom !== null && current.renameTo !== null
        ? 'renamed'
        : 'modified';
  const unchangedRename = status === 'renamed' && current.addedLines.length === 0 && current.removedLines === 0;
  files.push({
    oldPath: status === 'added' ? null : (current.renameFrom ?? current.oldPath),
    newPath: status === 'deleted' ? null : (current.renameTo ?? current.newPath),
    status,
    addedLines: current.addedLines,
    removedLines: current.removedLines,
    unchangedRename,
  });
}

/** Parses a unified diff (git's default output) into one entry per file. */
export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: PartialFile | null = null;

  for (const raw of diff.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    if (line.startsWith('diff --git ')) {
      flush(files, current);
      const { a, b } = splitHeader(line.slice('diff --git '.length));
      current = {
        oldPath: a,
        newPath: b,
        renameFrom: null,
        renameTo: null,
        added: false,
        deleted: false,
        addedLines: [],
        removedLines: 0,
        inHunk: false,
      };
      continue;
    }
    if (current === null) continue;

    if (line.startsWith('new file mode')) {
      current.added = true;
    } else if (line.startsWith('deleted file mode')) {
      current.deleted = true;
    } else if (line.startsWith('rename from ')) {
      current.renameFrom = unquote(line.slice('rename from '.length));
    } else if (line.startsWith('rename to ')) {
      current.renameTo = unquote(line.slice('rename to '.length));
    } else if (line.startsWith('@@')) {
      current.inHunk = true;
    } else if (!current.inHunk && line.startsWith('--- ')) {
      current.oldPath = stripPrefix(line.slice(4));
    } else if (!current.inHunk && line.startsWith('+++ ')) {
      current.newPath = stripPrefix(line.slice(4));
    } else if (line.startsWith('+')) {
      current.addedLines.push(line.slice(1));
    } else if (line.startsWith('-')) {
      current.removedLines++;
    }
  }

  flush(files, current);
  return files;
}
