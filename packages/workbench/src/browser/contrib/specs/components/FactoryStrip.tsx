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
import styles from './FactoryStrip.module.css';

export function FactoryStrip() {
  const status = useSpecsUiStore((s) => s.factoryStatus);
  const error = useSpecsUiStore((s) => s.factoryError);

  if (error) {
    return (
      <div className={styles.strip} role="alert">
        <span className={styles.error}>{error}</span>
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
    <section className={styles.strip} aria-label={S.factory.title}>
      <div className={styles.left}>
        <span className={styles.title}>{S.factory.title}</span>
        <span className={styles.product}>{status.product}</span>
        <div className={styles.chips}>
          {status.stages.map((stage) => (
            <span
              key={stage.stage}
              className={styles.chip}
              title={S.factory.stageTitle(stage.stage, stage.by)}
            >
              {stage.done && <Icon name="check" size={10} weight={2.5} />}
              {factoryStageLabel(stage.stage)}
            </span>
          ))}
          {status.delivery && (
            <span className={styles.count}>{S.factory.stories(counts.done, counts.total)}</span>
          )}
        </div>
      </div>

      {status.next && (
        <span className={styles.next} title={status.next}>
          {S.factory.next(status.next)}
        </span>
      )}

      <button type="button" className={styles.run} onClick={runNext} disabled={!status.next}>
        <Icon name="play" size={12} weight={2} />
        {S.factory.runNext}
      </button>
    </section>
  );
}
