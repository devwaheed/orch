# Antigravity CLI multi-account spike

**Date:** 2026-10-28  
**Binary tested:** Antigravity CLI 1.4.9 on macOS 27 (Apple Silicon)

## Question

Can orch run several `agy` accounts on macOS at once while leaving every account's login in its own profile, without orch reading, copying, or storing credentials (ACC-04)?

## What I tried

1. Scanned the installed `agy` executable's printable strings for `GEMINI_FORCE_FILE_STORAGE`, `FORCE_FILE_STORAGE`, `AGY_ADC_AUTH`, `ANTIGRAVITY_GEMINI_DIR`, and keyring/keychain terms. The binary contains `AGY_ADC_AUTH`, `ANTIGRAVITY_GEMINI_DIR`, and keyring/keychain-related strings. It does not contain either file-storage setting name. This is evidence about this binary, not proof that no undocumented file-storage option exists in another build.
2. Started `agy` with a new empty temporary `HOME`, without signing in. Version 1.4.9 displayed “You are currently not signed in” and offered “Google OAuth” and “Use a Google Cloud project.” It created ordinary CLI state under the temporary HOME, including `~/.gemini/antigravity-cli/` and `~/.gemini/config/`. It did not create an OAuth credentials file during this run. No existing HOME, keychain item, or credential file was inspected.
3. Started `agy` with the same temporary HOME and `AGY_ADC_AUTH=true`. It reported “ADC authentication failed” and directed the user to run `gcloud auth application-default login` or set `GOOGLE_APPLICATION_CREDENTIALS`. This confirms that the environment variable selects ADC auth and that this empty profile had no usable ADC. I exited without signing in.

## Evidence from public documentation

- Antigravity's [Enterprise documentation](https://www.agy.dev/docs/enterprise) says ADC credentials use Google's standard ADC search order, documents `AGY_ADC_AUTH=true` for the CLI, and says `GOOGLE_CLOUD_QUOTA_PROJECT` is a CLI fallback for the project ID. It documents the macOS/Linux gcloud ADC file at `~/.config/gcloud/application_default_credentials.json`.
- The [CLI reference](https://www.agy.dev/docs/cli/reference/) describes `/logout` as purging authentication tokens from the secure keyring.
- Antigravity's [CLI settings documentation](https://www.agy.dev/docs/settings?tab=cli) identifies `~/.gemini/antigravity-cli/settings.json` as the preferences file. The documented settings are preferences; neither the docs nor this binary scan establish a file-backed OAuth credential mode.
- Gemini CLI's `GEMINI_FORCE_FILE_STORAGE` is not evidence that the derived Antigravity CLI supports the same setting. This agy build did not expose that string.

## Findings and owner-approved decision

1. **A file-backed OAuth switch is not established.** The temporary-HOME run used an account-less profile, and the inspected startup did not create an OAuth file. The docs describe a secure keyring. orch therefore does not claim that `HOME` alone isolates OAuth.
2. **Owner-approved ACC-02 wording:** Antigravity uses a separate `HOME`/`USERPROFILE` per profile. OAuth may still use the shared OS keyring. orch never reads, copies, or stores credentials.
3. **Owner-approved ACC-03 wording:** Antigravity is declared parallel on macOS and Linux, and single on Windows. The existing `Kept separate` check validates each login: if `.gemini/antigravity-cli/antigravity-oauth-token` is absent from the profile, the check fails. This is an existence check only; it does not inspect file contents. A Keychain-only macOS login therefore fails the isolation check with an explanation that only one Antigravity account works on that Mac.
4. ADC auth remains outside this change. The current contracts do not model `AGY_ADC_AUTH` or a profile-specific `GOOGLE_CLOUD_QUOTA_PROJECT`; orch does not set either variable or alter the login flow.

## Still to verify

- Complete real two-account sign-ins and concurrent runs on macOS and Linux, confirming profile-token existence without inspecting token contents.
- Confirm the supported gcloud ADC path and profile scoping on Windows and Linux before changing those OS declarations.
- Confirm inherited `GOOGLE_APPLICATION_CREDENTIALS` cannot redirect an agy profile to a different account; if it can, the launch environment needs a safe per-profile override.
- Have a user complete the real two-account sign-in check; this spike intentionally did not sign in.
