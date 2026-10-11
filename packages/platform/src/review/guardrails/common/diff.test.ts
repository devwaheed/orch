import { describe, expect, it } from 'vitest';
import { parseDiff } from './diff.js';

describe('parseDiff', () => {
  it('parses a modified file and its added and removed lines', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,4 @@',
      ' context',
      '-old line',
      '+new line',
      '+another',
      ' tail',
      '',
    ].join('\n');

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      oldPath: 'src/a.ts',
      newPath: 'src/a.ts',
      status: 'modified',
      removedLines: 1,
      unchangedRename: false,
    });
    expect(files[0]?.addedLines).toEqual(['new line', 'another']);
  });

  it('parses an added file', () => {
    const diff = [
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      'index 0000000..2222222',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
      '',
    ].join('\n');

    const files = parseDiff(diff);
    expect(files[0]).toMatchObject({ oldPath: null, newPath: 'src/new.ts', status: 'added' });
    expect(files[0]?.addedLines).toEqual(['one', 'two']);
  });

  it('parses a deleted file', () => {
    const diff = [
      'diff --git a/src/gone.ts b/src/gone.ts',
      'deleted file mode 100644',
      'index 2222222..0000000',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-one',
      '-two',
      '',
    ].join('\n');

    const files = parseDiff(diff);
    expect(files[0]).toMatchObject({ oldPath: 'src/gone.ts', newPath: null, status: 'deleted', removedLines: 2 });
  });

  it('marks a content-free rename as unchanged', () => {
    const diff = [
      'diff --git a/src/old.ts b/src/new.ts',
      'similarity index 100%',
      'rename from src/old.ts',
      'rename to src/new.ts',
      '',
    ].join('\n');

    const files = parseDiff(diff);
    expect(files[0]).toMatchObject({
      oldPath: 'src/old.ts',
      newPath: 'src/new.ts',
      status: 'renamed',
      unchangedRename: true,
      removedLines: 0,
    });
    expect(files[0]?.addedLines).toEqual([]);
  });

  it('detects a rename that changed content', () => {
    const diff = [
      'diff --git a/src/old.ts b/src/new.ts',
      'similarity index 90%',
      'rename from src/old.ts',
      'rename to src/new.ts',
      '--- a/src/old.ts',
      '+++ b/src/new.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '',
    ].join('\n');

    const files = parseDiff(diff);
    expect(files[0]).toMatchObject({ oldPath: 'src/old.ts', newPath: 'src/new.ts', status: 'renamed', unchangedRename: false });
    expect(files[0]?.addedLines).toEqual(['new']);
  });

  it('parses quoted paths containing spaces from the header', () => {
    const diff = [
      'diff --git "a/my file.ts" "b/my file.ts"',
      '--- "a/my file.ts"',
      '+++ "b/my file.ts"',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '',
    ].join('\n');

    const files = parseDiff(diff);
    expect(files[0]).toMatchObject({ oldPath: 'my file.ts', newPath: 'my file.ts' });
  });

  it('parses a binary file from the header even without ---/+++ lines', () => {
    const diff = [
      'diff --git a/img.png b/img.png',
      'index 1111111..2222222 100644',
      'Binary files a/img.png and b/img.png differ',
      '',
    ].join('\n');

    const files = parseDiff(diff);
    expect(files[0]).toMatchObject({ oldPath: 'img.png', newPath: 'img.png', status: 'modified' });
  });

  it('parses several files in one diff', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/b.ts b/b.ts',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '',
    ].join('\n');

    expect(parseDiff(diff).map((f) => f.newPath)).toEqual(['a.ts', 'b.ts']);
  });

  it('treats a `+++` content line as content, not a header', () => {
    const diff = ['diff --git a/a.md b/a.md', '--- a/a.md', '+++ b/a.md', '@@ -1 +1 @@', '-x', '+++not a header', ''].join('\n');
    const files = parseDiff(diff);
    expect(files[0]?.newPath).toBe('a.md');
    expect(files[0]?.addedLines).toEqual(['++not a header']);
  });

  it('treats a `--- ` content line inside a hunk as a removal, not a header', () => {
    const diff = ['diff --git a/a.md b/a.md', '--- a/a.md', '+++ b/a.md', '@@ -1 +1 @@', '--- still a.md', '+new', ''].join(
      '\n',
    );
    const files = parseDiff(diff);
    expect(files[0]?.oldPath).toBe('a.md');
    expect(files[0]?.removedLines).toBe(1);
    expect(files[0]?.addedLines).toEqual(['new']);
  });

  it('returns nothing for an empty diff', () => {
    expect(parseDiff('')).toEqual([]);
  });
});
