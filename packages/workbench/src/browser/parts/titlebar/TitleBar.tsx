import { Icon } from '../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import { useThemeStore } from '../../services/theme.js';
import { notificationService } from '../../services/notifications.js';
import { formatShortcut } from '../../services/shortcuts.js';
import { shellStrings } from '../strings.js';
import { cx } from '../cx.js';

// .iconButton — active keeps its hover override (module: :hover wins over .iconButtonActive)
const iconButtonClass =
  'relative flex items-center justify-center w-[36px] h-[36px] min-h-hit-min rounded-md border-0 cursor-pointer hover:bg-raised';

export function TitleBar() {
  const activeProject = useWorkbenchStore((s) => s.activeProject);
  const capacityOpen = useWorkbenchStore((s) => s.capacityOpen);
  const toggleCapacity = useWorkbenchStore((s) => s.toggleCapacity);
  const openPalette = useWorkbenchStore((s) => s.openPalette);
  const setActiveRoute = useWorkbenchStore((s) => s.setActiveRoute);
  const setActiveProject = useWorkbenchStore((s) => s.setActiveProject);

  const chooseProject = async (): Promise<void> => {
    const folder = await window.orch?.app.chooseFolder();
    if (folder) setActiveProject(folder);
  };

  // The design shows the repo's folder name (api-server), not its path.
  const displayProject = activeProject.split(/[\\/]/).filter(Boolean).pop() ?? activeProject;

  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  const unreadCount = notificationService.unreadCount;
  const showNotificationDot = unreadCount > 0 || window.orch?.app.demo === true;
  const isLight = resolvedTheme === 'light';
  const themeLabel = isLight ? shellStrings.titleBar.themeDark : shellStrings.titleBar.themeLight;
  const themeIcon = isLight ? 'moon' : 'sun';
  const kbdShortcut = formatShortcut('commandPalette');

  const handleNewJob = () => {
    setActiveRoute('/jobs/new');
  };

  return (
    <header className="flex flex-wrap items-center gap-5 pr-5 pl-7 min-h-titlebar-h border-b border-line bg-chrome">
      <div className="flex items-center gap-9px font-semibold text-lg text-text">
        <Icon name="logo" size={20} weight={1.9} className="text-accent" />
        <span>{shellStrings.appName}</span>
      </div>

      <button
        type="button"
        className="flex items-center gap-2 px-9px py-5px min-h-hit-min rounded-7px border border-line bg-transparent text-text text-sm cursor-pointer hover:bg-raised"
        onClick={() => void chooseProject()}
        aria-label={shellStrings.titleBar.projectFolder(displayProject)}
      >
        <Icon name="folder" size={14} weight={1.8} className="text-muted" />
        <span>{displayProject}</span>
        <Icon name="chevDown" size={12} weight={2} className="text-muted" />
      </button>

      <div className="flex flex-auto justify-center">
        <button
          type="button"
          onClick={openPalette}
          className="flex items-center gap-3 w-full max-w-[440px] py-2 px-4 min-h-hit-min rounded-md border border-line bg-panel2 text-muted2 text-sm cursor-pointer text-left hover:border-btnline"
          aria-label={shellStrings.titleBar.searchAriaLabel}
        >
          <Icon name="search" size={14} weight={1.9} />
          <span className="flex-auto">
            {shellStrings.titleBar.searchPlaceholder}
          </span>
          <span className="py-1px px-2 border border-kbdline rounded-xs font-mono text-11px">{kbdShortcut}</span>
        </button>
      </div>

      <button
        type="button"
        className={cx(iconButtonClass, 'bg-transparent', 'text-text3')}
        aria-label={shellStrings.titleBar.notifications(unreadCount)}
        title={shellStrings.titleBar.notifications(unreadCount)}
      >
        <Icon name="bell" size={17} weight={1.8} />
        {showNotificationDot && <span className="absolute top-2 right-2 w-[7px] h-[7px] [border-radius:50%] bg-warn-solid" />}
      </button>

      <button
        type="button"
        onClick={toggleTheme}
        className={cx(iconButtonClass, 'bg-transparent', 'text-text3')}
        aria-label={themeLabel}
        title={themeLabel}
      >
        <Icon name={themeIcon} size={17} weight={1.8} />
      </button>

      <button
        type="button"
        onClick={toggleCapacity}
        className={cx(
          iconButtonClass,
          capacityOpen ? 'bg-active' : 'bg-transparent',
          'text-text3',
        )}
        aria-label={shellStrings.titleBar.toggleCapacity}
        title={shellStrings.titleBar.toggleCapacity}
        aria-pressed={capacityOpen}
      >
        <Icon name="panelRight" size={17} weight={1.8} />
      </button>

      <button
        type="button"
        onClick={handleNewJob}
        className="flex items-center gap-2 px-5 py-7px min-h-[34px] rounded-md border-0 bg-accent-solid text-on-accent font-semibold text-sm cursor-pointer hover:opacity-92"
      >
        <Icon name="plus" size={13} weight={2.6} />
        <span>{shellStrings.titleBar.newJob}</span>
      </button>
    </header>
  );
}
