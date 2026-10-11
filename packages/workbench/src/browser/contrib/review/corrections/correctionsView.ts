/**
 * The "Stop this happening again" panel's view-model, owned by story S4-03. It mirrors design/screens.md
 * (line 73: "Refuted run shows the four layers, strongest first") and design/prototype/Main.dc.html
 * (the LAYERS descriptor block, lines 2211-2216). The layer order — codebase, lint, agent_rule,
 * review_note — is the contract's strongest-first order, and so is fixed here; each layer's label
 * and tag come from strings.ts word-for-word from the design.
 *
 * The tone mapping (ok / ok / neutral / warn) is from the prototype's LTAG map (Main.dc.html line 2217):
 * the first two layers hold structure/lint, so an agent ignoring them is a hard failure; the last two
 * are advisory, so neutral and warn tone respectively.
 */
import type { CorrectionLayer } from '@orch/contracts';
import type { Tone } from '../reviewView.js';
import { reviewStrings as S } from '../strings.js';

export interface CorrectionLayerView {
  readonly key: CorrectionLayer;
  readonly number: number;
  readonly label: string;
  readonly tag: string;
  readonly tone: Tone;
  readonly actionLabel: string;
  /** Shown as a confirmation line once the layer's action completes. */
  readonly doneText: string;
}

const LAYER_TONE: Record<CorrectionLayer, Tone> = {
  codebase: 'ok',
  lint: 'ok',
  agent_rule: 'neutral',
  review_note: 'warn',
};

/** The four layers, strongest first, from LOCKED REV-06. */
export const CORRECTION_LAYER_VIEWS: readonly CorrectionLayerView[] = [
  { key: 'codebase', number: 1, label: S.corrections.layer.codebase.label, tag: S.corrections.layer.codebase.tag, tone: LAYER_TONE.codebase, actionLabel: S.corrections.actionLabel.codebase, doneText: S.corrections.actionDone.codebase },
  { key: 'lint', number: 2, label: S.corrections.layer.lint.label, tag: S.corrections.layer.lint.tag, tone: LAYER_TONE.lint, actionLabel: S.corrections.actionLabel.lint, doneText: S.corrections.actionDone.lint },
  { key: 'agent_rule', number: 3, label: S.corrections.layer.agent_rule.label, tag: S.corrections.layer.agent_rule.tag, tone: LAYER_TONE.agent_rule, actionLabel: S.corrections.actionLabel.agent_rule, doneText: S.corrections.actionDone.agent_rule },
  { key: 'review_note', number: 4, label: S.corrections.layer.review_note.label, tag: S.corrections.layer.review_note.tag, tone: LAYER_TONE.review_note, actionLabel: S.corrections.actionLabel.review_note, doneText: S.corrections.actionDone.review_note },
];

/** Finds a layer view by its enum key, or null if the layer is unknown. */
export function layerViewById(key: CorrectionLayer): CorrectionLayerView | null {
  return CORRECTION_LAYER_VIEWS.find((l) => l.key === key) ?? null;
}
