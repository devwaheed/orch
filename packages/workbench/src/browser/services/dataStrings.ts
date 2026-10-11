/**
 * User-facing strings for the data layer (services/, stores/).
 * Copy not given word for word in design/screens.md is written in the VOC
 * vocabulary and listed for owner review (lead notes, round 2).
 */

export const dataStrings = {
  coreUnavailable: {
    message: "orch can't reach its core process.",
    fix: 'Restart orch. If it keeps happening, report a bug.',
  },
  connectionLost: {
    message: 'The connection to orch was lost.',
    fix: 'Restart orch.',
  },
  replyUnreadable: (where: string) => ({
    message: `orch sent a reply it could not read (${where}).`,
    fix: 'Restart orch. If it keeps happening, report a bug.',
  }),
  statusBar: {
    runsRunning: (count: number) =>
      count === 0 ? 'No runs running' : `${count} ${count === 1 ? 'run' : 'runs'} running`,
    resetTimeUnknown: 'reset time unknown',
  },
} as const;
