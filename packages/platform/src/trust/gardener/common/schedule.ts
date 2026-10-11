/**
 * The gardener's weekly schedule (TRU-04): Mondays 09:00 local time. Pure: the
 * caller passes the instant and the IANA time zone, so the DST rules are tested
 * without a real clock or the machine's zone. Uses only ECMAScript `Intl`, so it
 * runs in any environment.
 */

/** TRU-04: Monday. Matches `Date#getUTCDay()` (0 = Sunday). */
export const GARDENER_WEEKDAY = 1;
/** TRU-04: 09:00 local time. */
export const GARDENER_HOUR = 9;
export const GARDENER_MINUTE = 0;

const DAY_MS = 24 * 60 * 60 * 1000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) {
    return cached;
  }
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  formatters.set(timeZone, created);
  return created;
}

/** The wall-clock fields of `instant` in `timeZone`. */
export function wallClockAt(instant: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** The zone's offset from UTC at `instant`, in milliseconds (positive east of UTC). */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  // Intl has whole-second precision, so drop the milliseconds first.
  const whole = Math.floor(instant.getTime() / 1000) * 1000;
  const w = wallClockAt(new Date(whole), timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - whole;
}

/**
 * The instant at which the wall clock in `timeZone` reads `year-month-day hour:minute`.
 * Two refinement passes make it correct on either side of a DST change.
 */
export function zonedWallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = wallAsUtc - zoneOffsetMs(new Date(wallAsUtc), timeZone);
  guess = wallAsUtc - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/**
 * The first gardener run strictly after `now` (TRU-04): the next Monday 09:00
 * in `timeZone`. A run at exactly 09:00 on a Monday counts as already due, so
 * the following Monday is returned.
 */
export function nextGardenerRun(now: Date, timeZone: string): Date {
  const today = wallClockAt(now, timeZone);
  // Calendar arithmetic in UTC avoids the machine's own zone entirely.
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  const weekdayToday = new Date(todayUtc).getUTCDay();
  const daysUntilMonday = (GARDENER_WEEKDAY - weekdayToday + 7) % 7;

  const thisWeek = mondayAt(todayUtc + daysUntilMonday * DAY_MS, timeZone);
  if (thisWeek.getTime() > now.getTime()) {
    return thisWeek;
  }
  return mondayAt(todayUtc + (daysUntilMonday + 7) * DAY_MS, timeZone);
}

/** 09:00 on the calendar date held in `dayUtcMs` (a UTC midnight), in `timeZone`. */
function mondayAt(dayUtcMs: number, timeZone: string): Date {
  const date = new Date(dayUtcMs);
  return zonedWallTimeToInstant(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    GARDENER_HOUR,
    GARDENER_MINUTE,
    timeZone,
  );
}
