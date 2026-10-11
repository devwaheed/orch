---
# Number that sets the order. Unique. Dependencies must have smaller numbers.
id: "42"
title: Integration tests for the callback flow
# Specs that must be done first (see `advance` in .orch/specs.yaml)
depends_on: ["41"]
# Files this spec may change. Empty = it never runs alongside other specs.
scope:
  - test/auth/**
# Optional: claude | codex | gemini | opencode | agy | auto (default)
agent: auto
# How we know it's done. At least one line.
#   by: check  -> orch runs it; the agent can't edit it
#   by: audit  -> a different agent reads the work and answers met / not met
done_when:
  - by: check
    text: Unknown state returns 400 with error invalid_state
    check: { kind: command, run: "npm test -- test/auth/callback.test.ts" }
  - by: check
    text: All tests under test/auth pass three runs in a row
    check: { kind: command, run: "npm run flaky-check -- test/auth" }
  - by: audit
    text: Error codes match docs/api/errors.md
---

Everything below the front matter is given to the implementing agent as the goal.

Write integration tests for GET /auth/callback covering unknown state, reused
PKCE verifier, and a successful exchange. Use the fixtures in test/fixtures;
never call real providers.
