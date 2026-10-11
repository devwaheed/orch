/**
 * The numbers the trust rules name. Kept apart from the logic that uses them so
 * the strings file can quote them without importing the logic (no cycles).
 */

/** TRU-01: the window the first-try rate is measured over. */
export const TRUST_WINDOW_DAYS = 30;

/** TRU-01: below this many runs in the window an agent shows "Not enough runs yet". */
export const MIN_RUNS = 20;

/** TRU-02: this many points below the level's threshold shows "Below threshold". */
export const BELOW_THRESHOLD_MARGIN = 10;

/** TRU-02: every agent starts here. */
export const START_LEVEL = 1 as const;
