/** Two connected in-memory ports. Messages are structured-cloned, as a real port would copy them. */
import type { EnginePort } from '../common/engineClient.js';

export function createPortPair(): { left: EnginePort; right: EnginePort } {
  const leftListeners = new Set<(message: unknown) => void>();
  const rightListeners = new Set<(message: unknown) => void>();
  const deliver = (listeners: Set<(message: unknown) => void>, message: unknown): void => {
    const copy = structuredClone(message);
    queueMicrotask(() => {
      for (const listener of listeners) listener(copy);
    });
  };
  const port = (inbox: Set<(message: unknown) => void>, outbox: Set<(message: unknown) => void>): EnginePort => ({
    postMessage: (message) => deliver(outbox, message),
    on: (_event, listener) => {
      inbox.add(listener);
      return undefined;
    },
  });
  return {
    left: port(leftListeners, rightListeners),
    right: port(rightListeners, leftListeners),
  };
}
