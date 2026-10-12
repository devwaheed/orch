import { z } from 'zod';

export const BugReportSaveRequest = z.object({
  outDir: z.string().optional(),
  repoPath: z.string().optional(),
});
export type BugReportSaveRequest = z.infer<typeof BugReportSaveRequest>;

export const BugReportSaveResult = z.object({
  path: z.string(),
});
export type BugReportSaveResult = z.infer<typeof BugReportSaveResult>;
