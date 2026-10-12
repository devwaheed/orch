import { useEffect } from 'react';
import type { CoreServices } from '../../../services/channelSchemas.js';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { useAccountsStore } from '../../../services/stores/accounts.js';
import { addAgentChoices, canAdvance, cliLine, existingLabels, signInChecks, stepLabel, type AddStep } from '../addAccount.js';
import { addProfile, finishAdd, signIn } from '../actions.js';
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

export function AddAccountDialog({ services }: { readonly services: CoreServices | null }) {
  const add = useAccountsUiStore((s) => s.add);
  const os = useAccountsUiStore((s) => s.os);
  const patchAdd = useAccountsUiStore((s) => s.patchAdd);
  const resetAdd = useAccountsUiStore((s) => s.resetAdd);
  const agents = useAccountsStore((s) => s.agents);
  const accounts = useAccountsStore((s) => s.accounts);

  const close = () => resetAdd(false);

  useEffect(() => {
    if (!add.open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') resetAdd(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [add.open, resetAdd]);

  if (!add.open) return null;

  const agentInfo = agents.find((a) => a.id === add.agent);
  const agentName = agentInfo?.displayName ?? '';
  const choices = os ? addAgentChoices(agents, accounts, os) : [];
  const others = existingLabels(accounts, add.agent, add.account?.id ?? null);
  const checks = add.signIn ? signInChecks(add.signIn, others) : [];
  const step = add.step;
  const nextDisabled = !services || add.busy || !canAdvance(step, add.agent, add.signIn);

  const onNext = () => {
    if (!services) return;
    if (step === 1) patchAdd({ step: 2 });
    else if (step === 2) void addProfile(services);
    else void finishAdd(services);
  };
  const onBack = () => {
    if (step === 2) patchAdd({ step: 1 });
    else if (step === 3) patchAdd({ step: 2, signIn: null, error: null });
  };
  const onOpenSignIn = () => {
    if (services && add.account) void signIn(services, add.account.id);
  };

  const stepStates: readonly { n: AddStep; label: string }[] = [
    { n: 1, label: S.add.steps[0] },
    { n: 2, label: S.add.steps[1] },
    { n: 3, label: S.add.steps[2] },
  ];

  return (
    <div className={styles.overlay}>
      <button type="button" className={styles.scrim} aria-label={S.add.close} onClick={close} />
      <div role="dialog" aria-label={S.add.dialogAriaLabel} className={styles.dialog}>
        <div className={styles.dialogHead}>
          <h2 className={styles.dialogTitle}>{S.add.title}</h2>
          <div className={styles.steps} aria-label={stepLabel(step)}>
            {stepStates.map((item) => (
              <span
                key={item.n}
                className={step === item.n ? `${styles.stepLabel} ${styles.stepActive}` : styles.stepLabel}
              >
                <span className={step >= item.n ? `${styles.stepNum} ${styles.stepNumOn}` : styles.stepNum}>{item.n}</span>
                {item.label}
              </span>
            ))}
          </div>
          <button type="button" className={styles.dialogClose} aria-label={S.add.close} onClick={close}>
            <Icon name="x" size={12} />
          </button>
        </div>

        {step === 1 ? (
          <div className={styles.dialogBody}>
            <p className={styles.dialogText}>{S.add.pickAgent}</p>
            <div className={styles.agentChoices}>
              {choices.map((choice) => {
                const picked = add.agent === choice.agent;
                const cls = picked ? `${styles.choice} ${styles.choicePicked}` : styles.choice;
                return (
                  <button
                    key={choice.agent}
                    type="button"
                    className={cls}
                    disabled={choice.disabled}
                    aria-pressed={picked}
                    onClick={() => patchAdd({ agent: choice.agent })}
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
          </div>
        ) : null}

        {step === 2 ? (
          <div className={`${styles.dialogBody} ${styles.dialogBodyRoomy}`}>
            <p className={styles.dialogText}>{S.add.nameIntro(agentName)}</p>
            <div className={styles.nameChips}>
              {S.add.names.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={add.name === name ? `${styles.nameChip} ${styles.choicePicked}` : styles.nameChip}
                  aria-pressed={add.name === name}
                  onClick={() => patchAdd({ name })}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className={styles.folderNote}>
              <Icon name="folder" size={13} />
              <span>{S.add.folderNote(agentName)}</span>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className={`${styles.dialogBody} ${styles.dialogBodyRoomy}`}>
            {add.signIn === null ? (
              <div className={styles.signInBlock}>
                <p className={styles.dialogText}>{S.add.signInIntro(agentName, add.name)}</p>
                <button
                  type="button"
                  className={styles.dialogSignInButton}
                  disabled={!services || add.busy || !add.account}
                  onClick={onOpenSignIn}
                >
                  <Icon name="login" size={14} />
                  {S.add.openSignIn}
                </button>
              </div>
            ) : (
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
            )}
          </div>
        ) : null}

        <div className={styles.dialogFoot}>
          <code className={styles.cli}>{cliLine(add.agent, add.name)}</code>
          {step > 1 ? (
            <button type="button" className={styles.button} disabled={add.busy} onClick={onBack}>
              {S.add.back}
            </button>
          ) : null}
          <button
            type="button"
            className={nextDisabled ? `${styles.nextButton} ${styles.faded}` : styles.nextButton}
            disabled={nextDisabled}
            onClick={onNext}
          >
            {step === 3 ? S.add.done : S.add.next}
          </button>
        </div>
      </div>
    </div>
  );
}
