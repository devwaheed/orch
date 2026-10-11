# ADR 0004: Share each agent's own skills folder; no skills library

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

Users install skills per agent (for example SaaS factory) and some in the repo (for example BMAD). Per-account profile folders hide personal skills from extra accounts.

## Decision

No skills library. Repo skills need nothing. For personal skills, orch links each agent's normal skills folder into every account profile of that agent (symlink on macOS/Linux, directory junction on Windows), controlled by `share_skills` in `accounts.yaml`.

## Consequences

One source of truth per agent and nothing to sync. Skill paths for some agents must be confirmed in the spike.
