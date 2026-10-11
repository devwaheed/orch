/**
 * The before/after diff, drawn with Monaco (ARC-05). Only the editor API is pulled in
 * (`monaco-editor/editor/editor.api`), not the full language bundle, and the editor runs on a
 * web worker so diffing doesn't block the window (SEC-02: everything is local).
 *
 * Theme is built from the design tokens at runtime (ARC-06: no hard-coded colours in the
 * component), so the diff follows the light/dark choice like the rest of the workbench.
 */
import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { useThemeStore } from '../../../services/theme.js';
import styles from './MonacoDiff.module.css';

interface MonacoEnvHost {
  MonacoEnvironment?: { getWorker(workerId: string, label: string): Worker };
}

const envHost = globalThis as unknown as MonacoEnvHost;
envHost.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const THEME_NAME = 'orch-diff';

function defineTheme(resolved: 'dark' | 'light'): void {
  monaco.editor.defineTheme(THEME_NAME, {
    base: resolved === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': cssVar('--term'),
      'editor.foreground': cssVar('--text2'),
      'editorGutter.background': cssVar('--term'),
      'editorLineNumber.foreground': cssVar('--lnum'),
      'diffEditor.insertedLineBackground': cssVar('--ok-diff'),
      'diffEditor.removedLineBackground': cssVar('--err-diff'),
    },
  });
}

export function MonacoDiff({ before, after }: { readonly before: string; readonly after: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    defineTheme(useThemeStore.getState().resolvedTheme);
    const editor = monaco.editor.createDiffEditor(container, {
      theme: THEME_NAME,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      fixedOverflowWidgets: true,
      fontFamily: cssVar('--font-mono'),
      fontSize: 12,
    });

    const original = monaco.editor.createModel(before, 'plaintext');
    const modified = monaco.editor.createModel(after, 'plaintext');
    editor.setModel({ original, modified });

    return () => {
      editor.setModel(null);
      original.dispose();
      modified.dispose();
      editor.dispose();
    };
  }, [before, after]);

  useEffect(() => {
    defineTheme(resolvedTheme);
    monaco.editor.setTheme(THEME_NAME);
  }, [resolvedTheme]);

  return <div ref={containerRef} className={styles.diff} data-testid="review-diff" />;
}
