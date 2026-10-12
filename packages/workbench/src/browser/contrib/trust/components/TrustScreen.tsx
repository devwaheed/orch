import { useEffect, type CSSProperties } from 'react';
import type { AgentId, TrustLevel } from '@orchagents/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { trustServices } from '../services.js';
import { promoteAgent, selectPeriod, setGardenerOn, loadSummary } from '../actions.js';
import { gardenerView, layerRows, ladderRows, periodLabel, statCards, type StepVM, type Tone } from '../trustView.js';
import { trustStrings as S } from '../strings.js';
import { useTrustUiStore, type TrustPeriod } from '../stores/trustUi.js';
import styles from './TrustScreen.module.css';

const PERIODS: readonly TrustPeriod[] = [7, 30];

const TONE_CLASS: Record<Tone, string> = {
  ok: styles.toneOk ?? '',
  info: styles.toneInfo ?? '',
  warn: styles.toneWarn ?? '',
  err: styles.toneErr ?? '',
};

const TILE_CLASS: Record<AgentId, string> = {
  claude: styles.tileClaude ?? '',
  codex: styles.tileCodex ?? '',
  gemini: styles.tileGemini ?? '',
  opencode: styles.tileOpencode ?? '',
  agy: styles.tileAgy ?? '',
};

const LAYER_CLASS: Record<'ok' | 'info' | 'warn', string> = {
  ok: styles.barOk ?? '',
  info: styles.barInfo ?? '',
  warn: styles.barWarn ?? '',
};

function StepCell({ step, onPromote, busy }: { step: StepVM; onPromote: (level: TrustLevel) => void; busy: boolean }) {
  switch (step.kind) {
    case 'current':
      return (
        <span className={styles.current}>
          <Icon name="check" size={11} weight={2.6} />
          {S.ladder.current}
        </span>
      );
    case 'done':
      return (
        <span className={styles.passed}>
          <span className={styles.passedDot} aria-hidden="true" />
          {S.ladder.passed}
        </span>
      );
    case 'promote':
      return (
        <button type="button" className={styles.promote} disabled={busy} onClick={() => onPromote(step.level)}>
          <Icon name="arrowUp" size={11} weight={2.4} />
          {S.ladder.promote}
        </button>
      );
    case 'locked':
      return (
        <span className={styles.locked}>
          <Icon name="lock" size={11} weight={2} />
          {step.need}
        </span>
      );
  }
}

export function TrustScreen() {
  const services = trustServices();
  const period = useTrustUiStore((s) => s.period);
  const summary = useTrustUiStore((s) => s.summary);
  const loadError = useTrustUiStore((s) => s.loadError);
  const promoteError = useTrustUiStore((s) => s.promoteError);
  const promotingAgent = useTrustUiStore((s) => s.promotingAgent);

  useEffect(() => {
    if (services) void loadSummary(services.trust);
  }, [services]);

  if (!summary) {
    return (
      <div className={styles.screen}>
        <header className={styles.header}>
          <h1 className={styles.title}>{S.title}</h1>
          <p className={styles.intro}>{S.intro}</p>
        </header>
        {loadError ? (
          <div role="alert" className={styles.error}>
            <span>{loadError.message}</span>
            {loadError.fix ? <span className={styles.errorFix}>{loadError.fix}</span> : null}
          </div>
        ) : null}
      </div>
    );
  }

  const stats = statCards(summary);
  const rows = ladderRows(summary);
  const layers = layerRows(summary);
  const gardener = gardenerView(summary);
  const busy = promotingAgent !== null;

  return (
    <div className={styles.screen}>
      <div className={styles.topRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>{S.title}</h1>
          <p className={styles.intro}>{S.intro}</p>
        </div>
        <div role="group" aria-label={S.period.group} className={styles.segment}>
          {PERIODS.map((days) => (
            <button
              key={days}
              type="button"
              className={styles.segmentButton}
              aria-pressed={period === days ? 'true' : 'false'}
              onClick={() => services && void selectPeriod(services.trust, days)}
            >
              {periodLabel(days)}
            </button>
          ))}
        </div>
      </div>

      {loadError ? (
        <div role="alert" className={styles.error}>
          <span>{loadError.message}</span>
          {loadError.fix ? <span className={styles.errorFix}>{loadError.fix}</span> : null}
        </div>
      ) : null}

      <div className={styles.stats}>
        {stats.map((stat) => (
          <div key={stat.label} className={styles.stat}>
            <span className={styles.statLabel}>{stat.label}</span>
            <span className={`${styles.statValue} ${TONE_CLASS[stat.tone]}`}>{stat.value}</span>
            <span className={styles.statNote}>{stat.note}</span>
          </div>
        ))}
      </div>

      <div className={styles.columns}>
        <section aria-labelledby="ladder-h" className={styles.ladderPanel}>
          <div className={styles.panelHead}>
            <h2 id="ladder-h" className={styles.panelTitle}>{S.ladder.title}</h2>
            <p className={styles.panelIntro}>{S.ladder.intro}</p>
          </div>
          <div className={styles.tableScroll}>
            <div className={styles.table}>
              <div className={styles.tableHead}>
                <div className={styles.colAgent}>{S.ladder.agent}</div>
                <div className={styles.colStep}>
                  <span className={styles.levelLabel}>{S.ladder.levels[1].label}</span>
                  <span className={styles.levelDesc}>{S.ladder.levels[1].desc}</span>
                </div>
                <div className={styles.colStep}>
                  <span className={styles.levelLabel}>{S.ladder.levels[2].label}</span>
                  <span className={styles.levelDesc}>{S.ladder.levels[2].desc}</span>
                </div>
                <div className={styles.colStep}>
                  <span className={styles.levelLabel}>{S.ladder.levels[3].label}</span>
                  <span className={styles.levelDesc}>{S.ladder.levels[3].desc}</span>
                </div>
                <div className={styles.colRate}>{S.ladder.firstTry}</div>
              </div>
              {rows.map((row) => (
                <div key={row.agent} className={styles.row}>
                  <div className={styles.colAgent}>
                    <span className={`${styles.tile} ${TILE_CLASS[row.agent]}`}>{row.mono}</span>
                    <span className={styles.agentName}>{row.name}</span>
                  </div>
                  {row.steps.map((step, index) => (
                    <div key={index} className={styles.colStep}>
                      <StepCell
                        step={step}
                        busy={busy}
                        onPromote={(level) => services && void promoteAgent(services.trust, row.agent, level)}
                      />
                    </div>
                  ))}
                  <div className={styles.colRate}>
                    <span className={`${styles.rate} ${TONE_CLASS[row.rateTone]}`}>{row.rate}</span>
                    <span className={styles.bar} aria-hidden="true">
                      <span className={`${styles.barFill} ${TONE_CLASS[row.rateTone]}`} style={{ '--bar': `${row.ratePct}%` } as CSSProperties} />
                    </span>
                    {row.notice ? <span className={styles.notice}>{row.notice}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {promoteError ? (
            <div role="alert" className={styles.error}>
              <span>{promoteError.message}</span>
              {promoteError.fix ? <span className={styles.errorFix}>{promoteError.fix}</span> : null}
            </div>
          ) : null}
        </section>

        <div className={styles.side}>
          <section aria-labelledby="layers-h" className={styles.card}>
            <div className={styles.panelHead}>
              <h2 id="layers-h" className={styles.panelTitle}>{S.layers.title}</h2>
              <p className={styles.panelIntro}>{S.layers.intro}</p>
            </div>
            {layers.map((layer) => (
              <div key={layer.layer} className={styles.layer}>
                <div className={styles.layerHead}>
                  <span>{layer.label}</span>
                  <span className={styles.layerCount}>{layer.count}</span>
                </div>
                <div className={styles.barTrack}>
                  <div className={`${styles.barFill} ${LAYER_CLASS[layer.tone]}`} style={{ '--bar': `${layer.width}%` } as CSSProperties} />
                </div>
              </div>
            ))}
          </section>

          <section aria-labelledby="gard-h" className={styles.card}>
            <div className={styles.gardenerHead}>
              <span className={styles.gardenerIcon}>
                <Icon name="leaf" size={16} weight={1.9} />
              </span>
              <div className={styles.gardenerTitles}>
                <h2 id="gard-h" className={styles.panelTitle}>{S.gardener.title}</h2>
                <span className={styles.gardenerWhen}>{gardener.when}</span>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={gardener.on}
                  disabled={busy}
                  onChange={(event) => services && void setGardenerOn(services.trust, event.target.checked)}
                />
                {S.gardener.on}
              </label>
            </div>
            <p className={styles.panelIntro}>{S.gardener.intro}</p>
            <div className={styles.findings}>
              {gardener.findings.map((finding, index) => (
                <div key={index} className={styles.finding}>
                  <Icon name="alert" size={13} weight={2} className={styles.findingIcon ?? ''} />
                  <span className={styles.findingText}>{finding.text}</span>
                  <span className={styles.findingWhen}>{finding.when}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
