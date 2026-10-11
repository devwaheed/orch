# Phase 5 · Beta and desktop packaging (weeks 12–15) · Release (week 16)

**Gate (beta):** no data-loss or account-leak bugs open; install to first job under 10 minutes on a clean machine of each OS.
**Release:** the checklist in the implementation plan.

### S5-01 · Installers
- **Owns:** `packages/app/electron-builder.config.*`, `.github/workflows/release.yml` (**human approves**).
- **Refs:** LOCKED REL-03, PRD-02.
- **Checks:** installers build on CI for all formats; the app starts on clean VMs.

### S5-02 · Signing and notarisation in CI (human approves)
- **Refs:** LOCKED REL-03; S4-12.
- **Checks:** no "unknown developer" warnings on clean macOS and Windows.

### S5-03 · Auto-update
- **Owns:** `packages/app/src/electron-main/updates/`.
- **Refs:** LOCKED REL-01, REL-02.
- **Checks:** beta → newer beta update; no update applied during an active job.

### S5-04 · Docs site
- **Owns:** `docs-site/`.
- **Do:** publish the user guide as a static site; one page per section.

### S5-05 · Bug-report bundle and uninstall
- **Owns:** `packages/cli/src/node/bugreport/`, `packages/cli/src/node/uninstall/`.
- **Refs:** LOCKED SEC-03, SEC-05.
- **Checks:** bundle contains logs and doctor output, no secrets (planted-secret test); uninstall leaves repos untouched.

### S5-06 · Beta fixes (human triage)
- **Do:** 5–10 beta users; each fix is its own story with a failing test first.

### S5-07 · Release (human only)
