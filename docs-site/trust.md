# Trust

The Trust view shows each agent's first-try verified rate and correction history. First-try verified means verified on attempt one with no request for changes. The rate uses the last 30 days. An agent needs at least 20 runs to qualify for promotion; otherwise the view says **Not enough runs yet**.

New agents start at level 1. Level 2 requires a 70% first-try verified rate; level 3 requires 85%. Promotion is manual. If an agent falls 10 points below its current level's threshold, the view says **Below threshold**; orch does not demote it automatically.

Level 3 can auto-merge only single-mode jobs when every changed file is in the allowed low-risk file patterns and the diff is under 200 changed lines. Spec queue jobs are never auto-merged.

**Gardener** is on by default and runs Mondays at 09:00 local time. Its proposals arrive in Review like other jobs.

<!-- Source: LOCKED TRU-01, TRU-02, TRU-03, TRU-04; design/screens.md: Trust -->
