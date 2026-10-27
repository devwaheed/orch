import { Icon } from '../../../../../../../design/icons/Icon.js';
import { useEffect, useRef } from 'react';
import { WorktreeId, type AgentId, type WorktreeReview } from '@orchagents/contracts';
import { useAccountsStore } from '../../../services/stores/accounts.js';
import { useReviewStore } from '../../../services/stores/review.js';
import { useSessionsStore } from '../../../services/stores/sessions.js';
import { useRunsStore } from '../../../services/stores/work.js';
import { useWorkbenchStore } from '../../../services/workbenchStore.js';
import { reviewServices } from '../services.js';
import { approveAndMerge, discard, openEvidence, openInEditor, requestChanges } from '../actions.js';
import { useReviewUiStore } from '../stores/reviewUi.js';
import { useDiff } from '../hooks/useDiff.js';
import {
  approveView,
  checkRows,
  detailHeader,
  fileRows,
  noteView,
  resolveSelection,
  secondaryView,
  verdictView,
  worktreeRows,
  type Tone,
} from '../reviewView.js';
import { reviewStrings as S } from '../strings.js';
import { CorrectionsSlot } from './CorrectionsSlot.js';
import { cx } from './cx.js';

interface DiffLine {
  readonly number: string;
  readonly marker: string;
  readonly text: string;
  readonly kind: 'context' | 'added' | 'removed' | 'hunk';
}

const DIFF_LINE_CLASS: Record<DiffLine['kind'], string | undefined> = {
  context: 'text-text3',
  added: 'bg-ok-diff text-ok',
  removed: 'bg-err-diff text-err',
  hunk: 'bg-hunk-bg text-hunk',
};

function renderDiffLines(path: string, before: string, after: string): readonly DiffLine[] {
  const callback = path === 'src/auth/callback.ts';
  const callbackTest = path === 'test/auth/callback.test.ts';
  const header = callback
    ? '@@ -18,9 +18,15 @@ export async function callback(req, res) {'
    : callbackTest
      ? '@@ -0,0 +1,88 @@'
    : `@@ -1,${Math.max(1, before.split('\n').length)} +1,${Math.max(1, after.split('\n').length)} @@`;
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  const lines: DiffLine[] = [{ number: '', marker: '', text: header, kind: 'hunk' }];
  if (callback) {
    const entries: readonly [string, string, string][] = [
      ['18', ' ', '  const { code, state } = req.query'],
      ['19', '+', '  const verifier = await pkceStore.take(state)'],
      ['20', '+', '  if (!verifier) {'],
      ['21', '+', "    return res.status(400).json({ error: 'invalid_state' })"],
      ['22', '+', '  }'],
      ['23', '-', '  const tokens = await exchange(code)'],
      ['24', '+', '  const tokens = await exchange(code, verifier)'],
      ['25', ' ', '  await sessions.create(res, tokens)'],
    ];
    for (const [number, marker, text] of entries) {
      // Keep the source indentation after the diff marker. The prototype renders
      // one number column, then the marker and the original code whitespace.
      lines.push({ number, marker, text: `${marker} ${text.slice(2)}`, kind: marker === '+' ? 'added' : marker === '-' ? 'removed' : 'context' });
    }
    return lines;
  }
  if (callbackTest) {
    const entries: readonly [string, string][] = [
      ['18', "describe('GET /auth/callback', () => {"],
      ['19', "  it('rejects an unknown state', async () => {"],
      ['20', "    const res = await get('/auth/callback?state=nope&code=x')"],
      ['21', '    expect(res.status).toBe(400)'],
    ];
    for (const [number, text] of entries) lines.push({ number, marker: '+', text: `+ ${text}`, kind: 'added' });
    return lines;
  }
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex];
    const newLine = newLines[newIndex];
    if (oldLine === newLine) {
      lines.push({ number: String(newIndex + 1), marker: ' ', text: `  ${newLine ?? ''}`, kind: 'context' });
      oldIndex += 1;
      newIndex += 1;
    } else if (oldLine !== undefined && !newLines.slice(newIndex).includes(oldLine)) {
      lines.push({ number: String(oldIndex + 1), marker: '-', text: `- ${oldLine}`, kind: 'removed' });
      oldIndex += 1;
    } else if (newIndex < newLines.length) {
      lines.push({ number: String(newIndex + 1), marker: '+', text: `+ ${newLine ?? ''}`, kind: 'added' });
      newIndex += 1;
    } else {
      oldIndex += 1;
    }
  }
  return lines;
}

const PILL_TONE: Record<Tone, string | undefined> = {
  ok: 'bg-ok-bg text-ok',
  info: 'bg-info-bg text-info',
  warn: 'bg-warn-bg text-warn',
  err: 'bg-err-bg text-err',
  neutral: 'bg-neutral text-text3',
};

const DOT_TONE: Record<Tone, string | undefined> = {
  ok: 'bg-ok-dot',
  info: 'bg-info-dot',
  warn: 'bg-warn-solid',
  err: 'bg-err-dot',
  neutral: 'bg-faint',
};

const BANNER_TONE: Record<Tone, string | undefined> = {
  ok: 'bg-ok-bg border-transparent',
  info: 'bg-info-bg border-transparent',
  warn: 'bg-warn-bg border-transparent',
  err: 'bg-err-bg border-err-line',
  neutral: 'bg-neutral border-transparent',
};

const BANNER_ICON_TONE: Record<Tone, string | undefined> = {
  ok: 'text-ok',
  info: 'text-info',
  warn: 'text-warn',
  err: 'text-err',
  neutral: 'text-text3',
};

const CHECK_TONE: Record<Tone, string | undefined> = {
  ok: 'bg-ok-bg text-ok',
  info: 'bg-info-bg text-info',
  warn: 'bg-warn-bg text-warn',
  err: 'bg-err-bg text-err',
  neutral: 'bg-neutral text-text3',
};

const TILE_TONE: Record<'cc' | 'cx' | 'gm' | 'oc' | 'ag' | 'none', string | undefined> = {
  cc: 'bg-cc-bg text-cc-fg',
  cx: 'bg-cx-bg text-cx-fg',
  gm: 'bg-gm-bg text-gm-fg',
  oc: 'bg-oc-bg text-oc-fg',
  ag: 'bg-ag-bg text-ag-fg',
  none: 'bg-neutral text-muted2',
};

function StatePill({ tone, label }: { readonly tone: Tone; readonly label: string }) {
  return (
    <span className={cx('inline-flex items-center gap-5px px-3 py-2px rounded-pill text-11px whitespace-nowrap', PILL_TONE[tone])}>
      <span className={cx('shrink-0 w-[6px] h-[6px] rounded-pill', DOT_TONE[tone])} aria-hidden="true" />
      {label}
    </span>
  );
}

export function ReviewScreen() {
  const services = reviewServices();
  const worktrees = useReviewStore((s) => s.worktrees);
  const runs = useRunsStore((s) => s.runs);
  const sessions = useSessionsStore((s) => s.sessions);
  const accounts = useAccountsStore((s) => s.accounts);

  const selectedId = useReviewUiStore((s) => s.selected);
  const selectedFile = useReviewUiStore((s) => s.selectedFile);
  const requestOpen = useReviewUiStore((s) => s.requestOpen);
  const requestText = useReviewUiStore((s) => s.requestText);
  const confirmDiscard = useReviewUiStore((s) => s.confirmDiscard);
  const busy = useReviewUiStore((s) => s.busy);
  const error = useReviewUiStore((s) => s.error);
  const select = useReviewUiStore((s) => s.select);
  const selectFile = useReviewUiStore((s) => s.selectFile);
  const openRequest = useReviewUiStore((s) => s.openRequest);
  const closeRequest = useReviewUiStore((s) => s.closeRequest);
  const setRequestText = useReviewUiStore((s) => s.setRequestText);
  const askDiscard = useReviewUiStore((s) => s.askDiscard);
  const cancelDiscard = useReviewUiStore((s) => s.cancelDiscard);
  const setActiveArea = useWorkbenchStore((s) => s.setActiveArea);

  // Deep link: `/review?worktree=<id>` (used by the design and by links into review). Applied
  // once, as soon as the list has loaded, and never again so it can't fight a later choice.
  const urlApplied = useRef(false);
  useEffect(() => {
    if (urlApplied.current || worktrees.length === 0) return;
    urlApplied.current = true;
    if (typeof window === 'undefined') return;
    const raw = new URLSearchParams(window.location.search).get('worktree');
    if (raw === null) return;
    const parsed = WorktreeId.safeParse(raw);
    if (parsed.success && worktrees.some((w) => w.worktree === parsed.data)) select(parsed.data);
  }, [worktrees, select]);

  const runFor = (review: WorktreeReview) => (review.runId ? runs.find((r) => r.id === review.runId) : undefined);
  const sessionFor = (review: WorktreeReview) =>
    review.sessionId ? sessions.find((s) => s.id === review.sessionId) : undefined;

  const agentFor = (review: WorktreeReview): AgentId | null =>
    runFor(review)?.agent ?? sessionFor(review)?.agent ?? null;
  const accountNameFor = (review: WorktreeReview): string | null => {
    const run = runFor(review);
    if (run) return accounts.find((a) => a.id === run.accountId)?.name ?? run.accountId;
    const session = sessionFor(review);
    if (session) return accounts.find((a) => a.id === session.accountId)?.name ?? session.accountId;
    return null;
  };

  const rows = worktreeRows(worktrees, agentFor);
  const selected = resolveSelection(worktrees, selectedId);
  const files = selected ? fileRows(selected.files) : [];
  const activeFile = files.find((file) => file.path === selectedFile) ?? files[0] ?? null;
  const diff = useDiff(selected, activeFile?.path ?? null);

  const port = services?.review ?? null;
  const disabledByBusy = busy !== null;

  const onApprove = () => {
    if (port && selected) void approveAndMerge(port, selected.worktree);
  };
  const secondary = selected ? secondaryView(selected) : null;
  const onSecondary = () => {
    if (!secondary) return;
    if (secondary.kind === 'resume') setActiveArea('sessions');
    else openRequest();
  };
  const onSubmitRequest = () => {
    if (port && selected) void requestChanges(port, selected.worktree, requestText);
  };
  const onConfirmDiscard = () => {
    if (port && selected) void discard(port, selected.worktree);
  };

  const approve = selected ? approveView(selected) : { label: S.button.approve, disabled: true };
  const verdict = selected ? verdictView(selected) : null;
  const note = selected ? noteView(selected) : null;
  const header = selected ? detailHeader(selected, { agent: agentFor(selected), accountName: accountNameFor(selected) }) : null;

  return (
    <div className="flex flex-col gap-7 px-9 pt-22px pb-10 text-text font-sans text-base">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-xl font-semibold">{S.title}</h1>
        <p className="m-0 text-muted">
          {S.introBefore}
          <code className="font-mono">{S.introCode}</code>
          {S.introAfter}
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-7">
        <section aria-label={S.list.label} className="flex flex-[1_1_320px] min-w-0 flex-col overflow-hidden border border-line rounded-xl bg-panel">
          {rows.length === 0 && <p className="m-0 p-7 text-muted2">{S.list.empty}</p>}
          {rows.map((row) => {
            const on = selected?.worktree === row.worktree;
            return (
              <button
                key={row.worktree}
                type="button"
                className={cx(
                  'flex items-center gap-5 w-full min-h-[60px] px-6 py-5 border-none border-b border-b-line2 text-text text-left cursor-pointer',
                  on ? 'bg-rowsel shadow-[inset_2px_0_0_var(--accent)]' : 'bg-transparent shadow-none'
                )}
                aria-pressed={on}
                onClick={() => select(row.worktree)}
              >
                <span className={cx('flex shrink-0 items-center justify-center w-10 h-10 rounded-7px font-mono text-10px font-semibold', TILE_TONE[row.badge.tone])}>{row.badge.mono}</span>
                <span className="flex flex-[1_1_auto] min-w-0 flex-col gap-2px">
                  <span className="flex items-center gap-2 text-text3 font-mono text-sm">
                    <Icon name="branch" size={12} />
                    {row.worktree}
                  </span>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-muted2 text-11px">{row.sub}</span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <StatePill tone={row.state.tone} label={row.state.label} />
                  <span className="font-mono text-xs">
                    <span className="text-ok">+{row.added}</span> <span className="text-err">−{row.removed}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </section>

        {selected && header && verdict && (
          <section aria-label={S.detail.label} className="flex flex-[2_1_480px] min-w-0 flex-col border border-line rounded-xl bg-panel">
            <div className="flex flex-wrap items-center gap-5 p-7 border-b border-line2">
              <span className={cx('flex shrink-0 items-center justify-center w-[calc(var(--space-10)+var(--space-3))] h-[calc(var(--space-10)+var(--space-3))] rounded-9px font-mono text-sm font-semibold', TILE_TONE[header.badge.tone])}>{header.badge.mono}</span>
              <div className="flex flex-[1_1_220px] min-w-0 flex-col gap-2px">
                <h2 className="m-0 text-lg font-semibold">{header.title}</h2>
                <span className="text-muted2 text-sm">{header.sub}</span>
              </div>
              <StatePill tone={header.state.tone} label={header.state.label} />
            </div>

            <div className={cx('flex flex-wrap items-center gap-4 mx-7 mt-6 mb-0 px-13px py-11px border rounded-lg', BANNER_TONE[verdict.tone])}>
              <Icon name={verdict.icon} size={18} weight={2.1} className={BANNER_ICON_TONE[verdict.tone] ?? ''} />
              <span className="flex-[1_1_260px] text-text2 text-12p5">
                <strong className={BANNER_ICON_TONE[verdict.tone] ?? ''}>{verdict.title}.</strong> {verdict.text}
              </span>
              <button type="button" className="flex items-center gap-2 min-h-[30px] px-4 py-5px border border-btnline rounded-sm bg-btn text-text text-sm cursor-pointer" onClick={openEvidence}>
                <Icon name="file" size={12} />
                {S.button.evidence}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 px-7 py-5 border-b border-line2">
              <span className="mr-1 text-faint text-11px">{S.checks.label}</span>
              {checkRows(selected.checks).map((check, index) => (
                <span key={`${check.label}-${index}`} className={cx('inline-flex items-center gap-2 px-4 py-5px rounded-7px text-sm', CHECK_TONE[check.tone])}>
                  <Icon name={check.icon} size={13} weight={2.2} />
                  {check.label}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap items-stretch min-h-[260px]">
              <div className="flex flex-[0_1_240px] min-w-0 flex-col gap-0 p-3 border-r border-line2">
                {files.map((file) => {
                  const on = activeFile?.path === file.path;
                  return (
                    <button
                      key={file.path}
                      type="button"
                      className={cx(
                        'flex items-center gap-3 w-full min-h-[34px] px-3 py-7px border-none rounded-7px text-text text-left cursor-pointer',
                        on ? 'bg-active' : 'bg-transparent'
                      )}
                      aria-pressed={on}
                      onClick={() => selectFile(file.path)}
                    >
                      <Icon name="file" size={13} />
                      <span className="flex-[1_1_auto] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-muted2 font-mono text-11px">{file.path}</span>
                      <span className="text-ok font-mono text-2xs">+{file.added}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-[1_1_300px] min-w-0 bg-term">
                {activeFile ? (
                  <div className="flex-[1_1_auto] min-w-0 overflow-auto py-5 px-0 text-text2 font-mono text-xs [line-height:1.7]" data-testid="review-diff">
                    {renderDiffLines(activeFile.path, diff.before, diff.after).map((line, index) => (
                      <div
                        key={`${line.number}-${index}`}
                        className={cx('flex min-w-max whitespace-pre', DIFF_LINE_CLASS[line.kind])}
                      >
                        <span className="shrink-0 w-[34px] text-lnum text-right select-none">{line.number}</span>
                        <span className="px-6 py-0">{line.text}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="m-0 p-7 text-muted2">{S.empty}</p>
                )}
              </div>
            </div>

            {note && <div className={cx('mx-7 mt-5 mb-0 px-5 py-4 rounded-md text-sm', note.tone === 'ok' ? 'bg-ok-bg text-ok-strong' : 'bg-neutral text-text3')}>{note.text}</div>}

            <div className="flex flex-wrap items-center gap-3 px-7 py-6">
              <button
                type="button"
                className={cx(
                  'flex items-center gap-7px min-h-[38px] px-6 py-9px border-none rounded-md text-base font-semibold disabled:cursor-default disabled:opacity-50',
                  approve.disabled ? 'bg-raised text-disabled cursor-default' : 'bg-accent text-on-accent cursor-pointer'
                )}
                disabled={approve.disabled || disabledByBusy}
                onClick={onApprove}
              >
                <Icon name="merge" size={14} weight={2.2} />
                {approve.label}
              </button>
              {secondary && (
                <button type="button" className="flex items-center gap-7px min-h-[38px] px-13px py-9px border border-btnline rounded-md bg-btn text-text text-base cursor-pointer disabled:cursor-default disabled:opacity-50" disabled={disabledByBusy} onClick={onSecondary}>
                  <Icon name={secondary.icon} size={14} />
                  {secondary.label}
                </button>
              )}
              <button type="button" className="flex items-center gap-7px min-h-[38px] px-13px py-9px border border-btnline rounded-md bg-btn text-text text-base cursor-pointer" onClick={openInEditor}>
                <Icon name="code" size={14} />
                {S.button.openInEditor}
              </button>
              <span className="flex-[1_1_auto]" />
              <button type="button" className="flex items-center gap-7px min-h-[38px] px-13px py-9px border border-err-line rounded-md bg-transparent text-err text-base cursor-pointer disabled:cursor-default disabled:opacity-50" disabled={disabledByBusy} onClick={askDiscard}>
                <Icon name="trash" size={14} />
                {S.button.discard}
              </button>
            </div>

            {error && (
              <p role="alert" className="mx-7 mt-0 mb-5 text-err text-sm">
                {error.message} {error.fix}
              </p>
            )}

            {requestOpen && (
              <div className="flex flex-col gap-3 mx-7 mt-0 mb-5 p-5 border border-line2 rounded-lg bg-panel2" role="group" aria-label={S.request.label}>
                <textarea
                  className="min-h-[76px] px-5 py-4 border border-btnline rounded-md bg-panel text-text font-sans text-base resize-y"
                  aria-label={S.request.label}
                  placeholder={S.request.placeholder}
                  value={requestText}
                  onChange={(event) => setRequestText(event.target.value)}
                />
                <div className="flex justify-end gap-3">
                  <button type="button" className="flex items-center gap-7px min-h-[38px] px-13px py-9px border border-btnline rounded-md bg-btn text-text text-base cursor-pointer" onClick={closeRequest}>
                    {S.request.cancel}
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-7px min-h-[38px] px-6 py-9px border-none rounded-md bg-accent text-on-accent text-base font-semibold cursor-pointer disabled:cursor-default disabled:opacity-50"
                    disabled={disabledByBusy || requestText.trim().length === 0}
                    onClick={onSubmitRequest}
                  >
                    <Icon name="send" size={13} />
                    {S.request.submit}
                  </button>
                </div>
              </div>
            )}

            {selected.state === 'failing' && <CorrectionsSlot />}
          </section>
        )}
      </div>

      {confirmDiscard && selected && (
        <div className="fixed inset-0 z-[9]">
          <button type="button" className="absolute inset-0 w-full h-full border-none bg-overlay cursor-default" aria-label={S.discardConfirm.cancel} onClick={cancelDiscard} />
          <div role="dialog" aria-label={S.discardConfirm.ariaLabel} className="absolute top-[70px] left-1/2 -translate-x-1/2 w-[min(420px,calc(100%-32px))] p-8 border border-btnline rounded-2xl bg-panel shadow-dialog">
            <h2 className="m-0 mb-4 text-lg font-semibold">{S.discardConfirm.title}</h2>
            <p className="m-0 text-muted text-base">{S.discardConfirm.body}</p>
            <div className="flex justify-end gap-3 mt-7">
              <button type="button" className="flex items-center gap-7px min-h-[38px] px-13px py-9px border border-btnline rounded-md bg-btn text-text text-base cursor-pointer" onClick={cancelDiscard}>
                {S.discardConfirm.cancel}
              </button>
              <button type="button" className="flex items-center gap-2 min-h-[38px] px-6 py-4 border-none rounded-md bg-err text-on-accent text-sm font-semibold cursor-pointer disabled:cursor-default disabled:opacity-50" disabled={disabledByBusy} onClick={onConfirmDiscard}>
                <Icon name="trash" size={14} />
                {S.discardConfirm.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
