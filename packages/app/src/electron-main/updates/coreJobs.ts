/**
 * Asks the core host whether a job is active (S5-03, REL-02).
 *
 * Main keeps its own MessagePort to the core host (separate from the window's)
 * and calls `jobs.list()` over the channel, the same interface the window uses.
 * The update is installed on restart only when that reports no active job.
 *
 * Fail-safe: if the core host is not reachable, or the call fails, this reports
 * an active job so an update is never installed without confirmation.
 *
 * Gap (see story summary): `ISpecsService` exposes no read for the spec queue's
 * internal active jobs, and a live session is not a job, so only `jobs.list()` is
 * consulted. If REL-02 must also cover spec-queue runs, the contracts need a
 * method for it.
 */
import { MessageChannelMain, type MessagePortMain } from 'electron';
import type { IJobsService } from '@orch/contracts';
import { ChannelClient, MessagePortTransport, type MessagePortLike } from '@orch/platform/channels/common';
import { CHANNEL_SCHEMAS } from '../../node/channelSchemas.js';
import { hasActiveJob } from './activeJob.js';

export interface CoreJobMonitor {
  /** True when a job is running, or when the core host cannot be asked. */
  isJobActive(): Promise<boolean>;
  dispose(): void;
}

/** `postToCore` must hand the port to the running core host and report whether it could. */
export function createCoreJobMonitor(postToCore: (port: MessagePortMain) => boolean): CoreJobMonitor {
  const channel = new MessageChannelMain();
  const connected = postToCore(channel.port1);
  const transport = new MessagePortTransport(channel.port2 as unknown as MessagePortLike);
  const client = new ChannelClient(transport);
  const jobs = client.getService<IJobsService>('jobs', CHANNEL_SCHEMAS.jobs);

  return {
    async isJobActive(): Promise<boolean> {
      if (!connected) return true;
      const result = await jobs.list();
      if (!result.ok) return true;
      return hasActiveJob(result.value);
    },
    dispose(): void {
      client.dispose();
    },
  };
}
