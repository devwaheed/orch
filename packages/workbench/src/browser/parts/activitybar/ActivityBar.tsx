import { Icon } from '../../../../../../design/icons/Icon.js';
import type { IconName } from '../../../../../../design/icons/icons.js';
import { useWorkbenchStore, type AreaId } from '../../services/workbenchStore.js';
import { shellStrings } from '../strings.js';
import { cx } from '../cx.js';

interface ActivityItemConfig {
  id: AreaId;
  name: string;
  label: string;
  icon: IconName;
  badgeKey?: string;
  badgeType?: 'info' | 'ok' | 'warn' | 'err';
}

const WORK_ITEMS: readonly ActivityItemConfig[] = [
  {
    id: 'work',
    name: shellStrings.activityBar.work.name,
    label: shellStrings.activityBar.work.label,
    icon: 'terminal',
  },
  {
    id: 'specs',
    name: shellStrings.activityBar.specs.name,
    label: shellStrings.activityBar.specs.label,
    icon: 'listOrdered',
    badgeKey: 'specs',
    badgeType: 'info',
  },
  {
    id: 'review',
    name: shellStrings.activityBar.review.name,
    label: shellStrings.activityBar.review.label,
    icon: 'review',
    badgeKey: 'review',
    badgeType: 'ok',
  },
  {
    id: 'sessions',
    name: shellStrings.activityBar.sessions.name,
    label: shellStrings.activityBar.sessions.label,
    icon: 'history',
    badgeKey: 'sessions',
    badgeType: 'warn',
  },
];

const CONFIG_ITEMS: readonly ActivityItemConfig[] = [
  {
    id: 'trust',
    name: shellStrings.activityBar.trust.name,
    label: shellStrings.activityBar.trust.label,
    icon: 'ladder',
  },
  {
    id: 'accounts',
    name: shellStrings.activityBar.accounts.name,
    label: shellStrings.activityBar.accounts.label,
    icon: 'users',
    badgeKey: 'accounts',
    badgeType: 'err',
  },
];

// .itemButton — an active item keeps --active on hover (module: .itemButton.itemButtonActive:hover)
const itemButtonClass =
  'relative flex flex-col items-center justify-center gap-2px w-[48px] h-[50px] min-h-hit-min rounded-9px border-0';
const itemButtonActiveClass = 'bg-active text-text';
const itemButtonIdleClass = 'bg-transparent text-muted2 hover:bg-raised hover:text-text3';

const badgeClass =
  'absolute top-3px right-1 min-w-[15px] h-[15px] px-3px box-border rounded-md text-on-badge text-10px font-semibold flex items-center justify-center';

const BADGE_BG: Record<NonNullable<ActivityItemConfig['badgeType']>, string> = {
  info: 'bg-accent-solid',
  ok: 'bg-ok-solid',
  warn: 'bg-warn-fill',
  err: 'bg-err-solid',
};

export function ActivityBar() {
  const activeArea = useWorkbenchStore((s) => s.activeArea);
  const setActiveArea = useWorkbenchStore((s) => s.setActiveArea);
  const badges = useWorkbenchStore((s) => s.badges);

  const renderItem = (item: ActivityItemConfig) => {
    const isActive = activeArea === item.id;
    const badgeValue = item.badgeKey ? badges[item.badgeKey] : undefined;
    const hasBadge = badgeValue !== undefined && badgeValue !== '' && badgeValue !== 0;

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => setActiveArea(item.id)}
        aria-label={item.label}
        title={item.label}
        aria-pressed={isActive}
        className={cx(itemButtonClass, isActive ? itemButtonActiveClass : itemButtonIdleClass)}
      >
        <Icon name={item.icon} size={18} weight={1.8} />
        <span className="text-9p5 tracking-[0.02em]">{item.name}</span>
        {hasBadge && (
          <span className={cx(badgeClass, BADGE_BG[item.badgeType ?? 'info'])}>
            {String(badgeValue)}
          </span>
        )}
      </button>
    );
  };

  const isSettingsActive = activeArea === 'settings';

  return (
    <nav
      aria-label={shellStrings.activityBar.navAriaLabel}
      className="flex w-activitybar-w shrink-0 flex-col items-center gap-1 py-4 border-r border-line bg-chrome2 in-data-[menu-side=right]:border-r-0 in-data-[menu-side=right]:border-l"
    >
      {WORK_ITEMS.map(renderItem)}

      <div className="w-[28px] h-px bg-line my-2" />

      {CONFIG_ITEMS.map(renderItem)}

      <div className="flex-auto" />

      <button
        type="button"
        onClick={() => setActiveArea('settings')}
        aria-label={shellStrings.activityBar.settings.label}
        title={shellStrings.activityBar.settings.label}
        aria-pressed={isSettingsActive}
        className={cx(
          'flex items-center justify-center w-[40px] h-[40px] min-h-hit-min rounded-9px border-0',
          isSettingsActive
            ? 'bg-active text-text'
            : 'bg-transparent text-muted2 hover:bg-raised hover:text-text',
        )}
      >
        <Icon name="gear" size={19} weight={1.8} />
      </button>
    </nav>
  );
}
