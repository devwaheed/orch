/**
 * Serves an engine host over a port. Every inbound envelope is validated with
 * the contracts schemas before the host sees it, so a request with a
 * non-allowlisted env is answered validation_failed and never reaches Claw
 * (ENG-05). Every outbound reply and event is validated too.
 */
import { EngineEnvelope, EngineEvent, EngineReply, type EngineRequest, type OrchError } from '@orchagents/contracts';
import { type EnginePort, unwrapPortMessage } from '../common/engineClient.js';
import { ENGINE_COPY } from '../common/strings.js';
import type { HostResult } from './engineHost.js';

export interface EngineHandler {
  handle(request: EngineRequest): Promise<HostResult>;
  onEvent(listener: (event: EngineEvent) => void): () => void;
  readonly readyEvent?: EngineEvent;
}

export interface ServedEngine {
  close(): void;
}

function invalidRequest(): OrchError {
  return { code: 'validation_failed', message: ENGINE_COPY.invalidRequest.message, fix: ENGINE_COPY.invalidRequest.fix };
}

export function serveEngine(handler: EngineHandler, port: EnginePort): ServedEngine {
  let closed = false;

  const reply = (id: number, result: HostResult): void => {
    if (closed) return;
    const message = result.ok
      ? { id, ok: true, value: result.value ?? null }
      : { id, ok: false, error: { code: result.error.code, message: result.error.message } };
    const parsed = EngineReply.safeParse(message);
    if (parsed.success) port.postMessage(parsed.data);
  };

  port.on('message', (raw) => {
    if (closed) return;
    const message = unwrapPortMessage(raw);
    const envelope = EngineEnvelope.safeParse(message);
    if (!envelope.success) {
      // Reply only when the id is usable; otherwise there is nobody to answer.
      const id = (message as { id?: unknown } | null)?.id;
      if (typeof id === 'number' && Number.isInteger(id) && id >= 0) {
        reply(id, { ok: false, error: invalidRequest() });
      }
      return;
    }
    const { id, request } = envelope.data;
    void handler.handle(request).then((result) => reply(id, result));
  });

  const unsubscribe = handler.onEvent((event) => {
    if (closed) return;
    const parsed = EngineEvent.safeParse(event);
    if (parsed.success) port.postMessage(parsed.data);
  });

  // The engine announced itself before this port attached: say so now.
  if (handler.readyEvent) {
    const ready = EngineEvent.safeParse(handler.readyEvent);
    if (ready.success) port.postMessage(ready.data);
  }

  return {
    close() {
      closed = true;
      unsubscribe();
    },
  };
}
