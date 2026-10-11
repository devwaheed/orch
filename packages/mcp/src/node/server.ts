import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type {
  IAccountsService,
  IJobsService,
  IQuotaService,
} from '@orch/contracts';
import { AccountId, AgentId, JobSpec, LimitPolicy } from '@orch/contracts';
import { ChannelClient } from '@orch/platform/src/channels/common/client.js';
import type { IChannelTransport } from '@orch/platform/src/channels/common/transport.js';
import { createCliSocketTransport, type CliSocketOptions } from './socketTransport.js';
import { createServicesFromClient, type CliServices } from './client.js';

export interface CliServicesForMcp {
  readonly client: ChannelClient;
  readonly accounts: IAccountsService;
  readonly jobs: IJobsService;
  readonly quota: IQuotaService;
  dispose(): void;
}

export function createMcpServicesFromClient(client: ChannelClient): CliServicesForMcp {
  return {
    client,
    accounts: client.getService<IAccountsService>('accounts'),
    jobs: client.getService<IJobsService>('jobs'),
    quota: client.getService<IQuotaService>('quota'),
    dispose(): void {
      client.dispose();
    },
  };
}

export async function connectMcpServices(
  transportOrOptions?: IChannelTransport | CliSocketOptions,
): Promise<CliServicesForMcp> {
  if (
    transportOrOptions &&
    typeof (transportOrOptions as IChannelTransport).send === 'function' &&
    typeof (transportOrOptions as IChannelTransport).onMessage === 'function'
  ) {
    const transport = transportOrOptions as IChannelTransport;
    const client = new ChannelClient(transport);
    return createMcpServicesFromClient(client);
  }

  const socketOptions = transportOrOptions as CliSocketOptions | undefined;
  const transport = await createCliSocketTransport(socketOptions);
  const client = new ChannelClient(transport);
  return createMcpServicesFromClient(client);
}

export interface OrchMcpServerOptions {
  services?: CliServicesForMcp;
  name?: string;
  version?: string;
}

export function createOrchMcpServer(options: OrchMcpServerOptions = {}) {
  const server = new McpServer({
    name: options.name ?? 'orch-mcp',
    version: options.version ?? '0.0.0',
  });

  // start job
  server.registerTool(
    'start_job',
    {
      description: 'Start a job',
      inputSchema: {
        spec: JobSpec,
      },
    },
    async ({ spec }) => {
      const services = options.services;
      if (!services) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: false, error: 'No services available' }),
            },
          ],
        };
      }
      const result = await services.jobs.start(spec);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );

  // spawn worker
  server.registerTool(
    'spawn_worker',
    {
      description: 'Spawn a worker for an orchestrator job',
      inputSchema: {
        jobId: z.string(),
        agent: AgentId.optional(),
        accountId: AccountId.optional(),
      },
    },
    async ({ jobId, agent, accountId }) => {
      const services = options.services;
      if (!services) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: false, error: 'No services available' }),
            },
          ],
        };
      }
      const jobResult = await services.jobs.get(jobId as any);
      if (!jobResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(jobResult),
            },
          ],
        };
      }
      const job = jobResult.value;
      const spec = job.spec;
      const workerAgent = agent ?? (spec as any).workers?.[0] ?? (spec as any).orchestrator?.agent;
      const startSpec: any = { ...spec, mode: spec.mode || 'single' };
      if (spec.mode === 'single' && accountId) {
        startSpec.orchestrator = { ...(spec as any).orchestrator, account: accountId };
      }
      const result = await services.jobs.start(startSpec);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );

  // get limits
  server.registerTool(
    'get_limits',
    {
      description: 'Get quota windows and pick an account',
      inputSchema: {
        agent: AgentId.optional(),
      },
    },
    async ({ agent }) => {
      const services = options.services;
      if (!services) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: false, error: 'No services available' }),
            },
          ],
        };
      }
      const windows = await services.quota.windows();
      let pick = null;
      if (agent) {
        pick = await services.quota.pickAccount(agent);
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ windows, pick }),
          },
        ],
      };
    },
  );

  // update plan
  server.registerTool(
    'update_plan',
    {
      description: 'Update job plan',
      inputSchema: {
        jobId: z.string(),
        plan: z.unknown(),
      },
    },
    async ({ jobId, plan }) => {
      const services = options.services;
      if (!services) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: false, error: 'No services available' }),
            },
          ],
        };
      }
      const result = await services.jobs.get(jobId as any);
      if (!result.ok) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
        };
      }
      const job = result.value;
      const updatedJob: any = { ...job, plan };
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, value: updatedJob }),
          },
        ],
      };
    },
  );

  return server;
}

export async function runStdioServer(options: OrchMcpServerOptions = {}) {
  const services = options.services ?? (await connectMcpServices());
  const server = createOrchMcpServer({ ...options, services });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return { server, services, transport };
}
