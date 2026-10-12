import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { Emitter, err, ok } from '@orchagents/base';
import type { IEventsService, OrchEvent, Result } from '@orchagents/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ChannelClient,
  ChannelServer,
  createInProcessTransportPair,
  createMessagePortTransport,
  createMethodSchema,
  type ChannelAbortSignal,
  type ServiceSchemaMap,
} from './common/index.js';
import { createSocketClientTransport, SocketServer } from './node/index.js';

interface IFakeService {
  echo(text: string): Promise<Result<string>>;
  add(a: number, b: number): Promise<Result<number>>;
  slowOperation(delayMs: number, signal?: ChannelAbortSignal): Promise<Result<string>>;
  throwError(): Promise<Result<string>>;
  returnInvalidResult(): Promise<Result<string>>;
}

const fakeServiceSchemas: ServiceSchemaMap<IFakeService> = {
  echo: createMethodSchema(z.tuple([z.string()]), z.string()),
  add: createMethodSchema(z.tuple([z.number(), z.number()]), z.number()),
  slowOperation: createMethodSchema(z.tuple([z.number()]), z.string()),
  throwError: createMethodSchema(z.tuple([]), z.string()),
  returnInvalidResult: createMethodSchema(z.tuple([]), z.string()),
};

class FakeEventsService implements IEventsService {
  private readonly emitter = new Emitter<OrchEvent>();
  activeSubscriptions = 0;

  subscribe(listener: (event: OrchEvent) => void): () => void {
    this.activeSubscriptions += 1;
    const disposable = this.emitter.event(listener);
    return () => {
      this.activeSubscriptions -= 1;
      disposable.dispose();
    };
  }

  emit(event: OrchEvent): void {
    this.emitter.fire(event);
  }
}

interface TestContext {
  client: ChannelClient;
  killPeer: () => Promise<void> | void;
  cleanup: () => Promise<void> | void;
}

interface TransportSuite {
  name: string;
  createContext: (server: ChannelServer) => Promise<TestContext>;
}

const suites: TransportSuite[] = [
  {
    name: 'in-process',
    createContext: async (server: ChannelServer) => {
      const [clientTransport, serverTransport] = createInProcessTransportPair();
      server.handleConnection(serverTransport);
      const client = new ChannelClient(clientTransport);
      return {
        client,
        killPeer: () => {
          serverTransport.close();
        },
        cleanup: () => {
          client.dispose();
          serverTransport.close();
        },
      };
    },
  },
  {
    name: 'MessagePort',
    createContext: async (server: ChannelServer) => {
      const { port1, port2 } = new MessageChannel();
      const serverTransport = createMessagePortTransport(port2);
      server.handleConnection(serverTransport);
      const clientTransport = createMessagePortTransport(port1);
      const client = new ChannelClient(clientTransport);
      return {
        client,
        killPeer: () => {
          port2.close();
        },
        cleanup: () => {
          client.dispose();
          serverTransport.close();
        },
      };
    },
  },
  {
    name: 'local socket',
    createContext: async (server: ChannelServer) => {
      const id = Math.random().toString(36).slice(2);
      const socketPath =
        process.platform === 'win32'
          ? `\\\\.\\pipe\\orch-test-${Date.now()}-${id}`
          : path.join(os.tmpdir(), `orch-test-${Date.now()}-${id}.sock`);
      const token = `token-${id}`;

      const socketServer = new SocketServer({ socketPath, token, channelServer: server });
      await socketServer.start();

      const clientTransport = await createSocketClientTransport({ socketPath, token });
      const client = new ChannelClient(clientTransport);

      return {
        client,
        killPeer: () => {
          clientTransport.close();
        },
        cleanup: async () => {
          client.dispose();
          await socketServer.close();
        },
      };
    },
  },
];

describe.each(suites)('Shared Transport Suite: $name', ({ createContext }) => {
  it('calls a service method with valid payload and receives result', async () => {
    const fakeService: IFakeService = {
      echo: async (text) => ok(text),
      add: async (a, b) => ok(a + b),
      slowOperation: async () => ok('done'),
      throwError: async () => ok('ok'),
      returnInvalidResult: async () => ok('ok'),
    };

    const server = new ChannelServer();
    server.registerService('fake', fakeService, fakeServiceSchemas);

    const { client, cleanup } = await createContext(server);
    try {
      const proxy = client.getService<IFakeService>('fake', fakeServiceSchemas);
      const echoResult = await proxy.echo('hello world');
      expect(echoResult).toEqual({ ok: true, value: 'hello world' });

      const addResult = await proxy.add(10, 32);
      expect(addResult).toEqual({ ok: true, value: 42 });
    } finally {
      await cleanup();
      server.dispose();
    }
  });

  it('returns validation_failed for invalid arguments payload', async () => {
    const fakeService: IFakeService = {
      echo: async (text) => ok(text),
      add: async (a, b) => ok(a + b),
      slowOperation: async () => ok('done'),
      throwError: async () => ok('ok'),
      returnInvalidResult: async () => ok('ok'),
    };

    const server = new ChannelServer();
    server.registerService('fake', fakeService, fakeServiceSchemas);

    const { client, cleanup } = await createContext(server);
    try {
      const proxy = client.getService<IFakeService>('fake', fakeServiceSchemas);
      // Pass number instead of string for echo
      const badCall = proxy.echo(123 as unknown as string);
      const res = await badCall;
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('validation_failed');
      }
    } finally {
      await cleanup();
      server.dispose();
    }
  });

  it('returns validation_failed when service returns payload violating schema', async () => {
    const fakeService: IFakeService = {
      echo: async (text) => ok(text),
      add: async (a, b) => ok(a + b),
      slowOperation: async () => ok('done'),
      throwError: async () => ok('ok'),
      // Returns a number violating the schema's z.string()
      returnInvalidResult: async () => ok(9999 as unknown as string),
    };

    const server = new ChannelServer();
    server.registerService('fake', fakeService, fakeServiceSchemas);

    const { client, cleanup } = await createContext(server);
    try {
      const proxy = client.getService<IFakeService>('fake', fakeServiceSchemas);
      const res = await proxy.returnInvalidResult();
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('validation_failed');
      }
    } finally {
      await cleanup();
      server.dispose();
    }
  });

  it('returns not_found for unknown method', async () => {
    const server = new ChannelServer();
    const { client, cleanup } = await createContext(server);
    try {
      interface INonExistentService {
        missingMethod(): Promise<Result<void>>;
      }
      const proxy = client.getService<INonExistentService>('nonexistent');
      const res = await proxy.missingMethod();
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('not_found');
      }
    } finally {
      await cleanup();
      server.dispose();
    }
  });

  it('catches handler exceptions and returns internal error without leaking details', async () => {
    const fakeService: IFakeService = {
      echo: async (text) => ok(text),
      add: async (a, b) => ok(a + b),
      slowOperation: async () => ok('done'),
      throwError: async () => {
        throw new Error('SUPER_SECRET_TOKEN_LEAK_TEST');
      },
      returnInvalidResult: async () => ok('ok'),
    };

    const server = new ChannelServer();
    server.registerService('fake', fakeService, fakeServiceSchemas);

    const { client, cleanup } = await createContext(server);
    try {
      const proxy = client.getService<IFakeService>('fake', fakeServiceSchemas);
      const res = await proxy.throwError();
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('internal');
        expect(res.error.message).not.toContain('SUPER_SECRET_TOKEN_LEAK_TEST');
      }
    } finally {
      await cleanup();
      server.dispose();
    }
  });

  it('streams OrchEvents and unsubscribes cleanly', async () => {
    const eventsService = new FakeEventsService();
    const server = new ChannelServer(eventsService);

    const { client, cleanup } = await createContext(server);
    try {
      const receivedEvents: OrchEvent[] = [];
      const unsub = client.events.subscribe((event) => {
        receivedEvents.push(event);
      });

      // Wait a microtask tick for subscription to register on server
      await new Promise((r) => setTimeout(r, 50));
      expect(eventsService.activeSubscriptions).toBe(1);

      const testEvent: OrchEvent = {
        type: 'engine.health',
        state: 'ready',
      };
      eventsService.emit(testEvent);

      await new Promise((r) => setTimeout(r, 50));
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toEqual(testEvent);

      // Unsubscribe
      unsub();
      await new Promise((r) => setTimeout(r, 50));
      expect(eventsService.activeSubscriptions).toBe(0);

      // Emit another event, should not be received
      eventsService.emit({
        type: 'engine.health',
        state: 'failed',
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(receivedEvents).toHaveLength(1);
    } finally {
      await cleanup();
      server.dispose();
    }
  });

  it('cleanly unsubscribes server-side event stream when peer is killed', async () => {
    const eventsService = new FakeEventsService();
    const server = new ChannelServer(eventsService);

    const { client, killPeer, cleanup } = await createContext(server);
    try {
      client.events.subscribe(() => undefined);
      await new Promise((r) => setTimeout(r, 50));
      expect(eventsService.activeSubscriptions).toBe(1);

      // Kill the peer connection
      await killPeer();
      await new Promise((r) => setTimeout(r, 100));

      expect(eventsService.activeSubscriptions).toBe(0);
    } finally {
      await cleanup();
      server.dispose();
    }
  });

  it('aborts server-side pending call and rejects pending client call on disconnect', async () => {
    let abortedOnServer = false;
    let abortFiredPromiseResolve: () => void = () => undefined;
    const abortFired = new Promise<void>((r) => {
      abortFiredPromiseResolve = r;
    });

    const fakeService: IFakeService = {
      echo: async (text) => ok(text),
      add: async (a, b) => ok(a + b),
      slowOperation: async (_delayMs, signal) => {
        return new Promise<Result<string>>((resolve) => {
          signal?.addEventListener?.('abort', () => {
            abortedOnServer = true;
            abortFiredPromiseResolve();
            resolve(err({ code: 'internal', message: 'aborted' }));
          });
        });
      },
      throwError: async () => ok('ok'),
      returnInvalidResult: async () => ok('ok'),
    };

    const server = new ChannelServer();
    server.registerService('fake', fakeService, fakeServiceSchemas);

    const { client, killPeer, cleanup } = await createContext(server);
    try {
      const proxy = client.getService<IFakeService>('fake', fakeServiceSchemas);
      const callPromise = proxy.slowOperation(10000);

      // Wait for call to arrive on server
      await new Promise((r) => setTimeout(r, 50));

      // Disconnect peer
      await killPeer();

      // Client-side pending call must resolve with internal error
      const clientRes = await callPromise;
      expect(clientRes.ok).toBe(false);
      if (!clientRes.ok) {
        expect(clientRes.error.code).toBe('internal');
      }

      // Server-side AbortSignal must abort
      await abortFired;
      expect(abortedOnServer).toBe(true);
    } finally {
      await cleanup();
      server.dispose();
    }
  });
});

describe('Socket Server Specifics', () => {
  it('refuses connection and closes socket when client provides wrong token', async () => {
    const id = Math.random().toString(36).slice(2);
    const socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\orch-test-wrong-token-${Date.now()}-${id}`
        : path.join(os.tmpdir(), `orch-test-wrong-token-${Date.now()}-${id}.sock`);
    const validToken = `valid-${id}`;
    const wrongToken = `wrong-${id}`;

    const server = new ChannelServer();
    const socketServer = new SocketServer({ socketPath, token: validToken, channelServer: server });
    await socketServer.start();

    try {
      await expect(
        createSocketClientTransport({ socketPath, token: wrongToken }),
      ).rejects.toThrow();
    } finally {
      await socketServer.close();
      server.dispose();
    }
  });

  it('sets owner-only permissions (chmod 0600) on Unix socket file', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const id = Math.random().toString(36).slice(2);
    const socketPath = path.join(os.tmpdir(), `orch-test-perm-${Date.now()}-${id}.sock`);
    const token = `token-${id}`;

    const server = new ChannelServer();
    const socketServer = new SocketServer({ socketPath, token, channelServer: server });
    await socketServer.start();

    try {
      const stats = fs.statSync(socketPath);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      await socketServer.close();
      server.dispose();
    }
  });

  it('cleans up stale socket file before listening on Unix', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const id = Math.random().toString(36).slice(2);
    const socketPath = path.join(os.tmpdir(), `orch-test-stale-${Date.now()}-${id}.sock`);
    const token = `token-${id}`;

    // Create a stale file
    fs.writeFileSync(socketPath, 'stale content');
    expect(fs.existsSync(socketPath)).toBe(true);

    const server = new ChannelServer();
    const socketServer = new SocketServer({ socketPath, token, channelServer: server });
    await socketServer.start();

    try {
      expect(fs.existsSync(socketPath)).toBe(true);
      const clientTransport = await createSocketClientTransport({ socketPath, token });
      expect(clientTransport.isClosed).toBe(false);
      clientTransport.close();
    } finally {
      await socketServer.close();
      server.dispose();
    }
  });
});
