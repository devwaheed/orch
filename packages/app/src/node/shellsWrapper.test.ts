/**
 * Shell events reach the core events channel (S2-06 gap): shell.output and
 * shell.exited from the PTY host are forwarded through the same EventsHub that
 * coreHostMain attaches the wrapper to, and keep flowing after a PTY host restart.
 */
import { describe, expect, it } from 'vitest';
import { ShellId, type OrchEvent } from '@orch/contracts';
import { ShellsServiceImpl } from '@orch/platform/src/shells/node/shellsService.js';
import type { ShellPort } from '@orch/platform/src/shells/common/shells.js';
import { EventsHub } from './coreHostMain.js';
import { ShellsServiceWrapper } from './shellsWrapper.js';
import type { PtyHostChild } from './ptyChild.js';

/** A fake MessagePort to one PTY host: records what the core sends and lets the test emit replies and events. */
function fakePtyPort() {
  let listener: ((message: unknown) => void) | null = null;
  const sent: unknown[] = [];
  const port: ShellPort = {
    postMessage: (message) => {
      sent.push(message);
    },
    on: (_event, next) => {
      listener = next;
      return undefined;
    },
    close: () => undefined,
  };
  return { port, sent, emit: (message: unknown) => listener?.(message) };
}

/** Stands in for PtyHostChild: getService returns whichever ShellsServiceImpl is current. */
function fakePtyChild(first: ShellsServiceImpl) {
  let current: ShellsServiceImpl | null = first;
  const child: Pick<PtyHostChild, 'getService'> = { getService: () => current };
  return {
    child,
    replace(next: ShellsServiceImpl | null) {
      current = next;
    },
  };
}

function collect(hub: EventsHub): OrchEvent[] {
  const received: OrchEvent[] = [];
  hub.subscribe((event) => received.push(event));
  return received;
}

describe('ShellsServiceWrapper event forwarding', () => {
  it('forwards shell.output and shell.exited to the core events hub', () => {
    const pty = fakePtyPort();
    const impl = new ShellsServiceImpl(pty.port);
    const wrapper = new ShellsServiceWrapper(fakePtyChild(impl).child);
    const hub = new EventsHub();
    hub.attach(wrapper.onEvent);
    const received = collect(hub);

    // The wrapper binds to the live impl on first use.
    void wrapper.write(ShellId.parse('sh-1'), 'ls\n');
    pty.emit({ type: 'shell.output', shellId: 'sh-1', data: 'file.txt\r\n' });
    pty.emit({ type: 'shell.exited', shellId: 'sh-1', code: 0 });

    expect(received).toEqual([
      { type: 'shell.output', shellId: 'sh-1', data: 'file.txt\r\n' },
      { type: 'shell.exited', shellId: 'sh-1', code: 0 },
    ]);
    wrapper.dispose();
    hub.dispose();
  });

  it('reports live shells as exited with code null when the PTY host goes away', async () => {
    const pty = fakePtyPort();
    const impl = new ShellsServiceImpl(pty.port);
    const fake = fakePtyChild(impl);
    const wrapper = new ShellsServiceWrapper(fake.child);
    const hub = new EventsHub();
    hub.attach(wrapper.onEvent);
    const received = collect(hub);

    const opening = wrapper.open('/work/tree', 80, 24);
    pty.emit({ id: 1, ok: true, value: { shellId: 'sh-2' } });
    await opening;
    expect(pty.sent).toHaveLength(1);

    // The PTY host exits: the supervisor calls onPtyHostClose on the impl.
    impl.onPtyHostClose();

    expect(received).toContainEqual({ type: 'shell.exited', shellId: 'sh-2', code: null });
    wrapper.dispose();
    hub.dispose();
  });

  it('keeps forwarding after a PTY host restart', async () => {
    const first = fakePtyPort();
    const second = fakePtyPort();
    const firstImpl = new ShellsServiceImpl(first.port);
    const secondImpl = new ShellsServiceImpl(second.port);
    const fake = fakePtyChild(firstImpl);
    const wrapper = new ShellsServiceWrapper(fake.child);
    const hub = new EventsHub();
    hub.attach(wrapper.onEvent);
    const received = collect(hub);

    void wrapper.write(ShellId.parse('sh-1'), '');
    first.emit({ type: 'shell.output', shellId: 'sh-1', data: 'before' });

    // The supervisor reports ready again: the wrapper drops the old impl and binds the new one.
    wrapper.onPtyHostRestart();
    fake.replace(secondImpl);
    void wrapper.write(ShellId.parse('sh-3'), '');
    second.emit({ type: 'shell.output', shellId: 'sh-3', data: 'after' });
    // Events from the old impl no longer reach subscribers.
    first.emit({ type: 'shell.output', shellId: 'sh-1', data: 'stale' });

    expect(received).toEqual([
      { type: 'shell.output', shellId: 'sh-1', data: 'before' },
      { type: 'shell.output', shellId: 'sh-3', data: 'after' },
    ]);
    wrapper.dispose();
    hub.dispose();
  });
});
