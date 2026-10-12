import { Icon } from '../../../../../../../design/icons/Icon.js';
import { Suspense, lazy, useEffect, useRef } from 'react';
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
  diffTotals,
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

// Monaco is large; load the diff (and its worker) only when a file is shown, so the rest of the
// workbench doesn't pay for it (ARC-05 allows Monaco; this keeps it off the start-up path).
const MonacoDiff = lazy(() => import('./MonacoDiff.js').then((mod) => ({ default: mod.MonacoDiff })));

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
  const totals = selected ? diffTotals(selected.files) : { added: 0, removed: 0 };
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
                {files.length > 0 && (
                  <div className={styles.fileTotals}>
                    <span className={styles.added}>+{totals.added}</span> <span className={styles.removed}>−{totals.removed}</span>
                  </div>
                )}
              </div>
              <div className={styles.diffPane}>
                {activeFile ? (
                  <Suspense fallback={null}>
                    <MonacoDiff before={diff.before} after={diff.after} />
                  </Suspense>
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
