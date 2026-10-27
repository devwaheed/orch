import { useEffect } from 'react';
import type { Account } from '@orchagents/contracts';
import { accountsStrings as S } from '../strings.js';

const FOOTER_BUTTON =
  'flex items-center gap-2 min-h-[38px] px-6 py-3 border border-btnline rounded-md bg-btn text-base text-text cursor-pointer';

interface RemoveAccountDialogProps {
  readonly account: Account | null;
  readonly agentName: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function RemoveAccountDialog({ account, agentName, onCancel, onConfirm }: RemoveAccountDialogProps) {
  useEffect(() => {
    if (!account) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [account, onCancel]);

  if (!account) return null;
  return (
    <div className="fixed inset-0 z-[9]">
      <button
        type="button"
        className="absolute inset-0 w-full h-full border-0 bg-overlay cursor-default"
        aria-label={S.remove.cancel}
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-account-title"
        className="absolute top-[70px] left-1/2 -translate-x-1/2 w-[min(680px,calc(100%-32px))] border border-btnline rounded-2xl bg-panel shadow-dialog overflow-hidden"
      >
        <div className="flex items-center gap-5 px-18px py-7 border-b border-line2">
          <h2 id="remove-account-title" className="m-0 flex-auto text-16px font-semibold">{S.remove.title(agentName, account.name)}</h2>
        </div>
        <div className="flex flex-col gap-5 p-18px">
          <p className="m-0 text-base text-muted">{S.remove.text(agentName, account.profileDir)}</p>
        </div>
        <div className="flex items-center gap-3 px-18px py-6 border-t border-line2 bg-panel2">
          <button type="button" className={FOOTER_BUTTON} onClick={onCancel}>{S.remove.cancel}</button>
          <button
            type="button"
            className={`${FOOTER_BUTTON} border-err-solid bg-err-solid font-semibold text-on-accent`}
            onClick={onConfirm}
          >
            {S.remove.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
