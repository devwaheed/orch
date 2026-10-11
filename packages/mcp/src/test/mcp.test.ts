import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { IJobsService, IQuotaService, Job, JobSpec } from '@orch/contracts';
import { ChannelClient } from '@orch/platform/src/channels/common/client.js';
import { createInProcessTransportPair } from '@orch/platform/src/channels/common/inProcess.js';
import { ChannelServer } from '@orch/platform/src/channels/common/server.js';
import { createOrchMcpServer, servicesFromClient } from '../node/server.js';

const spec: JobSpec = {
  mode: 'single',
  goal: 'Add a README',
  repoPath: '/repo',
  orchestrator: { agent: 'claude', account: 'auto' },
  workers: ['claude'],
  checks: [],
  onLimit: 'switch-account',
};

describe('orch-mcp (S4-06)', () => {
  it('an MCP client starts a job, and the call reaches the core host jobs service', async () => {
    const started: JobSpec[] = [];
    const jobs: Pick<IJobsService, 'start'> = {
      async start(s) {
        started.push(s);
        return { ok: true, value: { id: 'j-1', title: s.goal, spec: s, status: 'running', step: null, createdAt: '2026-10-12T00:00:00.000Z', scheduledFor: null } as Job };
      },
    };
    const quota: Pick<IQuotaService, 'windows'> = { async windows() { return { ok: true, value: [] }; } };

    const [coreSide, mcpSide] = createInProcessTransportPair();
    const core = new ChannelServer();
    core.registerService('jobs', jobs);
    core.registerService('quota', quota);
    core.handleConnection(coreSide);

    const server = createOrchMcpServer(servicesFromClient(new ChannelClient(mcpSide)));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'fake-orchestrator', version: '0' });
    await client.connect(clientTransport);

    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(['get_limits', 'start_job']);

    const result = await client.callTool({ name: 'start_job', arguments: { spec } });
    expect(result.isError).toBe(false);
    expect(started).toEqual([spec]);

    // A spec the contracts reject never reaches the core host.
    const bad = await client.callTool({ name: 'start_job', arguments: { spec: { mode: 'single' } } });
    expect(bad.isError).toBe(true);
    expect(started).toHaveLength(1);
    await client.close();
  });
});
