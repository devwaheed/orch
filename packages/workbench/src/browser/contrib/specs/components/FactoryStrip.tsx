/**
 * The SaaS Factory strip: the active project's planning stages, its next action and one
 * click into New job prefilled with that next step. Renders nothing for a project that
 * isn't a factory product or when the factory isn't installed.
 */
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../../services/workbenchStore.js';
import { prefillNewJob } from '../../newjob/index.js';
import { factoryStageLabel, factoryStoryCounts } from '../factoryView.js';
import { useSpecsUiStore } from '../stores/specsUi.js';
import { specStrings as S } from '../strings.js';

export function FactoryStrip() {
  const status = useSpecsUiStore((s) => s.factoryStatus);
  const error = useSpecsUiStore((s) => s.factoryError);

  if (error) {
    return (
      <div
        className="flex flex-none flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-line bg-panel2 px-5 py-3"
        role="alert"
      >
        <span className="text-xs text-err">{error}</span>
      </div>
    );
  }
  if (!status) return null;

  const counts = factoryStoryCounts(status.delivery);

  const runNext = () => {
    if (!status.next) return;
    prefillNewJob(S.factory.goal(status.next));
    useWorkbenchStore.getState().setActiveRoute('/jobs/new');
  };

  return (
    <section
      className="flex flex-none flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-line bg-panel2 px-5 py-3"
      aria-label={S.factory.title}
    >
      <div className="flex min-w-0 flex-[1_1_420px] flex-wrap items-center gap-x-3 gap-y-2">
        <span className="whitespace-nowrap text-sm font-semibold text-text">{S.factory.title}</span>
        <span className="whitespace-nowrap font-mono text-xs text-text2">{status.product}</span>
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {status.stages.map((stage) => (
            <span
              key={stage.stage}
              className="inline-flex items-center gap-1px whitespace-nowrap rounded-pill border border-line bg-panel px-2 py-1px text-2xs text-muted"
              title={S.factory.stageTitle(stage.stage, stage.by)}
            >
              {stage.done && <Icon name="check" size={10} weight={2.5} />}
              {factoryStageLabel(stage.stage)}
            </span>
          ))}
          {status.delivery && (
            <span className="whitespace-nowrap text-2xs text-muted2">{S.factory.stories(counts.done, counts.total)}</span>
          )}
        </div>
      </div>

      {status.next && (
        <span className="min-w-0 flex-[1_1_220px] truncate text-xs text-text2" title={status.next}>
          {S.factory.next(status.next)}
        </span>
      )}

      <button
        type="button"
        className="inline-flex min-h-[44px] flex-none cursor-pointer items-center gap-2 rounded-md border-0 bg-accent px-4 py-2 text-sm font-semibold text-on-accent focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-raised disabled:text-disabled"
        onClick={runNext}
        disabled={!status.next}
      >
        <Icon name="play" size={12} weight={2} />
        {S.factory.runNext}
      </button>
    </section>
  );
}
