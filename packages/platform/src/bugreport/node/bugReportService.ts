import { ok, err } from '@orchagents/base';
import type {
  BugReportSaveRequest,
  BugReportSaveResult,
  DoctorReport,
  IBugReportService,
  Result,
} from '@orchagents/contracts';
import {
  createBugReportBundle,
  previewBugReportEntries,
} from './bundle.js';

export interface BugReportServiceOptions {
  /** The home folder, defaults to os.homedir() */
  readonly home?: string;
  /** Function to run doctor report */
  readonly runDoctor: () => Promise<Result<DoctorReport>>;
  /** Test seam: overrides the clock */
  readonly now?: () => Date;
}

export class BugReportService implements IBugReportService {
  constructor(private readonly options: BugReportServiceOptions) {}

  async files(): Promise<Result<string[]>> {
    const list = previewBugReportEntries({
      home: this.options.home,
      now: this.options.now,
    });
    return ok(list);
  }

  async save(req: BugReportSaveRequest): Promise<Result<BugReportSaveResult>> {
    const bundleRes = await createBugReportBundle({
      home: this.options.home,
      runDoctor: this.options.runDoctor,
      outputDir: req.outDir,
      repoPath: req.repoPath,
      now: this.options.now,
    });

    if (!bundleRes.ok) {
      return err(bundleRes.error);
    }

    return ok({ path: bundleRes.value });
  }
}
