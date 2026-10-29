/**
 * Fix in terminal & manual check slot for a spec that needs the user (state needs_you or failed try).
 * Shows failing criteria above the interactive terminal, with "Fix in terminal" and "Check again" buttons.
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import type { Run, ShellId } from '@orchagents/contracts';
import { useSpecsStore } from '../../../services/stores/specs.js';
import { getWorkServices } from '../workServices.js';
import { attachShellView } from '../../../parts/terminal/index.js';
import { workStrings } from '../strings.js';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { cx } from '../components/cx.js';

export function SpecFixSlot({ run }: { readonly run: Run }) {
  const queues = useSpecsStore((s) => s.queues);
  const [shellId, setShellId] = useState<ShellId | null>(null);
  const [openingTerminal, setOpeningTerminal] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<{ message: string; fix?: string | undefined } | null>(null);
  const terminalHostRef = useRef<HTMLDivElement>(null);

  const { queue, spec } = useMemo(() => {
    for (const q of queues) {
      const match = q.specs.find((s) => s.jobId === run.jobId);
      if (match) return { queue: q, spec: match };
    }
    return { queue: undefined, spec: undefined };
  }, [queues, run.jobId]);

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!shellId || !host) return undefined;
    return attachShellView(shellId, host, (code) => {
      setShellId(null);
      if (code !== null && code !== 0) {
        setError({
          message: `The terminal session ended unexpectedly (exit code ${code}).`,
          fix: 'Check the agent configuration or try opening the terminal again.',
        });
      }
    });
  }, [shellId]);

  if (!queue || !spec) return null;

  const isFailing =
    spec.state === 'needs_you' ||
    (spec.state !== 'verified' &&
      spec.state !== 'approved' &&
      spec.state !== 'merged' &&
      spec.criteria.some((c) => c.state === 'not_met'));

  if (!isFailing) return null;

  const failingCriteria = spec.criteria.filter((c) => c.state === 'not_met');
  const criteriaToShow = failingCriteria.length > 0 ? failingCriteria : spec.criteria;

  const handleFixInTerminal = async () => {
    const services = getWorkServices();
    if (!services) return;
    setOpeningTerminal(true);
    setError(null);
    try {
      const res = await services.specs.openTerminal(queue.id, spec.id, 100, 24);
      if (res.ok) {
        setShellId(res.value);
      } else {
        setError({ message: res.error.message, fix: res.error.fix });
      }
    } catch (e) {
      setError({
        message: e instanceof Error ? e.message : 'Failed to open terminal.',
        fix: 'Try again or check terminal configuration.',
      });
    } finally {
      setOpeningTerminal(false);
    }
  };

  const handleCheckAgain = async () => {
    const services = getWorkServices();
    if (!services) return;
    setChecking(true);
    setError(null);
    try {
      const res = await services.specs.recheck(queue.id, spec.id);
      if (!res.ok) {
        setError({ message: res.error.message, fix: res.error.fix });
      }
    } catch (e) {
      setError({
        message: e instanceof Error ? e.message : 'Failed to recheck criteria.',
        fix: 'Try again.',
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <section
      className="flex flex-col gap-3 mx-6 mt-5 p-5 rounded-lg border border-line bg-chrome"
      aria-label={workStrings.specFix.notMetYet}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h3 className="m-0 text-sm font-semibold text-text">{workStrings.specFix.notMetYet}</h3>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            className={cx(
              'flex items-center gap-2 min-h-hit-min px-4 py-2 rounded-sm border text-sm font-medium cursor-pointer',
              'bg-btn text-text border-btnline',
            )}
            onClick={() => void handleFixInTerminal()}
            disabled={openingTerminal}
          >
            <Icon name="terminal" size={14} weight={2} />
            {workStrings.specFix.fixInTerminal}
          </button>
          <button
            type="button"
            className={cx(
              'flex items-center gap-2 min-h-hit-min px-4 py-2 rounded-sm border text-sm font-medium cursor-pointer',
              'bg-accent-solid text-on-accent border-accent-solid',
            )}
            onClick={() => void handleCheckAgain()}
            disabled={checking}
          >
            <Icon name="sync" size={14} weight={2.2} className={checking ? 'animate-spin' : ''} />
            {checking ? workStrings.specFix.checking : workStrings.specFix.checkAgain}
          </button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="flex flex-col gap-1 m-0 p-3 rounded-md border border-err-line bg-err-bg text-err-strong text-xs">
          <span className="font-semibold">{error.message}</span>
          {error.fix ? <span className="text-err">{error.fix}</span> : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {criteriaToShow.map((c) => {
          const text = spec.spec.done_when[c.index]?.text ?? `Criterion ${c.index + 1}`;
          return (
            <div
              key={c.index}
              className="flex flex-col gap-1 p-3 rounded-md border border-err-line bg-err-bg text-xs"
            >
              <div className="flex items-center gap-2 text-err font-medium">
                <Icon name="close" size={12} weight={2.5} />
                <span>{text}</span>
              </div>
              {c.summary ? (
                <div className="text-err-strong pl-5 font-mono text-11px">{c.summary}</div>
              ) : null}
            </div>
          );
        })}
      </div>

      {shellId ? (
        <div className="mt-1 flex flex-col p-3 rounded-lg border border-line bg-term">
          <div
            ref={terminalHostRef}
            className="w-full h-[320px] min-h-[320px] overflow-hidden"
          />
        </div>
      ) : null}
    </section>
  );
}
