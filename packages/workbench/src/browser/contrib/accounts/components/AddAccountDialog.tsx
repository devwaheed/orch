import { useEffect, useRef } from 'react';
import type { CoreServices } from '../../../services/channelSchemas.js';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { attachShellView } from '../../../parts/terminal/index.js';
import { useAccountsStore } from '../../../services/stores/accounts.js';
import { addAgentChoices, canStart, cliLine, existingLabels, signInChecks, signInPassed, suggestName } from '../addAccount.js';
import { cancelAdd, finishAdd, finishSignIn, startSignIn } from '../actions.js';
import { accountsStrings as S } from '../strings.js';
import { useAccountsUiStore } from '../stores/accountsUi.js';
import styles from './AccountsScreen.module.css';

const CHOICE_BADGE_CLASS = {
  claude: styles.tileClaude ?? '',
  codex: styles.tileCodex ?? '',
  agy: styles.tileAgy ?? '',
  gemini: styles.tileGemini ?? '',
  opencode: styles.tileOpencode ?? '',
} as const;

const CHOICE_MONO = {
  claude: 'CC',
  codex: 'CX',
  agy: 'AG',
  gemini: 'GM',
  opencode: 'OC',
} as const;

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

  const agentName = agents.find((a) => a.id === add.agent)?.displayName ?? '';
  const choices = os ? addAgentChoices(agents, accounts, os) : [];
  const others = existingLabels(accounts, add.agent, add.account?.id ?? null);
  const checks = add.signIn ? signInChecks(add.signIn, others) : [];
  const locked = add.account !== null;
  const passed = signInPassed(add.signIn);

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

  return (
    <div className={styles.overlay}>
      <button type="button" className={styles.scrim} aria-label={S.add.close} onClick={close} />
      <div role="dialog" aria-label={S.add.dialogAriaLabel} className={styles.dialog}>
        <div className={styles.dialogHead}>
          <h2 className={styles.dialogTitle}>
            {locked ? S.add.titleSignIn(agentName, add.name) : add.agentFixed ? S.add.titleFor(agentName) : S.add.title}
          </h2>
          <button type="button" className={styles.dialogClose} aria-label={S.add.close} onClick={close}>
            <Icon name="x" size={12} />
          </button>
        </div>

        <div className={styles.dialogBody}>
          {locked ? null : (
            <>
              {add.agentFixed ? null : (
              <>
              <p className={styles.dialogText}>{S.add.pickAgent}</p>
              <div className={styles.agentChoices}>
                {choices.map((choice) => {
                  const picked = add.agent === choice.agent;
                  return (
                    <button
                      key={choice.agent}
                      type="button"
                      className={picked ? `${styles.choice} ${styles.choicePicked}` : styles.choice}
                      disabled={choice.disabled}
                      aria-pressed={picked}
                      onClick={() => pickAgent(choice.agent)}
                    >
                      <span className={`${styles.choiceBadge} ${CHOICE_BADGE_CLASS[choice.agent]}`}>
                        {CHOICE_MONO[choice.agent]}
                      </span>
                      <span className={styles.choiceText}>
                        <span className={styles.choiceName}>
                          {agents.find((a) => a.id === choice.agent)?.displayName ?? choice.name}
                        </span>
                        <span className={choice.warn ? styles.choiceSubWarn : styles.choiceSub}>{choice.sub}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              </>
              )}
              <div className={styles.addFields}>
                <label className={styles.addField}>
                  <span className={styles.addFieldLabel}>{S.add.nameLabel}</span>
                  <input
                    type="text"
                    className={styles.addInput}
                    value={add.name}
                    maxLength={40}
                    onChange={(event) => patchAdd({ name: event.target.value })}
                  />
                </label>
                <label className={styles.addField}>
                  <span className={styles.addFieldLabel}>{S.add.typeLabel}</span>
                  <input
                    type="text"
                    className={styles.addInput}
                    value={add.type}
                    maxLength={40}
                    placeholder={S.add.typePlaceholder}
                    onChange={(event) => patchAdd({ type: event.target.value })}
                  />
                </label>
              </div>
              {add.agent ? (
                <div className={styles.folderNote}>
                  <Icon name="folder" size={13} />
                  <span>{S.add.folderNote(agentName)}</span>
                </div>
              ) : null}
            </>
          )}

          {add.phase === 'signing' || add.phase === 'checking' ? (
            <>
              <p className={styles.dialogText}>{S.add.signInNote(agentName)}</p>
              <div className={styles.signInTerminalFrame}>
                <div ref={terminalHost} className={styles.signInTerminal} />
              </div>
            </>
          ) : null}

          {add.phase === 'result' ? (
            <div className={styles.checks}>
              {checks.map((check) => (
                <div key={check.key} className={check.ok ? styles.check : `${styles.check} ${styles.checkFailed}`}>
                  <Icon name={check.ok ? 'check' : 'alert'} size={14} />
                  <span>
                    <strong className={styles.checkTitle}>{check.title}</strong>
                    {check.text ? <span className={styles.checkText}> {check.text}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {add.error ? (
            <p role="alert" className={styles.addError}>
              {add.error.message} {add.error.fix ?? ''}
            </p>
          ) : null}
        </div>

        <div className={styles.dialogFoot}>
          <code className={styles.cli}>{cliLine(add.agent, add.name)}</code>
          <button type="button" className={styles.button} onClick={close}>
            {S.add.cancel}
          </button>
          <button
            type="button"
            className={primary.disabled ? `${styles.nextButton} ${styles.faded}` : styles.nextButton}
            disabled={primary.disabled}
            onClick={primary.run}
          >
            {primary.label}
          </button>
        </div>
      </div>
    </div>
  );
}
