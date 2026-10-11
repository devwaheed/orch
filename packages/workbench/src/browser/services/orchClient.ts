/**
 * Typed client for the Electron preload bridge (window.orch).
 * Per docs/architecture.md "The preload bridge".
 * No Node APIs in browser/.
 */

export interface OrchAppBridge {
  readonly version: string;
  readonly os: 'macos' | 'linux' | 'windows';
  openExternal(url: string): Promise<void>;
  showItemInFolder(path: string): Promise<void>;
  onUpdateReady(cb: () => void): () => void;
  requestNotification?(options: { title: string; body: string }): Promise<void>;
}

export interface OrchBridge {
  connect(): Promise<MessagePort>;
  app: OrchAppBridge;
}

declare global {
  interface Window {
    orch?: OrchBridge;
  }
}

function detectFallbackOS(): 'macos' | 'linux' | 'windows' {
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

export const fallbackBridge: OrchBridge = {
  async connect(): Promise<MessagePort> {
    const channel = new MessageChannel();
    return channel.port1;
  },
  app: {
    version: '0.0.0-dev',
    os: detectFallbackOS(),
    async openExternal(url: string): Promise<void> {
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },
    async showItemInFolder(path: string): Promise<void> {
      void path;
    },
    onUpdateReady(cb: () => void): () => void {
      void cb;
      return () => undefined;
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

export class OrchClient {
  constructor(private readonly bridge: OrchBridge = getOrchBridge()) {}

  get version(): string {
    return this.bridge.app.version;
  }

  get os(): 'macos' | 'linux' | 'windows' {
    return this.bridge.app.os;
  }

  async connect(): Promise<MessagePort> {
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

  async requestNotification(title: string, body: string): Promise<void> {
    if (this.bridge.app.requestNotification) {
      await this.bridge.app.requestNotification({ title, body });
    }
  }
}
