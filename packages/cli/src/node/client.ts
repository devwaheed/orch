import type {
  IAccountsService,
  IDoctorService,
  IJobsService,
  IQuotaService,
  IRunsService,
  ISessionsService,
  IShellService,
} from '@orchagents/contracts';
import { ChannelClient } from '@orchagents/platform/src/channels/common/client.js';
import type { IChannelTransport } from '@orchagents/platform/src/channels/common/transport.js';
import { createCliSocketTransport, type CliSocketOptions } from './socketTransport.js';

export interface CliServices {
  readonly client: ChannelClient;
  readonly accounts: IAccountsService;
  readonly doctor: IDoctorService;
  readonly jobs: IJobsService;
  readonly runs: IRunsService;
  readonly quota: IQuotaService;
  readonly sessions: ISessionsService;
  readonly shells: IShellService;
  dispose(): void;
}

export function createServicesFromClient(client: ChannelClient): CliServices {
  return {
    client,
    accounts: client.getService<IAccountsService>('accounts'),
    doctor: client.getService<IDoctorService>('doctor'),
    jobs: client.getService<IJobsService>('jobs'),
    runs: client.getService<IRunsService>('runs'),
    quota: client.getService<IQuotaService>('quota'),
    sessions: client.getService<ISessionsService>('sessions'),
    shells: client.getService<IShellService>('shells'),
    dispose(): void {
      client.dispose();
    },
  };
}

export async function connectCliServices(
  transportOrOptions?: IChannelTransport | CliSocketOptions,
): Promise<CliServices> {
  if (
    transportOrOptions &&
    typeof (transportOrOptions as IChannelTransport).send === 'function' &&
    typeof (transportOrOptions as IChannelTransport).onMessage === 'function'
  ) {
    const transport = transportOrOptions as IChannelTransport;
    const client = new ChannelClient(transport);
    return createServicesFromClient(client);
  }

  const socketOptions = transportOrOptions as CliSocketOptions | undefined;
  const transport = await createCliSocketTransport(socketOptions);
  const client = new ChannelClient(transport);
  return createServicesFromClient(client);
}
