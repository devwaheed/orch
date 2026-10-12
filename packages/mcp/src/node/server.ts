/**
 * orch-mcp (S4-06, ADR 0007): orch services as MCP tools over stdio, for an
 * orchestrator agent. Every call goes to the core host through the channel client.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AgentId, JobSpec, type IJobsService, type IQuotaService, type Result } from '@orchagents/contracts';
import { ChannelClient } from '@orchagents/platform/src/channels/common/client.js';
import type { IChannelTransport } from '@orchagents/platform/src/channels/common/transport.js';
import { createCliSocketTransport, type CliSocketOptions } from './socketTransport.js';

export interface McpServices {
  readonly jobs: IJobsService;
  readonly quota: IQuotaService;
}

export function servicesFromClient(client: ChannelClient): McpServices {
  return { jobs: client.getService<IJobsService>('jobs'), quota: client.getService<IQuotaService>('quota') };
}

/** A tool reply: the service Result as JSON; a failed Result is an MCP tool error. */
function reply(result: Result<unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: !result.ok };
}

// ponytail: "spawn worker" and "update plan" (S4-06) are not exposed: no contract method
// spawns a run inside a job or stores a plan. Add them once the contracts carry them.
export function createOrchMcpServer(services: McpServices): McpServer {
  const server = new McpServer({ name: 'orch', version: '0.0.0' });

  server.registerTool(
    'start_job',
    { description: 'Start an orch job from a job spec.', inputSchema: { spec: JobSpec } },
    async ({ spec }) => reply(await services.jobs.start(spec)),
  );

  server.registerTool(
    'get_limits',
    {
      description: 'Usage windows for every account; with an agent, the account orch would use for it next.',
      inputSchema: { agent: AgentId.optional() },
    },
    async ({ agent }) => {
      const windows = await services.quota.windows();
      if (!windows.ok || !agent) return reply(windows);
      const pick = await services.quota.pickAccount(agent);
      return reply(pick.ok ? { ok: true, value: { windows: windows.value, pick: pick.value } } : pick);
    },
  );

  return server;
}

/** Serves MCP on stdio, connected to the running core host's socket. */
export async function runStdioServer(transport?: IChannelTransport | CliSocketOptions): Promise<void> {
  const channel =
    transport && 'send' in transport ? transport : await createCliSocketTransport(transport);
  const server = createOrchMcpServer(servicesFromClient(new ChannelClient(channel)));
  await server.connect(new StdioServerTransport());
}
