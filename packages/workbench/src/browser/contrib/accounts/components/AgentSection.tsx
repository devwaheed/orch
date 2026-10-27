import type { AccountId, AgentId } from '@orchagents/contracts';
import type { CoreServices } from '../../../services/channelSchemas.js';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import type { AccountRowVM, AgentSectionVM, PillTone } from '../accountsView.js';
import { accountsStrings as S } from '../strings.js';

const TILE_CLASS: Record<AgentId, string> = {
  claude: 'bg-cc-bg text-cc-fg',
  codex: 'bg-cx-bg text-cx-fg',
  gemini: 'bg-gm-bg text-gm-fg',
  opencode: 'bg-oc-bg text-oc-fg',
  agy: 'bg-ag-bg text-ag-fg',
};

const MONO: Record<AgentId, string> = {
  claude: 'CC',
  codex: 'CX',
  gemini: 'GM',
  opencode: 'OC',
  agy: 'AG',
};

const PILL_CLASS: Record<PillTone, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  limited: 'bg-warn-fill text-on-warn',
  neutral: 'bg-neutral text-text3',
  err: 'bg-err-bg text-err',
};

const TILE = 'flex flex-[0_0_30px] items-center justify-center h-[30px] rounded-md font-mono text-11px font-semibold';
const CHIP = 'inline-flex items-center gap-2 px-4 py-1 rounded-pill text-xs whitespace-nowrap';
const NOTE = 'flex items-start gap-4 mx-7 mt-5 px-5 py-4 rounded-9px text-sm';
const BUTTON =
  'flex items-center gap-2 min-h-[32px] px-4 py-2 border border-btnline rounded-md bg-btn text-sm text-text cursor-pointer disabled:cursor-default disabled:opacity-45';
const PILL = 'inline-flex items-center gap-5px px-9px py-3px rounded-pill text-11px whitespace-nowrap';
const ICON_BUTTON =
  'flex items-center justify-center w-[32px] h-[32px] border border-btnline rounded-7px bg-transparent text-muted cursor-pointer [&>svg]:fill-none [&>svg]:stroke-current';
const LOGIN_BUTTON =
  'flex items-center gap-2 min-h-[32px] px-4 py-2 rounded-7px border border-btnline bg-transparent text-sm text-text3 cursor-pointer';
const LOGIN_BUTTON_SIGNED_OUT = 'border-0 bg-accent-solid text-on-accent';

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
  const supportClass = section.support === 'parallel' ? 'bg-ok-bg text-ok' : 'bg-warn-bg text-warn';
  return (
    <section className="border border-line rounded-xl bg-panel overflow-hidden" aria-label={section.name}>
      <div className="flex flex-wrap items-center gap-5 px-7 py-5 border-b border-line2">
        <span className={`${TILE} ${TILE_CLASS[section.id]}`}>{MONO[section.id]}</span>
        <div className="flex flex-col flex-auto min-w-0">
          <h2 className="m-0 text-md font-semibold">{section.name}</h2>
          <span className="text-muted2 text-11px">
            <span className="font-mono">{section.command}</span> · {section.summary}
          </span>
        </div>
        <span title={section.supportTitle} className={`${CHIP} ${supportClass}`}>
          <Icon name={section.support === 'parallel' ? 'check' : 'alert'} size={12} />
          {section.supportText}
        </span>
        <span className="font-mono text-11px text-faint">{section.via}</span>
        <button
          type="button"
          className={BUTTON}
          disabled={!section.add.enabled || !services}
          title={section.add.title}
          onClick={() => onAdd(section.id)}
        >
          <Icon name="plus" size={12} />
          {S.addAccount}
        </button>
      </div>

      {section.supportNote ? (
        <div className={`${NOTE} border border-warn-line bg-warn-bg2 text-warn-text`}>
          <Icon name="alert" size={14} />
          <span>{section.supportNote}</span>
        </div>
      ) : null}

      {section.isOpenCode ? (
        <div className={`${NOTE} border border-info-line bg-info-bg text-info-strong`}>
          <Icon name="alert" size={14} />
          <span>{S.agent.claudeProNote}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 mx-7 mt-5 px-5 py-9px rounded-9px bg-panel2 text-sm [&>svg]:text-ok-dot">
        <Icon name="book" size={14} />
        <span className="flex-[1_1_300px] text-text2">
          {section.skillsText}
          {section.skillsDir ? <> <span className="font-mono">{section.skillsDir}</span></> : null}
        </span>
        <label className="flex items-center gap-7px min-h-[30px] text-text3 cursor-pointer">
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
  const rowClass = account.dimmed
    ? 'flex flex-wrap items-center gap-7 px-7 py-13px border-b border-line2 opacity-75'
    : 'flex flex-wrap items-center gap-7 px-7 py-13px border-b border-line2';
  return (
    <div className={rowClass}>
      <div className="flex flex-[1_1_210px] flex-col gap-2px min-w-0">
        <span className="flex items-center gap-3">
          <span className="font-semibold">{account.label}</span>
          {account.isPrimary ? (
            <span className="inline-flex items-center gap-1 px-7px py-1px rounded-pill border border-info-line text-info text-2xs">
              <Icon name="starFill" size={10} />
              {S.account.primary}
            </span>
          ) : null}
        </span>
        <span className="text-muted2 text-sm">
          {[account.emailDisplay, account.plan].filter(Boolean).join(' · ')}
        </span>
        <span className="font-mono text-faint2 text-2xs">{account.profileDir}</span>
        {account.logins.length > 0 ? (
          <span className="flex flex-wrap gap-1 mt-1">
            {account.logins.map((login) => (
              <span key={login.name} className="inline-flex items-center gap-5px px-3 py-2px rounded-sm bg-neutral text-11px">
                <span>{login.name}</span>
                <span className="text-muted2 text-sm">{login.kind}</span>
              </span>
            ))}
          </span>
        ) : null}
      </div>

      <div className="flex flex-[1_1_200px] flex-col gap-3px min-w-0">
        <span className="text-faint text-11px">{S.account.routingRole}</span>
        <span className="text-sm">{account.roleText}</span>
      </div>

      {account.signedOut ? null : (
        <button
          type="button"
          className="flex items-center gap-2 min-h-[30px] px-9px py-5px border-0 bg-transparent text-info text-sm cursor-pointer"
          onClick={onUsage}
        >
          <Icon name="gauge" size={13} />
          {account.usageText}
        </button>
      )}

      <span className={`${PILL} ${PILL_CLASS[account.tone]}`}>
        <span className="w-[6px] h-[6px] rounded-pill bg-current" />
        {account.stateLabel}
      </span>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-7px min-h-[32px] text-text3 text-sm cursor-pointer">
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
            className={ICON_BUTTON}
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
          className={account.signedOut ? `${LOGIN_BUTTON} ${LOGIN_BUTTON_SIGNED_OUT}` : LOGIN_BUTTON}
          disabled={disabled}
          onClick={() => onSignIn(account.id)}
        >
          <Icon name="login" size={12} />
          {account.loginLabel}
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
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
