import { Icon } from '../../../../../../design/icons/Icon.js';
import type { IconName } from '../../../../../../design/icons/icons.js';
import { useWorkbenchStore, type AreaId } from '../../services/workbenchStore.js';
import { shellStrings } from '../strings.js';
import styles from './ActivityBar.module.css';

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

export function ActivityBar() {
  const activeArea = useWorkbenchStore((s) => s.activeArea);
  const setActiveArea = useWorkbenchStore((s) => s.setActiveArea);
  const badges = useWorkbenchStore((s) => s.badges);

  const renderItem = (item: ActivityItemConfig) => {
    const isActive = activeArea === item.id;
    const badgeValue = item.badgeKey ? badges[item.badgeKey] : undefined;
    const hasBadge = badgeValue !== undefined && badgeValue !== '' && badgeValue !== 0;

    let badgeClass = styles.badgeInfo;
    if (item.badgeType === 'ok') badgeClass = styles.badgeOk;
    else if (item.badgeType === 'warn') badgeClass = styles.badgeWarn;
    else if (item.badgeType === 'err') badgeClass = styles.badgeErr;

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => setActiveArea(item.id)}
        aria-label={item.label}
        title={item.label}
        aria-pressed={isActive}
        className={`${styles.itemButton} ${isActive ? styles.itemButtonActive : ''}`}
      >
        <Icon name={item.icon} size={18} weight={1.8} />
        <span className={styles.itemLabel}>{item.name}</span>
        {hasBadge && (
          <span className={`${styles.badge} ${badgeClass}`}>
            {String(badgeValue)}
          </span>
        )}
      </button>
    );
  };

  const isSettingsActive = activeArea === 'settings';

  return (
    <nav aria-label={shellStrings.activityBar.navAriaLabel} className={styles.activityBar}>
      {WORK_ITEMS.map(renderItem)}

      <div className={styles.divider} />

      {CONFIG_ITEMS.map(renderItem)}

      <div className={styles.spacer} />

      <button
        type="button"
        onClick={() => setActiveArea('settings')}
        aria-label={shellStrings.activityBar.settings.label}
        title={shellStrings.activityBar.settings.label}
        aria-pressed={isSettingsActive}
        className={`${styles.settingsButton} ${isSettingsActive ? styles.settingsButtonActive : ''}`}
      >
        <Icon name="gear" size={19} weight={1.8} />
      </button>
    </nav>
  );
}
