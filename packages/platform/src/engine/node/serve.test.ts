import { describe, expect, it } from 'vitest';
import type { EngineEvent, EngineRequest } from '@orchagents/contracts';
import { createPortPair } from '../test/portPair.js';
import { type EngineHandler, serveEngine } from './serve.js';
import type { HostResult } from './engineHost.js';

function recordingHandler(): { handler: EngineHandler; calls: EngineRequest[]; push: (e: EngineEvent) => void } {
  const calls: EngineRequest[] = [];
  const listeners = new Set<(e: EngineEvent) => void>();
  return {
    calls,
    push: (e) => listeners.forEach((l) => l(e)),
    handler: {
      handle: async (request): Promise<HostResult> => {
        calls.push(request);
        return { ok: true, value: { echoed: request.op } };
      },
      onEvent: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('serveEngine', () => {
  it('rejects a non-allowlisted env with validation_failed before the host sees it', async () => {
    const { handler, calls } = recordingHandler();
    const pair = createPortPair();
    serveEngine(handler, pair.right);
    const replies: unknown[] = [];
    pair.left.on('message', (m) => replies.push(m));

    pair.left.postMessage({
      id: 7,
      request: {
        op: 'session.start',
        agent: 'claude',
        cwd: '/tmp',
        env: { ANTHROPIC_API_KEY: 'sk-not-allowed' },
        readOnly: false,
      },
    });
    await tick();
    await tick();

    expect(calls).toEqual([]);
    expect(replies).toEqual([
      {
        id: 7,
        ok: false,
        error: { code: 'validation_failed', message: 'The engine request was not valid.' },
      },
    ]);
  });

  it('rejects an empty env on a session start', async () => {
    const { handler, calls } = recordingHandler();
    const pair = createPortPair();
    serveEngine(handler, pair.right);
    const replies: unknown[] = [];
    pair.left.on('message', (m) => replies.push(m));
    pair.left.postMessage({
      id: 1,
      request: { op: 'session.start', agent: 'claude', cwd: '/tmp', env: {}, readOnly: true },
    });
    await tick();
    await tick();
    expect(calls).toEqual([]);
    expect(replies[0]).toMatchObject({ id: 1, ok: false, error: { code: 'validation_failed' } });
  });

  it('passes a valid request through and replies with the same id', async () => {
    const { handler, calls } = recordingHandler();
    const pair = createPortPair();
    serveEngine(handler, pair.right);
    const replies: unknown[] = [];
    pair.left.on('message', (m) => replies.push(m));
    pair.left.postMessage({ id: 3, request: { op: 'health.ping' } });
    await tick();
    await tick();
    expect(calls).toEqual([{ op: 'health.ping' }]);
    expect(replies).toEqual([{ id: 3, ok: true, value: { echoed: 'health.ping' } }]);
  });

  it('answers an envelope with a usable id but a broken body, and drops one with no id', async () => {
    const { handler, calls } = recordingHandler();
    const pair = createPortPair();
    serveEngine(handler, pair.right);
    const replies: unknown[] = [];
    pair.left.on('message', (m) => replies.push(m));
    pair.left.postMessage({ id: 9, request: { op: 'nope' } });
    pair.left.postMessage({ request: { op: 'health.ping' } });
    await tick();
    await tick();
    expect(calls).toEqual([]);
    expect(replies).toEqual([
      { id: 9, ok: false, error: { code: 'validation_failed', message: 'The engine request was not valid.' } },
    ]);
  });

  it('forwards valid events and never forwards invalid ones', async () => {
    const { handler, push } = recordingHandler();
    const pair = createPortPair();
    serveEngine(handler, pair.right);
    const seen: unknown[] = [];
    pair.left.on('message', (m) => seen.push(m));
    push({ type: 'engine.error', message: 'nonfatal', fatal: false });
    push({ type: 'session.status', session: 's-1', status: 'bogus' } as unknown as EngineEvent);
    await tick();
    await tick();
    expect(seen).toEqual([{ type: 'engine.error', message: 'nonfatal', fatal: false }]);
  });
});
