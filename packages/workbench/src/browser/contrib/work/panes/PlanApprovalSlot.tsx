/**
 * Plan gate for an autoloop job at the Plan step (JOB-09). The Planner's plan is in
 * its run output; approving tells it to start the Coder, rejecting asks for a new plan.
 */
import { useState } from 'react';
import type { JobId } from '@orchagents/contracts';
import { useJobsStore } from '../../../services/stores/work.js';
import { getWorkServices } from '../workServices.js';
import { workStrings } from '../strings.js';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { cx } from '../components/cx.js';

const ERROR_BOX =
  'flex flex-col gap-1 mx-6 mt-5 p-4 rounded-lg border border-err-line bg-err-bg text-err-strong text-xs';
const APPROVAL_BUTTON =
  'flex items-center gap-2 min-h-hit-min px-4 py-2 rounded-sm border text-sm font-medium cursor-pointer';

export function PlanApprovalSlot({ jobId }: { readonly jobId: JobId }) {
  const job = useJobsStore((s) => s.jobs.find((j) => j.id === jobId));
  const [submitting, setSubmitting] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!job || job.spec.mode !== 'autoloop' || job.status !== 'running' || job.step?.name !== 'Plan') {
    return null;
  }

  const handleApprove = async () => {
    const services = getWorkServices();
    if (!services) return;
    setSubmitting('approve');
    setError(null);
    try {
      const result = await services.jobs.approvePlan(job.id);
      if (!result.ok) {
        setError(result.error.message);
      }
    } finally {
      setSubmitting(null);
    }
  };

  const handleReject = async () => {
    const services = getWorkServices();
    if (!services) return;
    setSubmitting('reject');
    setError(null);
    try {
      const result = await services.jobs.rejectPlan(job.id);
      if (!result.ok) {
        setError(result.error.message);
      }
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div
      className="flex items-center justify-between gap-4 mx-6 mt-5 px-5 py-4 rounded-lg border border-line bg-chrome"
      role="region"
      aria-label={workStrings.planApproval.title}
    >
      <div className="flex flex-col gap-1">
        <div className="font-semibold text-sm text-text">{workStrings.planApproval.title}</div>
        <div className="text-xs text-muted2">{workStrings.planApproval.description}</div>
        {error ? (
          <div className={ERROR_BOX}>
            <span>{error}</span>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          className={cx(APPROVAL_BUTTON, 'bg-accent-solid text-on-accent border-accent-solid')}
          disabled={submitting !== null}
          onClick={() => void handleApprove()}
        >
          <Icon name="check" size={13} weight={2.2} />
          {submitting === 'approve' ? workStrings.planApproval.approving : workStrings.planApproval.approve}
        </button>
        <button
          type="button"
          className={cx(APPROVAL_BUTTON, 'bg-btn text-err border-btnline')}
          disabled={submitting !== null}
          onClick={() => void handleReject()}
        >
          <Icon name="close" size={13} weight={2.2} />
          {submitting === 'reject' ? workStrings.planApproval.rejecting : workStrings.planApproval.reject}
        </button>
      </div>
    </div>
  );
}
