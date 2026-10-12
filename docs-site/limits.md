# Limits

orch learns usage from agent output and errors. It does not call provider APIs or read provider websites. Some agents report usage windows; otherwise orch shows usage as unknown until it has seen a limit and learned the number of requests at that limit. Usage windows older than six hours are marked with their age and treated as zero usage for routing.

When an account hits a limit during a run, orch pauses the run and keeps its worktree and session. The job's **When an account hits its limit** policy then applies: **Switch account**, **Switch agent**, or **Ask me**. With auto-resume enabled, orch resumes at the reset time plus a random delay of 0–120 seconds.

You can select **Resume now on [agent] · [account]** to continue the exact session on another account. **More resume options** opens the session in Sessions, where you can continue it, hand it off, or fork it.

<!-- Source: LOCKED QTA-01, QTA-02, QTA-03, QTA-04, QTA-05, JOB-08; design/screens.md: Work, Capacity, Sessions -->
