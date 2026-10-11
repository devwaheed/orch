import { Icon } from '../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import { useThemeStore } from '../../services/theme.js';
import { notificationService } from '../../services/notifications.js';
import { formatShortcut } from '../../services/shortcuts.js';
import { shellStrings } from '../strings.js';
import styles from './TitleBar.module.css';

export function TitleBar() {
  const activeProject = useWorkbenchStore((s) => s.activeProject);
  const capacityOpen = useWorkbenchStore((s) => s.capacityOpen);
  const toggleCapacity = useWorkbenchStore((s) => s.toggleCapacity);
  const openPalette = useWorkbenchStore((s) => s.openPalette);
  const setActiveRoute = useWorkbenchStore((s) => s.setActiveRoute);

  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  const unreadCount = notificationService.unreadCount;
  const isLight = resolvedTheme === 'light';
  const themeLabel = isLight ? shellStrings.titleBar.themeDark : shellStrings.titleBar.themeLight;
  const themeIcon = isLight ? 'moon' : 'sun';
  const kbdShortcut = formatShortcut('commandPalette');

  const handleNewJob = () => {
    setActiveRoute('/jobs/new');
  };

  return (
    <header className={styles.titleBar}>
      <div className={styles.logo}>
        <Icon name="logo" size={20} weight={1.9} className={styles.logoIcon ?? ''} />
        <span>{shellStrings.appName}</span>
      </div>

      <button
        type="button"
        className={styles.projectButton}
        aria-label={shellStrings.titleBar.projectFolder(activeProject)}
      >
        <Icon name="folder" size={14} weight={1.8} className={styles.folderIcon ?? ''} />
        <span>{activeProject}</span>
        <Icon name="chevDown" size={12} weight={2} className={styles.chevIcon ?? ''} />
      </button>

      <div className={styles.searchContainer}>
        <button
          type="button"
          onClick={openPalette}
          className={styles.searchButton}
          aria-label={shellStrings.titleBar.searchAriaLabel}
        >
          <Icon name="search" size={14} weight={1.9} />
          <span className={styles.searchButtonText}>
            {shellStrings.titleBar.searchPlaceholder}
          </span>
          <span className={styles.kbd}>{kbdShortcut}</span>
        </button>
      </div>

      <button
        type="button"
        className={styles.iconButton}
        aria-label={shellStrings.titleBar.notifications(unreadCount)}
        title={shellStrings.titleBar.notifications(unreadCount)}
      >
        <Icon name="bell" size={17} weight={1.8} />
        {unreadCount > 0 && <span className={styles.badgeDot} />}
      </button>

      <button
        type="button"
        onClick={toggleTheme}
        className={styles.iconButton}
        aria-label={themeLabel}
        title={themeLabel}
      >
        <Icon name={themeIcon} size={17} weight={1.8} />
      </button>

      <button
        type="button"
        onClick={toggleCapacity}
        className={`${styles.iconButton} ${capacityOpen ? styles.iconButtonActive : ''}`}
        aria-label={shellStrings.titleBar.toggleCapacity}
        title={shellStrings.titleBar.toggleCapacity}
        aria-pressed={capacityOpen}
      >
        <Icon name="panelRight" size={17} weight={1.8} />
      </button>

      <button
        type="button"
        onClick={handleNewJob}
        className={styles.newJobButton}
      >
        <Icon name="plus" size={13} weight={2.6} />
        <span>{shellStrings.titleBar.newJob}</span>
      </button>
    </header>
  );
}
