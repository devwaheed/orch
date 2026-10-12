/**
 * The "Stop this happening again" panel on a refuted worktree (S4-03). It renders the four correction
 * layers, strongest first, as a radio group; picking one and confirming sends the correction to the
 * core via `correct()`. The four layers, their labels, tags and tones come from correctionsView.ts,
 * which mirrors design/screens.md line 73 and design/prototype/Main.dc.html (the LAYERS block).
 *
 * This component is pure UI: it knows nothing about services beyond the `port` it is handed, and reads
 * the lesson ("What went wrong") from the review's note — the same place ReviewScreen reads it for the
 * note under the diff.
 */
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { useState } from 'react';
import type { CorrectionLayer, WorktreeReview } from '@orchagents/contracts';
import { applyCorrection, type ReviewPort } from '../actions.js';
import { useReviewUiStore } from '../stores/reviewUi.js';
import { CORRECTION_LAYER_VIEWS, layerViewById } from './correctionsView.js';
import { reviewStrings as S } from '../strings.js';
import styles from './CorrectionsPanel.module.css';
import type { Tone } from '../reviewView.js';
import { cx } from '../components/cx.js';

interface CorrectionsPanelProps {
  readonly port: ReviewPort;
  readonly review: WorktreeReview;
}

const TAG_TONE_BG: Record<Tone, string | undefined> = {
  ok: styles.tagOk,
  warn: styles.tagWarn,
  neutral: styles.tagNeutral,
  info: undefined,
  err: undefined,
};

const TAG_TONE_FG: Record<Tone, string | undefined> = {
  ok: styles.tagOkFg,
  warn: styles.tagWarnFg,
  neutral: styles.tagNeutralFg,
  info: undefined,
  err: undefined,
};

const NUM_BG: Record<Tone, string | undefined> = {
  ok: styles.numOk,
  warn: styles.numWarn,
  neutral: styles.numNeutral,
  info: undefined,
  err: undefined,
};

export function CorrectionsPanel({ port, review }: CorrectionsPanelProps) {
  const [selectedLayer, setSelectedLayer] = useState<CorrectionLayer>('lint');
  const busy = useReviewUiStore((s) => s.busy);
  const correctionDone = useReviewUiStore((s) => s.correctionDone);
  const layerView = layerViewById(selectedLayer)!;
  const isDone = correctionDone === selectedLayer;

  const onPick = (layer: CorrectionLayer) => {
    setSelectedLayer(layer);
    useReviewUiStore.getState().resetCorrectionDone();
  };

  const onSubmit = () => {
    if (busy !== null) return;
    void applyCorrection(port, review.worktree, selectedLayer, layerView.action);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>{S.corrections.title}</h3>
        <p className={styles.intro}>{S.corrections.intro}</p>
      </div>

      <div className={styles.lesson}>
        <Icon name="alert" size={14} className={styles.lessonIcon ?? ''} />
        <span><span className={styles.lessonLabel}>{S.corrections.lessonLabel}</span> {S.corrections.lesson}</span>
      </div>

      <fieldset className={styles.layers} role="radiogroup" aria-label={S.corrections.layerLabel}>
        {CORRECTION_LAYER_VIEWS.map((layer) => {
          const checked = selectedLayer === layer.key;
          return (
            <button
              key={layer.key}
              type="button"
              role="radio"
              aria-checked={checked}
              className={cx(styles.layer, checked && styles.layerSelected)}
              onClick={() => onPick(layer.key)}
            >
              <span className={cx(styles.num, NUM_BG[layer.tone])}>{layer.number}</span>
              <span className={styles.layerMain}>
                <span className={styles.layerHeading}>
                  <span className={styles.layerLabel}>{layer.label}</span>
                  <span className={cx(styles.tag, TAG_TONE_BG[layer.tone])}>
                    <span className={cx(styles.tagFg, TAG_TONE_FG[layer.tone])}>{layer.tag}</span>
                  </span>
                </span>
                <span className={styles.layerAction}>{layer.action}</span>
              </span>
            </button>
          );
        })}
      </fieldset>

      <div className={styles.nextRow}>
        <p className={styles.next}>{layerView.actionLabel}</p>
        {isDone ? (
          <div className={styles.done}>
            <Icon name="check" size={14} weight={2.2} />
            {layerView.doneText}
          </div>
        ) : (
          <button
            type="button"
            className={cx(styles.start, layerView.tone === 'ok' ? styles.startOk : layerView.tone === 'warn' ? styles.startWarn : '')}
            disabled={busy !== null}
            onClick={onSubmit}
          >
            <Icon name="plus" size={13} weight={2.2} />
            {layerView.startLabel}
          </button>
        )}
      </div>
    </div>
  );
}
