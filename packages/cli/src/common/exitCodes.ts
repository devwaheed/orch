export const ExitCode = {
  Success: 0,
  ProblemFound: 1,
  InvalidUsage: 2,
  EngineUnavailable: 3,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
