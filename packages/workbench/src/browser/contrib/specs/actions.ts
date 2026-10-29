/**
 * What the Specs screen does with the core: load the queue, control it (pause/resume/cancel),
 * change settings, and per-spec actions (skip/retry/move). Each action takes the specs port it
 * calls, so tests pass a fake.
 */
import type {
  ISpecsService,
  QueueId,
  Result,
  SpecQueueSettings,
  SpecUsageHour,
} from '@orchagents/contracts';
import { SpecId } from '@orchagents/contracts';
import { useSpecsUiStore } from './stores/specsUi.js';
import { useSpecsStore } from '../../services/stores/specs.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';

/** The part of the core's specs service this area calls. */
export type SpecsPort = Pick<
  ISpecsService,
  'load' | 'start' | 'pause' | 'resume' | 'cancel' | 'updateSettings' | 'move' | 'skip' | 'retry'
>;

/** The part of the core's specs service the Plan view calls for its charts. */
export type SpecsUsagePort = Pick<ISpecsService, 'usage'>;

/** The part of the core's specs service the SaaS Factory strip calls. */
export type FactoryStatusPort = Pick<ISpecsService, 'factoryStatus'>;

/** Loads the spec queue for the active project's repo path. */
export async function loadQueue(port: SpecsPort): Promise<void> {
  const repoPath = useWorkbenchStore.getState().activeProject;
  if (!repoPath) {
    return;
  }
  useSpecsUiStore.getState().setLoadError(null);
  const reply = await port.load(repoPath);
  if (reply.ok) {
    const { queue, problems } = reply.value;
    useSpecsUiStore.getState().setProblems(problems);
    if (queue) {
      useSpecsStore.getState().upsertQueue(queue);
    }
  } else {
    useSpecsUiStore.getState().setLoadError(reply.error);
  }
}

/** Starts the queue. */
export async function startQueue(port: SpecsPort, queueId: QueueId): Promise<void> {
  const reply = await port.start(queueId);
  if (!reply.ok) useSpecsUiStore.getState().setLoadError(reply.error);
}

/** Pauses the queue. */
export async function pauseQueue(port: SpecsPort, queueId: QueueId): Promise<void> {
  const reply = await port.pause(queueId);
  if (!reply.ok) useSpecsUiStore.getState().setLoadError(reply.error);
}

/** Resumes the queue. */
export async function resumeQueue(port: SpecsPort, queueId: QueueId): Promise<void> {
  const reply = await port.resume(queueId);
  if (!reply.ok) useSpecsUiStore.getState().setLoadError(reply.error);
}

/** Cancels the queue. */
export async function cancelQueue(port: SpecsPort, queueId: QueueId): Promise<void> {
  const reply = await port.cancel(queueId);
  if (!reply.ok) useSpecsUiStore.getState().setLoadError(reply.error);
}

/** Updates queue settings. */
export async function updateQueueSettings(
  port: SpecsPort,
  queueId: QueueId,
  settings: Partial<SpecQueueSettings>,
): Promise<void> {
  useSpecsUiStore.getState().setSaving(true);
  const reply = await port.updateSettings(queueId, settings);
  useSpecsUiStore.getState().setSaving(false);
  if (!reply.ok) useSpecsUiStore.getState().setLoadError(reply.error);
}

/** Moves a spec to a new position. */
export async function moveSpec(port: SpecsPort, queueId: QueueId, specId: string | SpecId, toPosition: number): Promise<void> {
  const parsed = typeof specId === 'string' ? SpecId.parse(specId) : specId;
  const reply = await port.move(queueId, parsed, toPosition);
  if (!reply.ok) useSpecsUiStore.getState().setLoadError(reply.error);
}

/** Skips a spec. */
export async function skipSpec(port: SpecsPort, queueId: QueueId, specId: string | SpecId): Promise<void> {
  const parsed = typeof specId === 'string' ? SpecId.parse(specId) : specId;
  const reply = await port.skip(queueId, parsed);
  if (!reply.ok) useSpecsUiStore.getState().setLoadError(reply.error);
}

/** Retries a spec. */
export async function retrySpec(port: SpecsPort, queueId: QueueId, specId: string | SpecId): Promise<void> {
  const parsed = typeof specId === 'string' ? SpecId.parse(specId) : specId;
  const reply = await port.retry(queueId, parsed);
  if (!reply.ok) useSpecsUiStore.getState().setLoadError(reply.error);
}

/** Loads one spec's tokens and cost per hour for the Plan charts. */
export async function loadSpecUsage(
  port: SpecsUsagePort,
  queueId: QueueId,
  specId: string | SpecId,
): Promise<Result<SpecUsageHour[]>> {
  const parsed = typeof specId === 'string' ? SpecId.parse(specId) : specId;
  return port.usage(queueId, parsed);
}

/**
 * Loads the active project's SaaS Factory status. null and not_found both mean "show
 * nothing" (not a factory product / factory not installed); any other error is one line.
 */
export async function loadFactoryStatus(port: FactoryStatusPort, repoPath: string): Promise<void> {
  useSpecsUiStore.getState().setFactory(null, null);
  const reply = await port.factoryStatus(repoPath);
  // The project changed while the call was in flight; its status isn't this project's.
  if (useWorkbenchStore.getState().activeProject !== repoPath) return;
  if (!reply.ok) {
    if (reply.error.code === 'not_found') return;
    useSpecsUiStore.getState().setFactory(null, reply.error.message);
    return;
  }
  useSpecsUiStore.getState().setFactory(reply.value, null);
}

/** Switches to the Specs area in Live view. */
export function openSpecsLive(): void {
  useWorkbenchStore.getState().setActiveArea('specs');
  useSpecsUiStore.getState().setView('live');
}

/** Opens the selected spec in the Specs Live view, used by Product → Map. */
export function watchSpecLive(specId: string): void {
  // Entering Live opens the selected spec's running run on its own (SpecsScreen), like Watch live there.
  useSpecsUiStore.getState().setSelectedId(specId);
  useSpecsUiStore.getState().setView('live');
  useWorkbenchStore.getState().setActiveArea('specs');
}

/** Switches to the Specs area in Queue view, expanding the spec row and scrolling it into view. */
export function openSpecInQueue(specId: string): void {
  useWorkbenchStore.getState().setActiveArea('specs');
  useWorkbenchStore.getState().setActiveRoute('/specs');
  useSpecsUiStore.getState().setView('list');
  useSpecsUiStore.getState().setExpandedId(specId);
  setTimeout(() => {
    const el = document.getElementById(`spec-row-${specId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 50);
}

