import type { AccountId, AgentId } from '@orchagents/contracts';
import type { CoreServices } from '../../../services/channelSchemas.js';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import type { AccountRowVM, AgentSectionVM, PillTone } from '../accountsView.js';
import { accountsStrings as S } from '../strings.js';
import styles from './AccountsScreen.module.css';

const TILE_CLASS: Record<AgentId, string> = {
  claude: styles.tileClaude ?? '',
  codex: styles.tileCodex ?? '',
  gemini: styles.tileGemini ?? '',
  opencode: styles.tileOpencode ?? '',
  agy: styles.tileAgy ?? '',
};

const MONO: Record<AgentId, string> = {
  claude: 'CC',
  codex: 'CX',
  gemini: 'GM',
  opencode: 'OC',
  agy: 'AG',
};

const PILL_CLASS: Record<PillTone, string> = {
  ok: styles.pillOk ?? '',
  warn: styles.pillWarn ?? '',
  limited: styles.pillLimited ?? '',
  neutral: styles.pillNeutral ?? '',
  err: styles.pillErr ?? '',
};

export interface AgentSectionProps {
  readonly section: AgentSectionVM;
  readonly services: CoreServices | null;
  readonly onUse: (id: AccountId, use: boolean) => void;
  readonly onPrimary: (id: AccountId) => void;
  readonly onSignIn: (id: AccountId) => void;
  readonly onShareSkills: (agent: AgentId, share: boolean) => void;
  readonly onUsage: () => void;
  readonly onAdd: (agent: AgentId) => void;
  readonly onRemove: (id: AccountId, agentName: string, accountName: string) => void;
}

export function AgentSection({ section, services, onUse, onPrimary, onSignIn, onShareSkills, onUsage, onAdd, onRemove }: AgentSectionProps) {
  const supportClass = section.support === 'parallel' ? styles.chipOk : styles.chipWarn;
  return (
    <section className={styles.agent} aria-label={section.name}>
      <div className={styles.agentHead}>
        <span className={`${styles.tile} ${TILE_CLASS[section.id]}`}>{MONO[section.id]}</span>
        <div className={styles.agentTitle}>
          <h2 className={styles.agentName}>{section.name}</h2>
          <span className={styles.agentMeta}>
            <span className={styles.mono}>{section.command}</span> · {section.summary}
          </span>
        </div>
        <span title={section.supportTitle} className={`${styles.chip} ${supportClass}`}>
          <Icon name={section.support === 'parallel' ? 'check' : 'alert'} size={12} />
          {section.supportText}
        </span>
        <span className={styles.via}>{section.via}</span>
        <button
          type="button"
          className={section.add.enabled ? styles.button : `${styles.button} ${styles.faded}`}
          disabled={!section.add.enabled || !services}
          title={section.add.title}
          onClick={() => onAdd(section.id)}
        >
          <Icon name="plus" size={12} />
          {S.addAccount}
        </button>
      </div>

      {section.supportNote ? (
        <div className={`${styles.note} ${styles.noteWarn}`}>
          <Icon name="alert" size={14} />
          <span>{section.supportNote}</span>
        </div>
      ) : null}

      {section.isOpenCode ? (
        <div className={`${styles.note} ${styles.noteInfo}`}>
          <Icon name="alert" size={14} />
          <span>{S.agent.claudeProNote}</span>
        </div>
      ) : null}

      <div className={styles.skills}>
        <Icon name="book" size={14} />
        <span className={styles.skillsText}>
          {section.skillsText}
          {section.skillsDir ? <> <span className={styles.mono}>{section.skillsDir}</span></> : null}
        </span>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={section.skillsShared}
            disabled={!services}
            onChange={(event) => onShareSkills(section.id, event.target.checked)}
          />
          {S.agent.shareWithEveryAccount}
        </label>
      </div>

      {section.accounts.map((account) => (
        <AccountRow
          key={account.id}
          account={account}
          disabled={!services}
          onUse={onUse}
          onPrimary={onPrimary}
          onSignIn={onSignIn}
          onUsage={onUsage}
          agentName={section.name}
          onRemove={onRemove}
        />
      ))}
    </section>
  );
}

interface AccountRowProps {
  readonly account: AccountRowVM;
  readonly disabled: boolean;
  readonly onUse: (id: AccountId, use: boolean) => void;
  readonly onPrimary: (id: AccountId) => void;
  readonly onSignIn: (id: AccountId) => void;
  readonly onUsage: () => void;
  readonly agentName: string;
  readonly onRemove: (id: AccountId, agentName: string, accountName: string) => void;
}

function AccountRow({ account, disabled, onUse, onPrimary, onSignIn, onUsage, agentName, onRemove }: AccountRowProps) {
  const rowClass = account.dimmed ? `${styles.accountRow} ${styles.accountRowDim}` : styles.accountRow;
  return (
    <div className={rowClass}>
      <div className={styles.accountMain}>
        <span className={styles.accountNameRow}>
          <span className={styles.accountLabel}>{account.label}</span>
          {account.isPrimary ? (
            <span className={styles.primaryBadge}>
              <Icon name="starFill" size={10} />
              {S.account.primary}
            </span>
          ) : null}
        </span>
        <span className={styles.accountMeta}>
          {[account.emailDisplay, account.plan].filter(Boolean).join(' · ')}
        </span>
        <span className={styles.profile}>{account.profileDir}</span>
        {account.logins.length > 0 ? (
          <span className={styles.logins}>
            {account.logins.map((login) => (
              <span key={login.name} className={styles.login}>
                <span>{login.name}</span>
                <span className={styles.accountMeta}>{login.kind}</span>
              </span>
            ))}
          </span>
        ) : null}
      </div>

      <div className={styles.role}>
        <span className={styles.roleLabel}>{S.account.routingRole}</span>
        <span className={styles.roleText}>{account.roleText}</span>
      </div>

      {account.signedOut ? null : (
        <button type="button" className={styles.usageButton} onClick={onUsage}>
          <Icon name="gauge" size={13} />
          {account.usageText}
        </button>
      )}

      <span className={`${styles.pill} ${PILL_CLASS[account.tone]}`}>
        <span className={styles.pillDot} />
        {account.stateLabel}
      </span>

      <div className={styles.rowActions}>
        <label className={styles.useLabel}>
          <input
            type="checkbox"
            checked={account.use}
            disabled={account.signedOut || disabled}
            onChange={(event) => onUse(account.id, event.target.checked)}
          />
          {S.account.use}
        </label>
        {account.canMakePrimary ? (
          <button
            type="button"
            className={styles.iconButton}
            aria-label={S.account.makePrimary(account.label)}
            title={S.account.makePrimaryTitle}
            disabled={disabled}
            onClick={() => onPrimary(account.id)}
          >
            <Icon name="starFill" size={13} />
          </button>
        ) : null}
        <button
          type="button"
          className={account.signedOut ? `${styles.loginButton} ${styles.loginButtonSignedOut}` : styles.loginButton}
          disabled={disabled}
          onClick={() => onSignIn(account.id)}
        >
          <Icon name="login" size={12} />
          {account.loginLabel}
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={S.account.removeLabel(agentName, account.label)}
          title={S.account.removeTitle}
          disabled={disabled}
          onClick={() => onRemove(account.id, agentName, account.label)}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
    </div>
  );
}
