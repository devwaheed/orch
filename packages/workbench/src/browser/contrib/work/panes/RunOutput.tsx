/** The agent's output: one row per RunLine, in seq order, styled by line kind. */
import { useMemo } from 'react';
import type { RunId } from '@orchagents/contracts';
import { selectRunLines, useRunsStore } from '../../../services/stores/work.js';
import { formatLineTime } from '../model/statusModel.js';
import { lineView, type LineTone } from '../model/paneModel.js';
import { workStrings } from '../strings.js';
import styles from './panes.module.css';
import { cx } from '../components/cx.js';

const TONE_CLASS: Record<LineTone, string | undefined> = {
  meta: styles.toneMeta,
  you: styles.toneYou,
  msg: styles.toneMsg,
  tool: styles.toneTool,
  add: styles.toneAdd,
  del: styles.toneDel,
  ok: styles.toneOk,
  err: styles.toneErr,
  limit: styles.toneLimit,
  spawn: styles.toneSpawn,
};

export function RunOutput({ runId, working }: { readonly runId: RunId; readonly working: boolean }) {
  const lines = useRunsStore(selectRunLines(runId));
  const ordered = useMemo(() => [...lines].sort((a, b) => a.seq - b.seq), [lines]);

  return (
    <div className={styles.output}>
      {ordered.map((line) => {
        const view = lineView(line.kind);
        return (
          <div key={line.seq} className={styles.line}>
            <span className={styles.lineTime}>{formatLineTime(line.at)}</span>
            <span className={cx(styles.lineGlyph, TONE_CLASS[view.tone])}>{view.glyph}</span>
            <span className={cx(styles.lineText, TONE_CLASS[view.tone])}>{line.text}</span>
          </div>
        );
      })}
      {working ? (
        <div className={styles.working}>
          <span className={styles.cursor} aria-hidden="true" />
          <span className={styles.workingText}>{workStrings.panes.working}</span>
        </div>
      ) : null}
    </div>
  );
}
