/**
 * Typed client for the Electron preload bridge (window.orch).
 * Per docs/architecture.md "The preload bridge". No Node APIs in browser/.
 *
 * The core host's MessagePort never travels through contextBridge. The preload
 * posts it to the page as a window 'message' with data 'orch:port' (see
 * packages/app/src/electron-preload/api.ts, ORCH_PORT_MESSAGE). connectCore()
 * wraps that into a Promise<MessagePort>.
 */
import type { OrchError } from '@orchagents/contracts';
import { dataStrings } from './dataStrings.js';

export type OrchOs = 'macos' | 'linux' | 'windows';

export interface OrchAppBridge {
  readonly version: string;
  readonly os: OrchOs;
  readonly home?: string;
  openExternal(url: string): Promise<void>;
  showItemInFolder(path: string): Promise<void>;
  chooseFolder(): Promise<string | null>;
  onUpdateReady(cb: () => void): () => void;
  onOpenProject(cb: (path: string) => void): () => void;
  cliCommand: { readonly offered: boolean; install(): Promise<void>; uninstall(): Promise<void>; machineCheckFinished(cliOnPath: boolean): Promise<void> };
  onReportProblem(cb: () => void): () => void;
  openNewIssue(): Promise<void>;
  restartEngine(): Promise<void>;
  requestNotification?(options: { title: string; body: string }): Promise<void>;
}

/** window.orch as exposed by the preload. connect() resolves once the port has been posted to the page. */
export interface OrchBridge {
  connect(): Promise<void>;
  app: OrchAppBridge;
}

declare global {
  interface Window {
    orch?: OrchBridge;
  }
}

/** The window message the preload uses to hand over the core host port. Must match ORCH_PORT_MESSAGE in the preload. */
export const ORCH_PORT_MESSAGE = 'orch:port';

/**
 * How long the window waits for the core host port before it gives up.
 * LEAD-CHOSEN internal value, listed for owner review.
 */
export const CORE_CONNECT_TIMEOUT_MS = 10_000;

function detectFallbackOS(): OrchOs {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('mac')) {
      return 'macos';
    }
    if (ua.includes('win')) {
      return 'windows';
    }
    if (ua.includes('linux')) {
      return 'linux';
    }
  }
  return 'macos';
}

/** Used when the page runs outside Electron (vite dev). It has no core host, so connectCore() times out. */
export const fallbackBridge: OrchBridge = {
  async connect(): Promise<void> {
    return undefined;
  },
  app: {
    version: '0.0.0-dev',
    os: detectFallbackOS(),
    home: '',
    async openExternal(url: string): Promise<void> {
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },
    async showItemInFolder(path: string): Promise<void> {
      void path;
    },
    async chooseFolder(): Promise<string | null> {
      return null;
    },
    onUpdateReady(cb: () => void): () => void {
      void cb;
      return () => undefined;
    },
    onOpenProject(cb: (path: string) => void): () => void {
      void cb;
      return () => undefined;
    },
    cliCommand: {
      offered: false,
      async install(): Promise<void> { return undefined; },
      async uninstall(): Promise<void> { return undefined; },
      async machineCheckFinished(cliOnPath: boolean): Promise<void> { void cliOnPath; },
    },
    onReportProblem(cb: () => void): () => void {
      void cb;
      return () => undefined;
    },
    async openNewIssue(): Promise<void> {
      return undefined;
    },
    async restartEngine(): Promise<void> {
      return undefined;
    },
    async requestNotification(options: { title: string; body: string }): Promise<void> {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(options.title, { body: options.body });
      }
    },
  },
};

export function getOrchBridge(): OrchBridge {
  if (typeof window !== 'undefined' && window.orch) {
    return window.orch;
  }
  return fallbackBridge;
}

/** The message target: the page window, or a stand-in in tests. */
export interface PortMessageTarget {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

export interface ConnectCoreOptions {
  readonly bridge?: OrchBridge;
  readonly target?: PortMessageTarget;
  readonly timeoutMs?: number;
}

function coreUnavailable(): OrchError {
  return {
    code: 'internal',
    message: dataStrings.coreUnavailable.message,
    fix: dataStrings.coreUnavailable.fix,
  };
}

/**
 * Asks the preload for the core host port and resolves with it.
 * Rejects with an OrchError-shaped object (code 'internal') if the preload reports
 * the core host is unavailable, or if no port arrives within timeoutMs.
 *
 * The listener is attached before connect() is called, so a port posted during
 * the call is never missed.
 */
export function connectCore(options: ConnectCoreOptions = {}): Promise<MessagePort> {
  const bridge = options.bridge ?? getOrchBridge();
  const target: PortMessageTarget | undefined =
    options.target ?? (typeof window !== 'undefined' ? window : undefined);
  const timeoutMs = options.timeoutMs ?? CORE_CONNECT_TIMEOUT_MS;

  return new Promise<MessagePort>((resolve, reject) => {
    if (!target) {
      reject(coreUnavailable());
      return;
    }

    let settled = false;

    const finish = (): void => {
      settled = true;
      clearTimeout(timer);
      target.removeEventListener('message', onMessage);
    };

    const onMessage = (event: MessageEvent): void => {
      if (settled || event.data !== ORCH_PORT_MESSAGE) {
        return;
      }
      const port = event.ports[0] as MessagePort | undefined;
      if (!port) {
        return;
      }
      finish();
      resolve(port);
    };

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      finish();
      reject(coreUnavailable());
    }, timeoutMs);

    target.addEventListener('message', onMessage);
    bridge.connect().catch(() => {
      if (settled) {
        return;
      }
      finish();
      reject(coreUnavailable());
    });
  });
}

export class OrchClient {
  constructor(private readonly bridge: OrchBridge = getOrchBridge()) {}

  get version(): string {
    return this.bridge.app.version;
  }

  get os(): OrchOs {
    return this.bridge.app.os;
  }

  get home(): string {
    return this.bridge.app.home ?? '';
  }

  /** Asks main for the core host port. Use connectCore() to get the port itself. */
  async connect(): Promise<void> {
    return this.bridge.connect();
  }

  async openExternal(url: string): Promise<void> {
    return this.bridge.app.openExternal(url);
  }

  async showItemInFolder(path: string): Promise<void> {
    return this.bridge.app.showItemInFolder(path);
  }

  onUpdateReady(cb: () => void): () => void {
    return this.bridge.app.onUpdateReady(cb);
  }

  onReportProblem(cb: () => void): () => void {
    return this.bridge.app.onReportProblem(cb);
  }

  async openNewIssue(): Promise<void> {
    return this.bridge.app.openNewIssue();
  }

  async restartEngine(): Promise<void> {
    return this.bridge.app.restartEngine();
  }

  async requestNotification(title: string, body: string): Promise<void> {
    if (this.bridge.app.requestNotification) {
      await this.bridge.app.requestNotification({ title, body });
    }
  }
}
