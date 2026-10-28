import { useEffect, useRef } from 'react';
import type { CoreServices } from '../../../services/channelSchemas.js';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { attachShellView } from '../../../parts/terminal/index.js';
import { useAccountsStore } from '../../../services/stores/accounts.js';
import { addAgentChoices, canStart, cliLine, existingLabels, signInChecks, signInPassed, suggestName } from '../addAccount.js';
import { addWithoutSignIn, cancelAdd, finishAdd, finishSignIn, startSignIn } from '../actions.js';
import { accountsStrings as S } from '../strings.js';
import { useAccountsUiStore } from '../stores/accountsUi.js';
import { useDialogFocusTrap } from '../../../services/dialogFocus.js';

const CHOICE_BADGE_CLASS = {
  claude: 'bg-cc-bg text-cc-fg',
  codex: 'bg-cx-bg text-cx-fg',
  agy: 'bg-ag-bg text-ag-fg',
  gemini: 'bg-gm-bg text-gm-fg',
  opencode: 'bg-oc-bg text-oc-fg',
} as const;

const CHOICE_MONO = {
  claude: 'CC',
  codex: 'CX',
  agy: 'AG',
  gemini: 'GM',
  opencode: 'OC',
} as const;

const DIALOG =
  'absolute left-1/2 -translate-x-1/2 border border-btnline rounded-2xl bg-panel shadow-dialog overflow-hidden';
const DIALOG_NORMAL = 'top-[70px] w-[min(680px,calc(100%-32px))]';
const DIALOG_SIGNING =
  'top-4 bottom-4 flex flex-col w-[min(960px,calc(100%-32px))] max-h-[calc(100vh-2*var(--space-4))]';
const DIALOG_HEAD = 'flex items-center gap-5 px-18px py-7 border-b border-line2';
const DIALOG_FOOT = 'flex items-center gap-3 px-18px py-6 border-t border-line2 bg-panel2';
const DIALOG_BODY = 'flex flex-col gap-5 p-18px';
const DIALOG_TEXT = 'm-0 text-base text-muted';
const CHOICE =
  'flex items-center gap-5 min-h-[56px] p-5 rounded-lg bg-panel2 text-base text-text text-left cursor-pointer disabled:cursor-default disabled:opacity-50';
const CHOICE_LINE = 'border border-line';
const CHOICE_PICKED = 'border-2 border-accent bg-sel';
const CHECK = 'flex items-center gap-4 px-5 py-4 rounded-9px bg-ok-bg text-base text-ok';
const CHECK_FAILED = 'bg-warn-bg text-warn';
const FOOTER_BUTTON =
  'flex items-center gap-2 min-h-[38px] px-6 py-3 border border-btnline rounded-md bg-btn text-base text-text cursor-pointer';
const NEXT_BUTTON =
  'min-h-[38px] px-7 py-3 border-0 rounded-md bg-accent-solid text-base font-semibold text-on-accent cursor-pointer disabled:cursor-default disabled:bg-raised disabled:text-disabled disabled:opacity-45';

/**
 * Add account in one screen: pick the agent, name it (and optionally mark its type), Sign in.
 * The agent's own sign-in then runs in the terminal below; when it ends, the three checks show.
 * Re-login on an account row opens the same dialog for that account.
 */
export function AddAccountDialog({ services }: { readonly services: CoreServices | null }) {
  const add = useAccountsUiStore((s) => s.add);
  const os = useAccountsUiStore((s) => s.os);
  const patchAdd = useAccountsUiStore((s) => s.patchAdd);
  const agents = useAccountsStore((s) => s.agents);
  const accounts = useAccountsStore((s) => s.accounts);
  const terminalHost = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocusTrap(dialogRef, add.open);

  const close = () => {
    if (services) void cancelAdd(services);
    else useAccountsUiStore.getState().resetAdd(false);
  };

  useEffect(() => {
    if (!add.open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && add.phase !== 'signing') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The sign-in terminal: shown while it runs; when it ends, the checks run.
  useEffect(() => {
    const host = terminalHost.current;
    if (!services || !add.shellId || !host) return undefined;
    return attachShellView(add.shellId, host, () => void finishSignIn(services, false));
  }, [services, add.shellId]);

  if (!add.open) return null;

  const signing = add.phase === 'signing' || add.phase === 'checking';
  const agentName = agents.find((a) => a.id === add.agent)?.displayName ?? '';
  const choices = os ? addAgentChoices(agents, accounts, os) : [];
  const others = existingLabels(accounts, add.agent, add.account?.id ?? null);
  const checks = add.signIn && add.agent ? signInChecks(add.signIn, others, add.agent) : [];
  const locked = add.account !== null;
  const passed = signInPassed(add.signIn);
  const isMac = os ? os === 'macos' : typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent);
  const asksForPastedCode = add.agent === 'agy';

  const pickAgent = (agent: (typeof choices)[number]['agent']) =>
    patchAdd({ agent, name: add.name.trim() && add.name !== suggestName(accounts, add.agent) ? add.name : suggestName(accounts, agent) });

  const primary = (() => {
    if (add.phase === 'signing') {
      return { label: S.add.signedInButton, disabled: !services, run: () => services && void finishSignIn(services, true) };
    }
    if (add.phase === 'checking') return { label: S.add.checking, disabled: true, run: () => undefined };
    if (add.phase === 'result' && passed) {
      return { label: S.add.done, disabled: !services, run: () => services && void finishAdd(services) };
    }
    if (add.phase === 'result') {
      return { label: S.add.tryAgain, disabled: !services || add.busy, run: () => services && void startSignIn(services) };
    }
    return {
      label: S.add.signIn,
      disabled: !services || add.busy || !canStart(add.agent, add.name),
      run: () => services && void startSignIn(services),
    };
  })();
  const showOpenCodeActions = add.agent === 'opencode' && add.phase === 'form' && !add.account;

  return (
    <div className="fixed inset-0 z-[9]">
      <button type="button" className="absolute inset-0 w-full h-full border-0 bg-overlay cursor-default" aria-label={S.add.close} onClick={close} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={S.add.dialogAriaLabel}
        className={signing ? `${DIALOG} ${DIALOG_SIGNING}` : `${DIALOG} ${DIALOG_NORMAL}`}
      >
        <div className={signing ? `${DIALOG_HEAD} flex-none` : DIALOG_HEAD}>
          <h2 className="m-0 flex-auto text-16px font-semibold">
            {locked && !add.created ? S.add.titleSignIn(agentName, add.name) : add.agentFixed || add.created ? S.add.titleFor(agentName) : S.add.title}
          </h2>
          <button
            type="button"
            className="flex items-center justify-center w-[30px] h-[30px] rounded-7px border-0 bg-transparent text-muted2 cursor-pointer [&>svg]:fill-none [&>svg]:stroke-current"
            aria-label={S.add.close}
            onClick={close}
          >
            <Icon name="x" size={12} />
          </button>
        </div>

        <div className={signing ? `${DIALOG_BODY} flex-1 min-h-0 overflow-y-auto` : DIALOG_BODY}>
          {locked ? null : (
            <>
              {add.agentFixed ? null : (
              <>
              <p className={DIALOG_TEXT}>{S.add.pickAgent}</p>
              <div className="grid grid-cols-2 gap-3">
                {choices.map((choice) => {
                  const picked = add.agent === choice.agent;
                  return (
                    <button
                      key={choice.agent}
                      type="button"
                      className={picked ? `${CHOICE} ${CHOICE_PICKED}` : `${CHOICE} ${CHOICE_LINE}`}
                      disabled={choice.disabled}
                      aria-pressed={picked}
                      onClick={() => pickAgent(choice.agent)}
                    >
                      <span className={`flex flex-[0_0_32px] items-center justify-center w-[32px] h-[32px] rounded-md font-mono text-11px font-semibold ${CHOICE_BADGE_CLASS[choice.agent]}`}>
                        {CHOICE_MONO[choice.agent]}
                      </span>
                      <span className="flex flex-col min-w-0 gap-2px">
                        <span className="font-semibold">
                          {agents.find((a) => a.id === choice.agent)?.displayName ?? choice.name}
                        </span>
                        <span className={choice.warn ? 'text-xs text-warn' : 'text-xs text-muted2'}>{choice.sub}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              </>
              )}
              <div className="grid grid-cols-2 gap-4">
                <label className="flex flex-col gap-2">
                  <span className="text-sm text-muted">{S.add.nameLabel}</span>
                  <input
                    type="text"
                    className="px-5 py-9px border border-line rounded-md bg-bg text-sm text-text"
                    value={add.name}
                    maxLength={40}
                    onChange={(event) => patchAdd({ name: event.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-sm text-muted">{S.add.typeLabel}</span>
                  <input
                    type="text"
                    className="px-5 py-9px border border-line rounded-md bg-bg text-sm text-text"
                    value={add.type}
                    maxLength={40}
                    placeholder={S.add.typePlaceholder}
                    onChange={(event) => patchAdd({ type: event.target.value })}
                  />
                </label>
              </div>
              {add.agent === 'opencode' ? <p className={DIALOG_TEXT}>{S.add.openCodeFreeNote}</p> : null}
              {add.agent ? (
                <div className="flex items-start gap-4 px-13px py-11px rounded-lg bg-panel2 text-sm text-muted">
                  <Icon name="folder" size={13} />
                  <span>{S.add.folderNote(agentName)}</span>
                </div>
              ) : null}
            </>
          )}

          {signing ? (
            <>
              <p className={DIALOG_TEXT}>{S.add.signInNote(agentName)}</p>
              <div className="flex-1 min-h-0 flex flex-col p-3 border border-line rounded-lg bg-term">
                <div ref={terminalHost} className="flex-1 min-h-[380px] overflow-hidden" />
              </div>
              {asksForPastedCode ? (
                <p className="flex-none m-0 text-sm text-muted">{S.add.pasteCodeHint(isMac)}</p>
              ) : null}
            </>
          ) : null}

          {add.phase === 'result' ? (
            <div className="flex flex-col gap-3">
              {checks.map((check) => (
                <div key={check.key} className={check.ok ? CHECK : `${CHECK} ${CHECK_FAILED}`}>
                  <Icon name={check.ok ? 'check' : 'alert'} size={14} />
                  <span>
                    <strong className="font-semibold">{check.title}</strong>
                    {check.text ? <span className="text-text2"> {check.text}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {add.error ? (
            <p role="alert" className="m-0 text-sm text-err">
              {add.error.message} {add.error.fix ?? ''}
            </p>
          ) : null}
        </div>

        <div className={signing ? `${DIALOG_FOOT} flex-none` : DIALOG_FOOT}>
          <code className="flex-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted2 font-mono">{cliLine(add.agent, add.name, add.type)}</code>
          <button type="button" className={FOOTER_BUTTON} onClick={close}>
            {S.add.cancel}
          </button>
          {showOpenCodeActions ? (
            <>
              <button
                type="button"
                className={FOOTER_BUTTON}
                disabled={!services || add.busy || !canStart(add.agent, add.name)}
                onClick={() => services && void startSignIn(services)}
              >
                {S.add.signInProvider}
              </button>
              <button
                type="button"
                className={NEXT_BUTTON}
                disabled={!services || add.busy || !canStart(add.agent, add.name)}
                onClick={() => services && void addWithoutSignIn(services)}
              >
                {S.add.useFreeModels}
              </button>
            </>
          ) : <button
            type="button"
            className={NEXT_BUTTON}
            disabled={primary.disabled}
            onClick={primary.run}
          >
            {primary.label}
          </button>}
        </div>
      </div>
    </div>
  );
}
