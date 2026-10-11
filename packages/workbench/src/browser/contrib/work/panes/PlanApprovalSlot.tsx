/**
 * Plan gate for an autoloop job at the Plan step (JOB-09). The Planner's plan is in
 * its run output; approving tells it to start the Coder, rejecting asks for a new plan.
 */
import { useState } from 'react';
import type { JobId } from '@orch/contracts';
import { useJobsStore } from '../../../services/stores/work.js';
import { getWorkServices } from '../workServices.js';
import { workStrings } from '../strings.js';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import styles from './panes.module.css';

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
    <div className={styles.planApprovalCard} role="region" aria-label={workStrings.planApproval.title}>
      <div className={styles.planApprovalInfo}>
        <div className={styles.planApprovalTitle}>{workStrings.planApproval.title}</div>
        <div className={styles.planApprovalDesc}>{workStrings.planApproval.description}</div>
        {error ? (
          <div className={styles.error}>
            <span>{error}</span>
          </div>
        ) : null}
      </div>
      <div className={styles.planApprovalActions}>
        <button
          type="button"
          className={`${styles.planApprovalButton} ${styles.planApprovalApprove}`}
          disabled={submitting !== null}
          onClick={() => void handleApprove()}
        >
          <Icon name="check" size={13} weight={2.2} />
          {submitting === 'approve' ? workStrings.planApproval.approving : workStrings.planApproval.approve}
        </button>
        <button
          type="button"
          className={`${styles.planApprovalButton} ${styles.planApprovalReject}`}
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
