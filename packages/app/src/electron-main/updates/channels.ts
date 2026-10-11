/**
 * The IPC channel main uses to tell the window an update is ready (S5-03).
 *
 * The preload bridge (`electron-preload/api.ts`, `BRIDGE_CHANNELS.updateReady`)
 * listens on this channel through `window.orch.app.onUpdateReady`. Main must not
 * import the preload module (different environment), so the wire name is
 * repeated here and a test pins the two together.
 */
export const UPDATE_READY_CHANNEL = 'orch:update-ready';
