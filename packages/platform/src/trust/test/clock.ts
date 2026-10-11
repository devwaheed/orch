/** A clock the tests move by hand. */
export class FakeClock {
  constructor(private at: Date) {}
  now = (): Date => new Date(this.at.getTime());
  advance(ms: number): void {
    this.at = new Date(this.at.getTime() + ms);
  }
  set(iso: string): void {
    this.at = new Date(iso);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `finishedAt` helper: `daysAgo(9, now)` is 9 days before `now`. */
export function daysAgo(days: number, now: Date): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/** `finishedAt` helper: `daysAhead(1, now)` is 1 day after `now`. */
export function daysAhead(days: number, now: Date): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}
