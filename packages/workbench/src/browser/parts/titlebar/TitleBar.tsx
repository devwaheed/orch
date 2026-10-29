import { Icon } from '../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import { useThemeStore } from '../../services/theme.js';
import { notificationService, useNotificationStore } from '../../services/notifications.js';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { formatShortcut } from '../../services/shortcuts.js';
import { workbenchRegistry } from '../../services/registry.js';
import { shellStrings } from '../strings.js';
import { cx } from '../cx.js';

// .iconButton — active keeps its hover override (module: :hover wins over .iconButtonActive)
const iconButtonClass =
  'relative flex items-center justify-center w-[36px] h-[36px] min-h-hit-min rounded-md border-0 cursor-pointer hover:bg-raised';

export function TitleBar() {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const items = useNotificationStore((s) => s.items);
  const clearNotifications = useNotificationStore((s) => s.clear);
  const activeProject = useWorkbenchStore((s) => s.activeProject);
  const capacityOpen = useWorkbenchStore((s) => s.capacityOpen);
  const toggleCapacity = useWorkbenchStore((s) => s.toggleCapacity);
  const openPalette = useWorkbenchStore((s) => s.openPalette);
  const setActiveRoute = useWorkbenchStore((s) => s.setActiveRoute);
  const setActiveArea = useWorkbenchStore((s) => s.setActiveArea);
  const setActiveProject = useWorkbenchStore((s) => s.setActiveProject);

  const chooseProject = async (): Promise<void> => {
    const folder = await window.orch?.app.chooseFolder();
    if (folder) setActiveProject(folder);
  };

  // The design shows the repo's folder name (api-server), not its path.
  const displayProject = activeProject.split(/[\\/]/).filter(Boolean).pop() ?? activeProject;

  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  const unreadCount = items.filter((item) => !item.read).length;
  const showNotificationDot = unreadCount > 0;
  const isLight = resolvedTheme === 'light';
  const themeLabel = isLight ? shellStrings.titleBar.themeDark : shellStrings.titleBar.themeLight;
  const themeIcon = isLight ? 'moon' : 'sun';
  const kbdShortcut = formatShortcut('commandPalette');

  const handleNewJob = () => {
    setActiveRoute('/jobs/new');
  };

  const showNewOptions = async (event: ReactMouseEvent<HTMLButtonElement>): Promise<void> => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const selected = await window.orch?.app.popupMenu?.([
      { id: 'spec', label: shellStrings.titleBar.newSpec },
      { id: 'product', label: shellStrings.titleBar.newProduct },
    ], Math.round(bounds.left), Math.round(bounds.bottom));
    if (selected === 'spec') handleNewJob();
    if (selected === 'product') setActiveRoute('/product/new');
  };

  useEffect(() => {
    if (!notificationsOpen) return undefined;
    notificationService.markAllRead();
    const onClick = (event: MouseEvent) => {
      if (!popoverRef.current?.contains(event.target as Node) && !bellRef.current?.contains(event.target as Node)) {
        setNotificationsOpen(false);
        bellRef.current?.focus();
      }
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setNotificationsOpen(false); bellRef.current?.focus(); } };
    window.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('click', onClick); window.removeEventListener('keydown', onKey); };
  }, [notificationsOpen]);

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

      <div className="relative">
        <button
          ref={bellRef}
          type="button"
          onClick={() => setNotificationsOpen((open) => !open)}
          className={cx(iconButtonClass, 'bg-transparent', 'text-text3')}
          aria-label={shellStrings.titleBar.notifications(unreadCount)}
          title={shellStrings.titleBar.notifications(unreadCount)}
        >
          <Icon name="bell" size={17} weight={1.8} />
          {showNotificationDot && <span className="absolute top-2 right-2 w-[7px] h-[7px] [border-radius:50%] bg-warn-solid" />}
        </button>
        {notificationsOpen && (
        <div ref={popoverRef} className="absolute right-0 top-full z-20 mt-2 flex w-80 max-h-96 flex-col overflow-hidden rounded-xl border border-btnline bg-panel shadow-dialog" role="region" aria-label="Notifications">
          <div className="flex items-center gap-3 border-b border-line px-5 py-4">
            <h2 className="m-0 flex-auto text-base font-semibold">Notifications</h2>
            <button type="button" onClick={clearNotifications} className="min-h-8 rounded-md border-0 bg-transparent px-3 text-sm text-muted2 cursor-pointer hover:bg-raised">Clear</button>
          </div>
          {items.length === 0 ? <p className="m-0 px-5 py-6 text-sm text-muted2">No notifications yet.</p> : (
            <div className="flex flex-col overflow-y-auto">
              {items.slice(0, 50).map((item) => <button key={item.id} type="button" onClick={() => {
                if (item.target === 'specs' && item.specId) { workbenchRegistry.getRoute('specs')?.openNotificationSpec?.(item.specId); setActiveArea('specs'); }
                else if (item.target === 'review') setActiveArea('review');
                else if (item.target === 'accounts') setActiveArea('accounts');
                setNotificationsOpen(false); bellRef.current?.focus();
              }} className="flex min-h-14 items-center gap-3 border-0 border-b border-line bg-transparent px-5 py-3 text-left cursor-pointer hover:bg-raised">
                <Icon name={item.icon} size={16} weight={1.9} className="shrink-0 text-muted2" />
                <span className="min-w-0 flex-auto truncate text-sm text-text">{item.body}</span>
                <span className="shrink-0 text-xs text-muted2">{relativeTime(item.timestamp)}</span>
              </button>)}
            </div>
          )}
        </div>
      )}
      </div>

      <button
        type="button"
        onClick={() => workbenchRegistry.runCommand('help.open')}
        className={cx(iconButtonClass, 'bg-transparent', 'text-text3')}
        aria-label="Help"
        title="Help"
      >
        <Icon name="book" size={17} weight={1.8} />
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

      <div className="flex overflow-hidden rounded-md">
        <button
          type="button"
          onClick={handleNewJob}
          className="flex items-center gap-2 px-5 py-7px min-h-[34px] rounded-none border-0 bg-accent-solid text-on-accent font-semibold text-sm cursor-pointer hover:opacity-92"
        >
          <Icon name="plus" size={13} weight={2.6} />
          <span>{shellStrings.titleBar.newSpec}</span>
        </button>
        <button
          type="button"
          onClick={(event) => void showNewOptions(event)}
          aria-label={shellStrings.titleBar.moreNewOptions}
          className="flex items-center justify-center w-8 min-h-[34px] border-0 border-l border-solid border-on-accent/35 bg-accent-solid text-on-accent cursor-pointer hover:opacity-92"
        >
          <Icon name="chevDown" size={12} weight={2} />
        </button>
      </div>
    </header>
  );
}

function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
