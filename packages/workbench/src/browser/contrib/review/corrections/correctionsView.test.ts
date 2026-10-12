import { describe, expect, it } from 'vitest';
import { CORRECTION_LAYER_VIEWS, layerViewById } from './correctionsView.js';
import type { CorrectionLayer } from '@orchagents/contracts';

describe('CORRECTION_LAYER_VIEWS (S4-03)', () => {
  it('has exactly four layers in strongest-first order', () => {
    const keys = CORRECTION_LAYER_VIEWS.map((l) => l.key);
    expect(keys).toEqual(['codebase', 'lint', 'agent_rule', 'review_note']);
  });

  it('numbers layers 1..4', () => {
    expect(CORRECTION_LAYER_VIEWS.map((l) => l.number)).toEqual([1, 2, 3, 4]);
  });

  it('each layer carries its label and tag', () => {
    const byKey = Object.fromEntries(
      CORRECTION_LAYER_VIEWS.map((l) => [l.key, { label: l.label, tag: l.tag }]),
    );
    expect(byKey).toEqual({
      codebase: { label: 'Codebase', tag: 'strongest' },
      lint: { label: 'Lint or CI rule', tag: "agents can't skip it" },
      agent_rule: { label: 'Agent rule', tag: 'agents mostly follow it' },
      review_note: { label: 'Review note', tag: "doesn't scale" },
    });
  });

  it('uses the prototype action copy and confirmation for each layer', () => {
    expect(CORRECTION_LAYER_VIEWS.map((layer) => [layer.action, layer.actionLabel, layer.startLabel])).toEqual([
      [
        'Add a shared test helper that sets up pkceStore, so tests can’t forget it.',
        'Starts a small job to add the helper and move existing auth tests onto it.',
        'Start the refactor job',
      ],
      [
        'Rule: tests under test/auth must import test/helpers/auth.',
        'Starts a small job that writes the rule and fixes anything it flags.',
        'Start the lint-rule job',
      ],
      [
        'Add to AGENTS.md: tests touching /auth must mock pkceStore.',
        'Opens the line in AGENTS.md for you to approve.',
        'Add the rule',
      ],
      [
        'Remember to check for this yourself during review.',
        'Saves a note on your review checklist.',
        'Save the note',
      ],
    ]);
  });

  it('tones match the prototype LTAG mapping (ok / ok / neutral / warn)', () => {
    expect(CORRECTION_LAYER_VIEWS.map((l) => l.tone)).toEqual(['ok', 'ok', 'neutral', 'warn']);
  });
});

describe('layerViewById', () => {
  it.each(CORRECTION_LAYER_VIEWS)(('returns the view for %s'), (view) => {
    expect(layerViewById(view.key)).toEqual(view);
  });

  it('returns null for an unknown key', () => {
    expect(layerViewById('unknown' as CorrectionLayer)).toBeNull();
  });
});
