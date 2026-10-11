import type { CorrectionLayer, Job, JobSpec, Run } from '@orch/contracts';

export const LESSONS_HEADING = '## Lessons';

export const CORRECTION_LAYERS: readonly CorrectionLayer[] = ['codebase', 'lint', 'agent_rule', 'review_note'];

export function isJobLayer(layer: CorrectionLayer): boolean {
  return layer === 'codebase' || layer === 'lint';
}

export function buildCorrectionJobSpec(originalJob: Job, originalRun: Run | null, action: string): JobSpec | null {
  if (originalJob.spec.mode === 'single') {
    return {
      mode: 'single',
      goal: action,
      repoPath: originalJob.spec.repoPath,
      checks: originalJob.spec.checks,
      orchestrator: originalJob.spec.orchestrator,
      workers: originalJob.spec.workers,
      onLimit: originalJob.spec.onLimit ?? 'switch-account',
    };
  }

  if (!originalRun) {
    return null;
  }

  return {
    mode: 'single',
    goal: action,
    repoPath: originalJob.spec.repoPath,
    checks: originalJob.spec.checks,
    orchestrator: { agent: originalRun.agent, account: 'auto' },
    workers: [originalRun.agent],
    onLimit: 'switch-account',
  };
}

export function appendLesson(content: string, action: string): { content: string; added: boolean } {
  const line = `- ${action}`;
  const lines = content.split('\n');

  if (lines.includes(line)) {
    return { content, added: false };
  }

  const headingIdx = lines.findIndex((l) => l === LESSONS_HEADING);

  if (headingIdx === -1) {
    const trimmed = content.trimEnd();
    if (trimmed.length === 0) {
      return { content: `${LESSONS_HEADING}\n${line}\n`, added: true };
    }
    return { content: `${trimmed}\n\n${LESSONS_HEADING}\n${line}\n`, added: true };
  }

  let sectionEnd = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l !== undefined && l.startsWith('## ')) {
      sectionEnd = i;
      break;
    }
  }

  let lastContent = headingIdx;
  for (let i = sectionEnd - 1; i > headingIdx; i--) {
    const l = lines[i];
    if (l !== undefined && l.trim() !== '') {
      lastContent = i;
      break;
    }
  }

  lines.splice(lastContent + 1, 0, line);
  return { content: lines.join('\n'), added: true };
}
