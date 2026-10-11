import { describe, expect, it } from 'vitest';
import type { OrchEvent, RunId } from '@orch/contracts';
import { DEMO_SPEC_QUEUE } from '../node/demo/sampleData.js';
import { NotificationService, type Notifier } from './notifications.js';
import { NOTIFICATION_STRINGS } from './notificationStrings.js';

function setup(focused: () => boolean) {
  const shown: Array<{ title: string; body: string }> = [];
  const notifier: Notifier = { show: (title, body) => shown.push({ title, body }) };
  return { shown, service: new NotificationService({ isWindowFocused: focused, notifier }) };
}

describe('NotificationService (UI-06)', () => {
  it('notifies only while the window is not focused', () => {
    let focused = true;
    const { shown, service } = setup(() => focused);
    const event: OrchEvent = { type: 'run.attention', runId: 'r-1' as RunId, reason: 'limit_ask' };

    service.handleEvent(event);
    expect(shown).toHaveLength(0);

    focused = false;
    service.handleEvent(event);
    expect(shown).toEqual([
      { title: NOTIFICATION_STRINGS.runAttentionLimitAsk.title, body: NOTIFICATION_STRINGS.runAttentionLimitAsk.body('r-1') },
    ]);
  });

  it('a spec that needs you is announced once per stop, not on every spec.changed', () => {
    const { shown, service } = setup(() => false);
    const spec = DEMO_SPEC_QUEUE.specs[0]!;
    const changed = (state: typeof spec.state): OrchEvent => ({ type: 'spec.changed', spec: { ...spec, state } });

    service.handleEvent(changed('needs_you'));
    service.handleEvent(changed('needs_you'));
    expect(shown).toEqual([
      { title: NOTIFICATION_STRINGS.specNeedsYou.title, body: NOTIFICATION_STRINGS.specNeedsYou.body(spec.id) },
    ]);

    service.handleEvent(changed('running'));
    service.handleEvent(changed('needs_you'));
    expect(shown).toHaveLength(2);
  });

  it('the engine host giving up is announced; a restart is not', () => {
    const { shown, service } = setup(() => false);
    service.handleHostHealth({ type: 'engine.health', host: 'engine', state: 'restarting' });
    service.handleHostHealth({ type: 'engine.health', host: 'engine', state: 'failed', message: 'keeps stopping' });
    expect(shown).toEqual([
      { title: NOTIFICATION_STRINGS.engineKeepsStopping.title, body: NOTIFICATION_STRINGS.engineKeepsStopping.body },
    ]);
  });
});
