import { useEffect } from 'react';
import type { RoutingRule } from '@orchagents/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../../services/workbenchStore.js';
import { useThemeStore, type ThemeChoice } from '../../../services/theme.js';
import { useMenuSideStore, type MenuSide } from '../../../services/menuSide.js';
import { workbenchRegistry } from '../../../services/registry.js';
import { settingsServices } from '../services.js';
import { settingsStrings as S } from '../strings.js';
import { useSettingsUiStore } from '../stores/settingsUi.js';
import {
  getAccountsFilePath,
  getLogsDirPath,
  installCli,
  refreshConfig,
  restartEngine,
  runChecks,
  setRouting,
  showItemInFolder,
} from '../actions.js';

const SEGMENT_BUTTON =
  'flex items-center gap-2 min-h-hit-min px-3 py-1.5 border-0 rounded-sm bg-transparent text-sm text-muted cursor-pointer aria-pressed:bg-seg aria-pressed:text-text';

const SECONDARY_BUTTON =
  'flex items-center gap-2 min-h-hit-min px-3 py-1.5 border border-btnline rounded-md bg-btn text-sm text-text cursor-pointer hover:bg-raised disabled:cursor-default disabled:opacity-45';

const STRATEGY_BUTTON =
  'flex items-start gap-4 min-h-[44px] px-5 py-3 border border-line rounded-lg bg-panel text-sm text-text text-left cursor-pointer aria-pressed:border-2 aria-pressed:border-accent aria-pressed:bg-sel';

const SECTIONS = [
  { id: 'general', label: S.sections.general },
  { id: 'accounts-and-routing', label: S.sections.accountsAndRouting },
  { id: 'engine', label: S.sections.engine },
  { id: 'command-line', label: S.sections.commandLine },
  { id: 'about', label: S.sections.about },
] as const;

export function SettingsScreen() {
  const services = settingsServices();

  const themeChoice = useThemeStore((s) => s.choice);
  const setTheme = useThemeStore((s) => s.setTheme);

  const menuSide = useMenuSideStore((s) => s.side);
  const setSide = useMenuSideStore((s) => s.setSide);

  const engineHealthy = useWorkbenchStore((s) => s.engineHealthy);
  const setActiveArea = useWorkbenchStore((s) => s.setActiveArea);

  const file = useSettingsUiStore((s) => s.file);
  const doctorReport = useSettingsUiStore((s) => s.doctorReport);
  const runningChecks = useSettingsUiStore((s) => s.runningChecks);
  const installingCli = useSettingsUiStore((s) => s.installingCli);
  const activeSection = useSettingsUiStore((s) => s.activeSection);
  const setActiveSection = useSettingsUiStore((s) => s.setActiveSection);

  useEffect(() => {
    if (services) {
      void refreshConfig(services);
      void runChecks(services);
    }
  }, [services]);

  const routing: RoutingRule = file?.routing ?? 'primary-first';

  const routingOptions: readonly {
    id: RoutingRule;
    label: string;
    desc: string;
    icon: 'starFill' | 'layers';
  }[] = [
    {
      id: 'primary-first',
      label: S.accountsAndRouting.routing.primaryFirst.label,
      desc: S.accountsAndRouting.routing.primaryFirst.desc,
      icon: 'starFill',
    },
    {
      id: 'most-headroom',
      label: S.accountsAndRouting.routing.mostHeadroom.label,
      desc: S.accountsAndRouting.routing.mostHeadroom.desc,
      icon: 'layers',
    },
  ];

  const maxRuns = file?.limits?.max_runs_per_account ?? 3;
  const nearLimit =
    typeof file?.limits?.near_limit_at === 'number'
      ? `${file.limits.near_limit_at}%`
      : (file?.limits?.near_limit_at ?? '85%');

  let shareSkillsDisplay = 'Enabled';
  if (typeof file?.share_skills === 'boolean') {
    shareSkillsDisplay = file.share_skills ? 'Enabled' : 'Disabled';
  } else if (file?.share_skills && typeof file.share_skills === 'object') {
    shareSkillsDisplay = 'Per-agent';
  }

  const cliCheck = doctorReport?.checks.find((c) => c.id === 'cli_on_path');
  const isCliOnPath = cliCheck ? cliCheck.status === 'pass' : false;

  const appVersion =
    (typeof window !== 'undefined' && window.orch?.app.version) ||
    doctorReport?.orchVersion ||
    '1.0.0';

  const engineVersion = doctorReport?.engineVersion || S.about.defaultEngineVersion;

  const handleNavClick = (sectionId: string) => {
    setActiveSection(sectionId);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="flex min-h-full bg-bg text-text font-sans">
      <aside
        aria-label="Settings sections"
        className="w-[220px] shrink-0 border-r border-line bg-panel p-4 flex flex-col gap-1 sticky top-0 self-start"
      >
        <nav className="flex flex-col gap-1" aria-label="Settings sections">
          {SECTIONS.map((sec) => (
            <button
              key={sec.id}
              type="button"
              onClick={() => handleNavClick(sec.id)}
              aria-current={activeSection === sec.id ? 'true' : undefined}
              className={`flex items-center min-h-hit-min px-3 py-1.5 rounded-md border-0 text-left text-sm cursor-pointer ${
                activeSection === sec.id
                  ? 'bg-active font-semibold text-text'
                  : 'bg-transparent text-muted hover:bg-raised hover:text-text'
              }`}
            >
              {sec.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex-1 min-w-0 p-8 max-w-[800px] flex flex-col gap-10">
        <header className="flex flex-col gap-1">
          <h1 className="m-0 text-xl font-semibold text-text">{S.title}</h1>
        </header>

        {/* 1. General */}
        <section id="general" className="flex flex-col gap-6 p-6 border border-line rounded-xl bg-card">
          <h2 className="m-0 text-md font-semibold text-text">{S.sections.general}</h2>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-text">{S.general.theme.title}</span>
            <div role="group" aria-label={S.general.theme.title} className="flex p-1 rounded-md border border-line bg-panel2 self-start">
              {(['system', 'light', 'dark'] as const).map((choice: ThemeChoice) => (
                <button
                  key={choice}
                  type="button"
                  className={SEGMENT_BUTTON}
                  aria-pressed={themeChoice === choice}
                  onClick={() => setTheme(choice)}
                >
                  <Icon
                    name={choice === 'light' ? 'sun' : choice === 'dark' ? 'moon' : 'monitor'}
                    size={13}
                  />
                  {choice === 'system'
                    ? S.general.theme.system
                    : choice === 'light'
                      ? S.general.theme.light
                      : S.general.theme.dark}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-text">{S.general.menuSide.title}</span>
            <div role="group" aria-label={S.general.menuSide.title} className="flex p-1 rounded-md border border-line bg-panel2 self-start">
              {(['left', 'right'] as const).map((side: MenuSide) => (
                <button
                  key={side}
                  type="button"
                  className={SEGMENT_BUTTON}
                  aria-pressed={menuSide === side}
                  onClick={() => setSide(side)}
                >
                  {side === 'left' ? S.general.menuSide.left : S.general.menuSide.right}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 2. Accounts and routing */}
        <section id="accounts-and-routing" className="flex flex-col gap-6 p-6 border border-line rounded-xl bg-card">
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-md font-semibold text-text">{S.sections.accountsAndRouting}</h2>
            <button
              type="button"
              onClick={() => setActiveArea('accounts')}
              className={SECONDARY_BUTTON}
            >
              <Icon name="users" size={13} />
              {S.accountsAndRouting.manageAccounts}
            </button>
          </div>

          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium text-text">{S.accountsAndRouting.routing.title}</span>
            <div className="grid grid-cols-2 gap-3">
              {routingOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={STRATEGY_BUTTON}
                  aria-pressed={routing === option.id}
                  disabled={!services}
                  onClick={() => services && void setRouting(services, option.id)}
                >
                  <Icon name={option.icon} size={14} />
                  <span className="flex flex-col gap-1">
                    <span className="font-medium">{option.label}</span>
                    <span className="text-xs text-muted2">{option.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-4 border-t border-line">
            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted2">{S.accountsAndRouting.limits.maxRunsPerAccount}</span>
                <span className="font-mono text-sm text-text font-medium">{maxRuns}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted2">{S.accountsAndRouting.limits.nearLimitAt}</span>
                <span className="font-mono text-sm text-text font-medium">{nearLimit}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted2">{S.accountsAndRouting.limits.shareSkills}</span>
                <span className="text-sm text-text font-medium">{shareSkillsDisplay}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-3">
              <span className="text-sm text-muted">{S.accountsAndRouting.helperText}</span>
              <button
                type="button"
                onClick={() => void showItemInFolder(getAccountsFilePath())}
                className={SECONDARY_BUTTON}
              >
                <Icon name="file" size={13} />
                {S.accountsAndRouting.showFile}
              </button>
            </div>
          </div>
        </section>

        {/* 3. Engine */}
        <section id="engine" className="flex flex-col gap-6 p-6 border border-line rounded-xl bg-card">
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-md font-semibold text-text">{S.sections.engine}</h2>
            <button
              type="button"
              onClick={() => void restartEngine()}
              className={SECONDARY_BUTTON}
            >
              <Icon name="sync" size={13} />
              {S.engine.restartEngine}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">{S.engine.status}:</span>
            <span className="inline-flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-pill ${engineHealthy ? 'bg-ok-dot' : 'bg-err-dot'}`}
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-text">
                {engineHealthy ? S.engine.healthy : S.engine.notHealthy}
              </span>
            </span>
          </div>

          <div className="flex flex-col gap-3 pt-4 border-t border-line">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text">{S.engine.checks}</span>
              <button
                type="button"
                onClick={() => services && void runChecks(services)}
                disabled={!services || runningChecks}
                className={SECONDARY_BUTTON}
              >
                <Icon name="shield" size={13} />
                {runningChecks ? S.engine.runningChecks : S.engine.runChecks}
              </button>
            </div>

            {doctorReport?.checks && doctorReport.checks.length > 0 ? (
              <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4 font-mono text-xs">
                {doctorReport.checks.map((check) => {
                  const isPass = check.status === 'pass';
                  return (
                    <div key={check.id} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className={isPass ? 'text-ok font-bold' : 'text-err font-bold'}>
                          {isPass ? '✓' : '✗'}
                        </span>
                        <span className="text-text">{check.title}</span>
                      </div>
                      {!isPass && check.fix ? (
                        <div className="pl-4 text-xs font-sans text-muted">
                          Fix: {check.fix}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </section>

        {/* 4. Command line */}
        <section id="command-line" className="flex flex-col gap-6 p-6 border border-line rounded-xl bg-card">
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-md font-semibold text-text">{S.sections.commandLine}</h2>
            <button
              type="button"
              onClick={() => services && void installCli(services)}
              disabled={!services || installingCli}
              className={SECONDARY_BUTTON}
            >
              <Icon name="plus" size={13} />
              {installingCli ? S.commandLine.installing : S.commandLine.installCommand}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">{S.commandLine.status}:</span>
            <span className="inline-flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-pill ${isCliOnPath ? 'bg-ok-dot' : 'bg-warn-solid'}`}
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-text">
                {isCliOnPath ? S.commandLine.installed : S.commandLine.notInstalled}
              </span>
            </span>
          </div>
        </section>

        {/* 5. About */}
        <section id="about" className="flex flex-col gap-6 p-6 border border-line rounded-xl bg-card">
          <h2 className="m-0 text-md font-semibold text-text">{S.sections.about}</h2>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">{S.about.orchVersion}:</span>
              <span className="font-mono text-sm text-text font-medium">{appVersion}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-text font-medium">
                {`${S.about.enginePrefix} ${engineVersion}`}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-line">
            <button
              type="button"
              onClick={() => void showItemInFolder(getLogsDirPath())}
              className={SECONDARY_BUTTON}
            >
              <Icon name="folder" size={13} />
              {S.about.showLogs}
            </button>
            <button
              type="button"
              onClick={() => workbenchRegistry.runCommand('bugreport.open')}
              className={SECONDARY_BUTTON}
            >
              <Icon name="robot" size={13} />
              {S.about.reportProblem}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
