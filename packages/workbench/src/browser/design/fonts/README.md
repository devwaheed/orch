# Bundled Fonts (UI-03)

In accordance with locked decision `UI-03`, fonts are bundled with the app (no network font loading).

## Required Font Files

The following WOFF2 font files should be placed in this folder (`packages/workbench/src/browser/design/fonts/`):

- `IBMPlexSans-Regular.woff2` (Weight: 400, Style: normal)
- `IBMPlexSans-Medium.woff2` (Weight: 500, Style: normal)
- `IBMPlexSans-SemiBold.woff2` (Weight: 600, Style: normal)
- `IBMPlexMono-Regular.woff2` (Weight: 400, Style: normal)
- `IBMPlexMono-Medium.woff2` (Weight: 500, Style: normal)
- `IBMPlexMono-SemiBold.woff2` (Weight: 600, Style: normal)

## License

IBM Plex is open source and licensed under the SIL Open Font License (OFL) Version 1.1. The complete license text is available in `OFL.txt` in this directory.

## Note on Vendoring in the Sandbox

Due to terminal sandbox network restrictions (`BypassSandbox: false`), font binaries cannot be fetched from remote registries directly during sandboxed agent execution. The `@font-face` declarations are wired in `tokens.css` pointing to these relative files. A lead or maintainer will place the exact binary files in this directory prior to release packaging.
