import { useEffect, type CSSProperties } from 'react';
import type { AgentId, TrustLevel } from '@orchagents/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { trustServices } from '../services.js';
import { promoteAgent, selectPeriod, setGardenerOn, loadSummary } from '../actions.js';
import { gardenerView, layerRows, ladderRows, periodLabel, statCards, type StepVM, type Tone } from '../trustView.js';
import { trustStrings as S } from '../strings.js';
import { useTrustUiStore, type TrustPeriod } from '../stores/trustUi.js';
import { useAccountsStore } from '../../../services/stores/accounts.js';
import { cx } from './cx.js';

const PERIODS: readonly TrustPeriod[] = [7, 30];

const TONE_CLASS: Record<Tone, string> = {
  ok: 'text-ok',
  info: 'text-info',
  warn: 'text-warn',
  err: 'text-err',
};

const BAR_TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-ok-dot',
  info: 'bg-info-dot',
  warn: 'bg-warn-solid',
  err: 'bg-err-dot',
};

const TILE_CLASS: Record<AgentId, string> = {
  claude: 'bg-cc-bg text-cc-fg',
  codex: 'bg-cx-bg text-cx-fg',
  gemini: 'bg-gm-bg text-gm-fg',
  opencode: 'bg-oc-bg text-oc-fg',
  agy: 'bg-ag-bg text-ag-fg',
};

const LAYER_CLASS: Record<'ok' | 'info' | 'warn', string> = {
  ok: 'bg-ok-dot',
  info: 'bg-info-dot',
  warn: 'bg-warn-solid',
};

function StepCell({ step, onPromote, busy }: { step: StepVM; onPromote: (level: TrustLevel) => void; busy: boolean }) {
  switch (step.kind) {
    case 'current':
      return (
        <span className="inline-flex items-center gap-5px self-start px-4 py-1 rounded-pill bg-accent-solid text-on-accent text-xs font-semibold">
          <Icon name="check" size={11} weight={2.6} />
          {S.ladder.current}
        </span>
      );
    case 'done':
      return (
        <span className="inline-flex items-center gap-5px text-ok text-xs">
          <span className="w-3 h-3 rounded-pill bg-ok-dot" aria-hidden="true" />
          {S.ladder.passed}
        </span>
      );
    case 'promote':
      return (
        <button
          type="button"
          className="inline-flex items-center gap-5px self-start min-h-10 px-4 py-1 border border-accent rounded-pill bg-transparent text-text text-xs cursor-pointer disabled:opacity-60 disabled:cursor-default"
          disabled={busy}
          onClick={() => onPromote(step.level)}
        >
          <Icon name="arrowUp" size={11} weight={2.4} />
          {S.ladder.promote}
        </button>
      );
    case 'locked':
      return (
        <span className="inline-flex items-center gap-1 text-faint text-11px">
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
  const accounts = useAccountsStore((s) => s.accounts);
  const agents = useAccountsStore((s) => s.agents);

  useEffect(() => {
    if (services) void loadSummary(services.trust);
  }, [services]);

  if (!summary) {
    return (
      <div className="flex flex-col gap-18px px-9 pt-22px pb-10 text-text font-sans text-base">
        <header className="flex flex-col gap-3px">
          <h1 className="m-0 text-xl font-semibold">{S.title}</h1>
          <p className="m-0 text-muted">{S.intro}</p>
        </header>
        {loadError ? (
          <div role="alert" className="flex flex-col gap-1 px-5 py-4 rounded-lg bg-err-bg text-err text-sm">
            <span>{loadError.message}</span>
            {loadError.fix ? <span className="text-text2">{loadError.fix}</span> : null}
          </div>
        ) : null}
      </div>
    );
  }

  const stats = statCards(summary);
  const rows = ladderRows(summary);
  const layers = layerRows(summary);
  const gardener = gardenerView(summary, accounts, agents);
  const busy = promotingAgent !== null;

  return (
    <div className="flex flex-col gap-18px px-9 pt-22px pb-10 text-text font-sans text-base">
      <div className="flex flex-wrap items-end gap-5">
        <div className="flex-[1_1_420px] flex flex-col gap-3px">
          <h1 className="m-0 text-xl font-semibold">{S.title}</h1>
          <p className="m-0 text-muted">{S.intro}</p>
        </div>
        <div role="group" aria-label={S.period.group} className="flex p-3px rounded-9px bg-panel2 border border-line">
          {PERIODS.map((days) => (
            <button
              key={days}
              type="button"
              className={cx(
                'min-h-[30px] px-5 py-2 border-none rounded-sm text-sm cursor-pointer',
                period === days ? 'bg-seg text-text' : 'bg-transparent text-muted'
              )}
              aria-pressed={period === days ? 'true' : 'false'}
              onClick={() => services && void selectPeriod(services.trust, days)}
            >
              {periodLabel(days)}
            </button>
          ))}
        </div>
      </div>

      {loadError ? (
        <div role="alert" className="flex flex-col gap-1 px-5 py-4 rounded-lg bg-err-bg text-err text-sm">
          <span>{loadError.message}</span>
          {loadError.fix ? <span className="text-text2">{loadError.fix}</span> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col gap-1 p-6 border border-line rounded-xl bg-panel">
            <span className="text-muted2 text-sm">{stat.label}</span>
            <span className={cx('text-2xl font-semibold', TONE_CLASS[stat.tone])}>{stat.value}</span>
            <span className="text-muted2 text-xs">{stat.note}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-7">
        <section aria-labelledby="ladder-h" className="flex-[3_1_560px] min-w-0 border border-line rounded-xl bg-panel overflow-hidden">
          <div className="flex flex-col gap-3px px-7 py-6 border-b border-line2">
            <h2 id="ladder-h" className="m-0 text-md font-semibold">{S.ladder.title}</h2>
            <p className="m-0 text-muted2 text-sm">{S.ladder.intro}</p>
          </div>
          <div className="overflow-x-auto text-sm">
            <div className="flex flex-col min-w-[700px]">
              <div className="flex items-center">
                <div className="shrink-0 w-[170px] flex items-center gap-3 px-7 py-4 text-faint text-11px">{S.ladder.agent}</div>
                <div className="flex-[1_1_0] min-w-[120px] flex flex-col gap-1px px-3 py-4">
                  <span className="text-text2 font-semibold text-sm">{S.ladder.levels[1].label}</span>
                  <span className="text-faint text-2xs">{S.ladder.levels[1].desc}</span>
                </div>
                <div className="flex-[1_1_0] min-w-[120px] flex flex-col gap-1px px-3 py-4">
                  <span className="text-text2 font-semibold text-sm">{S.ladder.levels[2].label}</span>
                  <span className="text-faint text-2xs">{S.ladder.levels[2].desc}</span>
                </div>
                <div className="flex-[1_1_0] min-w-[120px] flex flex-col gap-1px px-3 py-4">
                  <span className="text-text2 font-semibold text-sm">{S.ladder.levels[3].label}</span>
                  <span className="text-faint text-2xs">{S.ladder.levels[3].desc}</span>
                </div>
                <div className="shrink-0 w-[110px] flex flex-col gap-1 p-3 text-faint text-2xs">{S.ladder.firstTry}</div>
              </div>
              {rows.map((row) => (
                <div key={row.agent} className="flex items-center border-t border-line2">
                  <div className="shrink-0 w-[170px] flex items-center gap-3 px-7 py-4 text-faint text-11px">
                    <span className={cx('shrink-0 w-22px h-22px rounded-sm flex items-center justify-center font-mono text-8p5 font-semibold', TILE_CLASS[row.agent])}>{row.mono}</span>
                    <span className="font-medium text-text">{row.name}</span>
                  </div>
                  {row.steps.map((step, index) => (
                    <div key={index} className="flex-[1_1_0] min-w-[120px] flex flex-row items-center p-3">
                      <StepCell
                        step={step}
                        busy={busy}
                        onPromote={(level) => services && void promoteAgent(services.trust, row.agent, level)}
                      />
                    </div>
                  ))}
                  <div className="shrink-0 w-[110px] flex flex-col gap-1 p-3 text-faint text-2xs">
                    <span className={cx('font-mono text-sm', TONE_CLASS[row.rateTone])}>{row.rate}</span>
                    <span className="block h-1 rounded-2px bg-line overflow-hidden" aria-hidden="true">
                      <span className={cx('block h-full w-[var(--bar,0%)]', BAR_TONE_CLASS[row.rateTone])} style={{ '--bar': `${row.ratePct}%` } as CSSProperties} />
                    </span>
                    {row.notice ? <span className="text-warn-text text-2xs">{row.notice}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {promoteError ? (
            <div role="alert" className="flex flex-col gap-1 px-5 py-4 rounded-lg bg-err-bg text-err text-sm">
              <span>{promoteError.message}</span>
              {promoteError.fix ? <span className="text-text2">{promoteError.fix}</span> : null}
            </div>
          ) : null}
        </section>

        <div className="flex-[2_1_340px] min-w-0 flex flex-col gap-7">
          <section aria-labelledby="layers-h" className="flex flex-col gap-4 px-7 py-6 border border-line rounded-xl bg-panel">
            <div className="flex flex-col gap-3px p-0 border-b-0">
              <h2 id="layers-h" className="m-0 text-md font-semibold">{S.layers.title}</h2>
              <p className="m-0 text-muted2 text-sm">{S.layers.intro}</p>
            </div>
            {layers.map((layer) => (
              <div key={layer.layer} className="flex flex-col gap-1">
                <div className="flex justify-between text-12p5">
                  <span>{layer.label}</span>
                  <span className="font-mono text-muted">{layer.count}</span>
                </div>
                <div className="block h-1 rounded-2px bg-line overflow-hidden">
                  <div className={cx('block h-full w-[var(--bar,0%)]', LAYER_CLASS[layer.tone])} style={{ '--bar': `${layer.width}%` } as CSSProperties} />
                </div>
              </div>
            ))}
          </section>

          <section aria-labelledby="gard-h" className="flex flex-col gap-4 px-7 py-6 border border-line rounded-xl bg-panel">
            <div className="flex items-center gap-4">
              <span className="shrink-0 w-hit-min h-hit-min rounded-md bg-ok-bg text-ok flex items-center justify-center">
                <Icon name="leaf" size={16} weight={1.9} />
              </span>
              <div className="flex-[1_1_auto] flex flex-col gap-1px">
                <h2 id="gard-h" className="m-0 text-md font-semibold">{S.gardener.title}</h2>
                <span className="text-muted2 text-sm">{gardener.when}</span>
              </div>
              <label className="flex items-center gap-7px min-h-hit-min text-text3 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="w-7 h-7 accent-accent"
                  checked={gardener.on}
                  disabled={busy}
                  onChange={(event) => services && void setGardenerOn(services.trust, event.target.checked)}
                />
                {S.gardener.on}
              </label>
            </div>
            <p className="m-0 text-muted2 text-sm">{S.gardener.intro}</p>
            <div className="flex flex-col gap-2">
              {gardener.findings.map((finding, index) => (
                <div key={index} className="flex items-start gap-3 px-4 py-3 rounded-md bg-panel2 text-sm">
                  <Icon name="alert" size={13} weight={2} className="shrink-0 w-13px mt-2px text-warn-solid" />
                  <span className="flex-[1_1_auto]">{finding.text}</span>
                  <span className="text-faint whitespace-nowrap">{finding.when}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
