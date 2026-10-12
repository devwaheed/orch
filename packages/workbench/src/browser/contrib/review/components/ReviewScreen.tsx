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
import styles from './ReviewScreen.module.css';
import { cx } from './cx.js';

interface DiffLine {
  readonly number: string;
  readonly marker: string;
  readonly text: string;
  readonly kind: 'context' | 'added' | 'removed' | 'hunk';
}

const DIFF_LINE_CLASS: Record<DiffLine['kind'], string | undefined> = {
  context: styles.diffLineContext,
  added: styles.diffLineAdded,
  removed: styles.diffLineRemoved,
  hunk: styles.diffLineHunk,
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
  ok: styles.pillOk,
  info: styles.pillInfo,
  warn: styles.pillWarn,
  err: styles.pillErr,
  neutral: styles.pillNeutral,
};

const DOT_TONE: Record<Tone, string | undefined> = {
  ok: styles.dotOk,
  info: styles.dotInfo,
  warn: styles.dotWarn,
  err: styles.dotErr,
  neutral: styles.dotNeutral,
};

const BANNER_TONE: Record<Tone, string | undefined> = {
  ok: styles.bannerOk,
  info: styles.bannerInfo,
  warn: styles.bannerWarn,
  err: styles.bannerErr,
  neutral: styles.bannerNeutral,
};

const BANNER_ICON_TONE: Record<Tone, string | undefined> = {
  ok: styles.bannerIconOk,
  info: styles.bannerIconInfo,
  warn: styles.bannerIconWarn,
  err: styles.bannerIconErr,
  neutral: styles.bannerIconNeutral,
};

const CHECK_TONE: Record<Tone, string | undefined> = {
  ok: styles.checkOk,
  info: styles.checkInfo,
  warn: styles.checkWarn,
  err: styles.checkErr,
  neutral: styles.checkNeutral,
};

const TILE_TONE: Record<'cc' | 'cx' | 'gm' | 'oc' | 'ag' | 'none', string | undefined> = {
  cc: styles.tileCc,
  cx: styles.tileCx,
  gm: styles.tileGm,
  oc: styles.tileOc,
  ag: styles.tileAgy,
  none: styles.tileNone,
};

function StatePill({ tone, label }: { readonly tone: Tone; readonly label: string }) {
  return (
    <span className={cx(styles.pill, PILL_TONE[tone])}>
      <span className={cx(styles.dot, DOT_TONE[tone])} aria-hidden="true" />
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
    <div className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title}>{S.title}</h1>
        <p className={styles.intro}>
          {S.introBefore}
          <code className={styles.introCode}>{S.introCode}</code>
          {S.introAfter}
        </p>
      </div>

      <div className={styles.body}>
        <section aria-label={S.list.label} className={styles.list}>
          {rows.length === 0 && <p className={styles.listEmpty}>{S.list.empty}</p>}
          {rows.map((row) => {
            const on = selected?.worktree === row.worktree;
            return (
              <button
                key={row.worktree}
                type="button"
                className={cx(styles.row, on && styles.rowSelected)}
                aria-pressed={on}
                onClick={() => select(row.worktree)}
              >
                <span className={cx(styles.agentTile, TILE_TONE[row.badge.tone])}>{row.badge.mono}</span>
                <span className={styles.rowText}>
                  <span className={styles.rowId}>
                    <Icon name="branch" size={12} />
                    {row.worktree}
                  </span>
                  <span className={styles.rowSub}>{row.sub}</span>
                </span>
                <span className={styles.rowRight}>
                  <StatePill tone={row.state.tone} label={row.state.label} />
                  <span className={styles.rowDiff}>
                    <span className={styles.added}>+{row.added}</span> <span className={styles.removed}>−{row.removed}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </section>

        {selected && header && verdict && (
          <section aria-label={S.detail.label} className={styles.detail}>
            <div className={styles.detailHead}>
              <span className={cx(styles.agentTileLarge, TILE_TONE[header.badge.tone])}>{header.badge.mono}</span>
              <div className={styles.detailTitleBlock}>
                <h2 className={styles.detailTitle}>{header.title}</h2>
                <span className={styles.detailSub}>{header.sub}</span>
              </div>
              <StatePill tone={header.state.tone} label={header.state.label} />
            </div>

            <div className={cx(styles.banner, BANNER_TONE[verdict.tone])}>
              <Icon name={verdict.icon} size={18} weight={2.1} className={BANNER_ICON_TONE[verdict.tone] ?? ''} />
              <span className={styles.bannerText}>
                <strong className={BANNER_ICON_TONE[verdict.tone] ?? ''}>{verdict.title}.</strong> {verdict.text}
              </span>
              <button type="button" className={styles.ghost} onClick={openEvidence}>
                <Icon name="file" size={12} />
                {S.button.evidence}
              </button>
            </div>

            <div className={styles.checks}>
              <span className={styles.checksLabel}>{S.checks.label}</span>
              {checkRows(selected.checks).map((check, index) => (
                <span key={`${check.label}-${index}`} className={cx(styles.check, CHECK_TONE[check.tone])}>
                  <Icon name={check.icon} size={13} weight={2.2} />
                  {check.label}
                </span>
              ))}
            </div>

            <div className={styles.diffArea}>
              <div className={styles.files}>
                {files.map((file) => {
                  const on = activeFile?.path === file.path;
                  return (
                    <button
                      key={file.path}
                      type="button"
                      className={cx(styles.file, on && styles.fileSelected)}
                      aria-pressed={on}
                      onClick={() => selectFile(file.path)}
                    >
                      <Icon name="file" size={13} />
                      <span className={styles.fileName}>{file.path}</span>
                      <span className={styles.added}>+{file.added}</span>
                    </button>
                  );
                })}
              </div>
              <div className={styles.diffPane}>
                {activeFile ? (
                  <div className={styles.plainDiff} data-testid="review-diff">
                    {renderDiffLines(activeFile.path, diff.before, diff.after).map((line, index) => (
                      <div
                        key={`${line.number}-${index}`}
                        className={cx(styles.diffLine, DIFF_LINE_CLASS[line.kind])}
                      >
                        <span className={styles.diffNumber}>{line.number}</span>
                        <span className={styles.diffText}>{line.text}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={styles.diffEmpty}>{S.empty}</p>
                )}
              </div>
            </div>

            {note && <div className={cx(styles.note, note.tone === 'ok' ? styles.noteOk : styles.noteNeutral)}>{note.text}</div>}

            <div className={styles.actions}>
              <button
                type="button"
                className={cx(styles.approve, approve.disabled && styles.approveOff)}
                disabled={approve.disabled || disabledByBusy}
                onClick={onApprove}
              >
                <Icon name="merge" size={14} weight={2.2} />
                {approve.label}
              </button>
              {secondary && (
                <button type="button" className={styles.secondary} disabled={disabledByBusy} onClick={onSecondary}>
                  <Icon name={secondary.icon} size={14} />
                  {secondary.label}
                </button>
              )}
              <button type="button" className={styles.secondary} onClick={openInEditor}>
                <Icon name="code" size={14} />
                {S.button.openInEditor}
              </button>
              <span className={styles.spacer} />
              <button type="button" className={styles.discard} disabled={disabledByBusy} onClick={askDiscard}>
                <Icon name="trash" size={14} />
                {S.button.discard}
              </button>
            </div>

            {error && (
              <p role="alert" className={styles.error}>
                {error.message} {error.fix}
              </p>
            )}

            {requestOpen && (
              <div className={styles.composer} role="group" aria-label={S.request.label}>
                <textarea
                  className={styles.textarea}
                  aria-label={S.request.label}
                  placeholder={S.request.placeholder}
                  value={requestText}
                  onChange={(event) => setRequestText(event.target.value)}
                />
                <div className={styles.composerActions}>
                  <button type="button" className={styles.secondary} onClick={closeRequest}>
                    {S.request.cancel}
                  </button>
                  <button
                    type="button"
                    className={styles.approve}
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
        <div className={styles.overlay}>
          <button type="button" className={styles.scrim} aria-label={S.discardConfirm.cancel} onClick={cancelDiscard} />
          <div role="dialog" aria-label={S.discardConfirm.ariaLabel} className={styles.dialog}>
            <h2 className={styles.dialogTitle}>{S.discardConfirm.title}</h2>
            <p className={styles.dialogText}>{S.discardConfirm.body}</p>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.secondary} onClick={cancelDiscard}>
                {S.discardConfirm.cancel}
              </button>
              <button type="button" className={styles.discardFill} disabled={disabledByBusy} onClick={onConfirmDiscard}>
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
