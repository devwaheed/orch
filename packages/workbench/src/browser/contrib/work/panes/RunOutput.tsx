/** The agent's output: one row per RunLine, in seq order, styled by line kind. */
import { useMemo } from 'react';
import type { RunId } from '@orchagents/contracts';
import { selectRunLines, useRunsStore } from '../../../services/stores/work.js';
import { formatLineTime } from '../model/statusModel.js';
import { lineView, type LineTone } from '../model/paneModel.js';
import { workStrings } from '../strings.js';
import { cx } from '../components/cx.js';

const TONE_CLASS: Record<LineTone, string> = {
  meta: 'text-faint2',
  you: 'text-focus',
  msg: 'text-text2',
  tool: 'text-info-tool',
  add: 'text-ok bg-ok-diff px-2',
  del: 'text-err bg-err-diff px-2',
  ok: 'text-ok',
  err: 'text-err',
  limit: 'text-warn',
  spawn: 'text-spawn',
};

export function RunOutput({ runId, working }: { readonly runId: RunId; readonly working: boolean }) {
  const lines = useRunsStore(selectRunLines(runId));
  const ordered = useMemo(() => [...lines].sort((a, b) => a.seq - b.seq), [lines]);

  return (
    <div className="flex flex-auto flex-col gap-2px p-6 bg-term font-mono text-sm leading-code min-h-[260px] overflow-auto">
      {ordered.map((line) => {
        const view = lineView(line.kind);
        return (
          <div key={line.seq} className="flex items-start gap-5">
            <span className="shrink-0 basis-[56px] text-lnum">{line.kind === 'diff_add' || line.kind === 'diff_del' ? '' : formatLineTime(line.at)}</span>
            <span className={cx('shrink-0 basis-[14px]', TONE_CLASS[view.tone], view.tone === 'ok' && 'font-sans')}>{view.glyph}</span>
            <span className={cx('flex-auto min-w-0 whitespace-pre-wrap break-words rounded-3px', TONE_CLASS[view.tone])}>{line.text}</span>
          </div>
        );
      })}
      {working ? (
        <div className="flex items-center gap-5 mt-1">
          <span className="w-[7px] h-[14px] bg-focus" aria-hidden="true" />
          <span className="text-faint">{workStrings.panes.working}</span>
        </div>
      ) : null}
    </div>
  );
}
