/**
 * The message a utility-process host posts to its parent once it has started
 * (Electron main, or the Node parent in headless mode). Main resets the ENG-07
 * backoff on it. Shared by the host entries and the main process.
 */
export const HOST_READY_MESSAGE = { type: 'orch.host.ready' } as const;

export function isHostReadyMessage(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === HOST_READY_MESSAGE.type
  );
}
