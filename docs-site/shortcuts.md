# Keyboard shortcuts

Use keyboard shortcuts to navigate areas quickly, control runs, toggle terminals, and open the command palette.

![Command palette overlay for running commands and searching](images/palette.jpg)

## What you see

Pressing ⌘K on macOS (Ctrl+K elsewhere) opens the **Command palette** overlay:

- **Search input**: filter commands, navigate to areas, or search through runs and sessions.
- **Actions list**: execute commands such as adding accounts, reporting problems, or toggling view panels.
- **Escape hint**: press `esc` to close the palette.

## Navigation and global shortcuts

orch uses ⌘ on macOS and Ctrl on Windows and Linux as the primary modifier.

| macOS | Windows and Linux | Action | Description |
| --- | --- | --- | --- |
| ⌘K | Ctrl+K | Command palette | Open the command palette to search or run commands |
| ⌘N | Ctrl+N | New spec | Open the [new-spec.md](new-spec.md) screen to add a spec |
| ⌘1 | Ctrl+1 | Specs | Switch to the [specs.md](specs.md) screen |
| ⌘2 | Ctrl+2 | Review | Switch to the [review.md](review.md) screen |
| ⌘3 | Ctrl+3 | Sessions | Switch to the [sessions.md](sessions.md) screen |
| ⌘4 | Ctrl+4 | Trust | Switch to the [trust.md](trust.md) screen |
| ⌘5 | Ctrl+5 | Accounts | Switch to the [accounts.md](accounts.md) screen |
| ⌘B | Ctrl+B | Capacity panel | Toggle the slide-out capacity panel ([limits.md](limits.md)) |
| ⌃` | Ctrl+` | Terminal dock | Toggle the bottom interactive shell dock in any area |
| ⌘\ | Ctrl+\ | Split editor | Split the Live editor into two panes, or close the split |
| ⌘W | Ctrl+W | Close tab | Close the active tab in the Live run pane |
| F1 | F1 | Help | Open the live help guide |

## Good to know

- The terminal shortcut ⌃` (Ctrl+`) uses the Control key on all platforms, matching standard terminal emulator conventions.
- When you are inside an active terminal dock, standard terminal keybindings (such as `Ctrl+C` to interrupt a process) take precedence over app shortcuts.
- Numbered area shortcuts (`⌘1` through `⌘5`) match the order of items in the activity bar.
- The terminal dock stays open when you switch areas. In Specs → Plan and Specs → Live, it remains in the designed position within that view.
