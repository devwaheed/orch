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
import type { Tone } from '../reviewView.js';
import { cx } from '../components/cx.js';

interface CorrectionsPanelProps {
  readonly port: ReviewPort;
  readonly review: WorktreeReview;
}

const TAG_TONE_BG: Record<Tone, string | undefined> = {
  ok: 'bg-ok-bg',
  warn: 'bg-warn-bg',
  neutral: 'bg-neutral',
  info: undefined,
  err: undefined,
};

const TAG_TONE_FG: Record<Tone, string | undefined> = {
  ok: 'text-ok',
  warn: 'text-warn',
  neutral: 'text-text3',
  info: undefined,
  err: undefined,
};

const NUM_BG: Record<Tone, string | undefined> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  neutral: 'bg-neutral text-text3',
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
    <div className="mx-7 mt-0 mb-7 p-6 rounded-xl border border-line bg-panel2 flex flex-col gap-5">
      <div className="flex flex-col gap-3px">
        <h3 className="m-0 text-13p5 font-semibold">{S.corrections.title}</h3>
        <p className="m-0 text-muted2 text-sm">{S.corrections.intro}</p>
      </div>

      <div className="flex gap-3 items-start px-11px py-9px rounded-md border border-line2 text-12p5 text-text2 bg-panel">
        <Icon name="alert" size={14} className="shrink-0 w-[14px] mt-2px text-warn-solid" />
        <span><span className="text-muted2 font-medium whitespace-nowrap">{S.corrections.lessonLabel}</span> {S.corrections.lesson}</span>
      </div>

      <fieldset className="border-0 p-0 m-0 flex flex-col gap-2" role="radiogroup" aria-label={S.corrections.layerLabel}>
        {CORRECTION_LAYER_VIEWS.map((layer) => {
          const checked = selectedLayer === layer.key;
          return (
            <button
              key={layer.key}
              type="button"
              role="radio"
              aria-checked={checked}
              className={cx(
                'flex items-start gap-4 px-5 py-4 min-h-[44px] rounded-9px text-text text-left cursor-pointer',
                checked ? 'border-2 border-accent bg-sel' : 'border border-line bg-panel'
              )}
              onClick={() => onPick(layer.key)}
            >
              <span
                className={cx(
                  'shrink-0 w-[24px] h-[24px] rounded-sm text-xs font-semibold flex items-center justify-center',
                  checked ? 'bg-accent-solid text-on-accent' : NUM_BG[layer.tone]
                )}
              >
                {layer.number}
              </span>
              <span className="flex flex-col gap-2px flex-[1_1_auto] min-w-0">
                <span className="flex flex-wrap items-center gap-3">
                  <span className="text-base font-semibold text-text">{layer.label}</span>
                  <span className={cx('shrink-0 px-7px py-1px rounded-pill text-2xs font-medium whitespace-nowrap', TAG_TONE_BG[layer.tone])}>
                    <span className={cx('inline', TAG_TONE_FG[layer.tone])}>{layer.tag}</span>
                  </span>
                </span>
                <span className="text-sm text-muted2">{layer.action}</span>
              </span>
            </button>
          );
        })}
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <p className="flex-[1_1_260px] m-0 text-muted2 text-sm">{layerView.actionLabel}</p>
        {isDone ? (
          <div className="flex items-center gap-3 px-11px py-9px rounded-md bg-ok-bg text-ok text-12p5 font-medium">
            <Icon name="check" size={14} weight={2.2} />
            {layerView.doneText}
          </div>
        ) : (
          <button
            type="button"
            className={cx(
              'flex items-center gap-2 px-6 py-3 min-h-[36px] rounded-md border font-semibold text-12p5 cursor-pointer disabled:cursor-not-allowed',
              layerView.tone === 'ok'
                ? 'border-accent-solid bg-accent-solid text-on-accent'
                : layerView.tone === 'warn'
                  ? 'border-btnline bg-btn text-warn-solid'
                  : 'border-btnline bg-btn text-text'
            )}
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
