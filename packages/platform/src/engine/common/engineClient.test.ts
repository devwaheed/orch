import { describe, expect, it } from 'vitest';
import type { EngineEvent, EngineRequest } from '@orchagents/contracts';
import { EngineClient } from './engineClient.js';
import { createPortPair } from '../test/portPair.js';

/** A fake engine that answers each request by op name. */
function fakeEngine(port: ReturnType<typeof createPortPair>['right'], replies: Record<string, unknown>): void {
  port.on('message', (raw) => {
    const envelope = raw as { id: number; request: EngineRequest };
    const value = replies[envelope.request.op];
    queueMicrotask(() => {
      port.postMessage(
        value instanceof Error
          ? { id: envelope.id, ok: false, error: { code: 'not_found', message: value.message } }
          : { id: envelope.id, ok: true, value: value ?? null },
      );
    });
  });
}

describe('EngineClient', () => {
  it('correlates replies to requests by id', async () => {
    const pair = createPortPair();
    fakeEngine(pair.right, { 'health.ping': { engineVersion: '7.5.6' } });
    const client = new EngineClient(pair.left);
    const [a, b] = await Promise.all([client.ping(), client.ping()]);
    expect(a).toEqual({ ok: true, value: { engineVersion: '7.5.6' } });
    expect(b).toEqual({ ok: true, value: { engineVersion: '7.5.6' } });
  });

  it('maps an engine error to an OrchError with a known code', async () => {
    const pair = createPortPair();
    fakeEngine(pair.right, { 'workflow.status': new Error('gone') });
    const client = new EngineClient(pair.left);
    const result = await client.request({ op: 'workflow.status', workflow: 'w-1' });
    expect(result).toEqual({ ok: false, error: { code: 'not_found', message: 'gone' } });
  });

  it('rejects an invalid request before it reaches the port', async () => {
    const posted: unknown[] = [];
    const port = {
      postMessage: (m: unknown) => posted.push(m),
      on: () => undefined,
    };
    const client = new EngineClient(port);
    const result = await client.request({ op: 'session.send', session: 's-1', text: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation_failed');
    expect(posted).toEqual([]);
  });

  it('fails pending and later calls as engine_unavailable after close', async () => {
    const pair = createPortPair();
    const client = new EngineClient(pair.left);
    const pending = client.request({ op: 'health.ping' });
    client.close();
    expect(await pending).toEqual({
      ok: false,
      error: { code: 'engine_unavailable', message: 'The engine is not running.', fix: expect.any(String) },
    });
    const after = await client.ping();
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe('engine_unavailable');
  });

  it('delivers valid engine events and drops invalid ones', async () => {
    const pair = createPortPair();
    const client = new EngineClient(pair.left);
    const seen: EngineEvent[] = [];
    const unsubscribe = client.onEvent((event) => seen.push(event));
    pair.right.postMessage({ type: 'engine.ready', engineVersion: '7.5.6' });
    pair.right.postMessage({ type: 'not.an.event' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();
    pair.right.postMessage({ type: 'engine.error', message: 'x', fatal: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([{ type: 'engine.ready', engineVersion: '7.5.6' }]);
  });

  it('unwraps MessageEvent-style payloads', async () => {
    const seen: unknown[] = [];
    let listener: ((raw: unknown) => void) | undefined;
    const port = {
      postMessage: () => undefined,
      on: (_e: 'message', l: (raw: unknown) => void) => {
        listener = l;
      },
    };
    const client = new EngineClient(port);
    client.onEvent((event) => seen.push(event));
    listener?.({ data: { type: 'engine.ready', engineVersion: '7.5.6' } });
    expect(seen).toEqual([{ type: 'engine.ready', engineVersion: '7.5.6' }]);
  });
});
