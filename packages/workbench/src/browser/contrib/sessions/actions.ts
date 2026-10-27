/**
 * The resume action. Calls ISessionsService.resume through the typed proxy, never throws,
 * and reports failures as the OrchError the core sent (message and fix).
 */
import type { ResumeRequest } from '@orchagents/contracts';
import type { CoreServices } from '../../services/channelSchemas.js';
import { openSpecsLive } from '../specs/index.js';
import { useSessionsUiStore } from './stores/sessionsUi.js';

/** Resumes the session and, on success, moves to Specs Live where the session is shown. */
export async function resumeSession(services: CoreServices, request: ResumeRequest): Promise<void> {
  const ui = useSessionsUiStore.getState();
  ui.setResuming(true);
  ui.setError(null);
  const result = await services.sessions.resume(request);
  useSessionsUiStore.getState().setResuming(false);
  if (!result.ok) {
    useSessionsUiStore.getState().setError(result.error);
    return;
  }
  openSpecsLive();
}
