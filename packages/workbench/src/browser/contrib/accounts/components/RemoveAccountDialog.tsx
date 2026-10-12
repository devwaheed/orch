import { useEffect } from 'react';
import type { Account } from '@orchagents/contracts';
import { accountsStrings as S } from '../strings.js';
import styles from './AccountsScreen.module.css';

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
    <div className={styles.overlay}>
      <button type="button" className={styles.scrim} aria-label={S.remove.cancel} onClick={onCancel} />
      <div role="dialog" aria-modal="true" aria-labelledby="remove-account-title" className={styles.dialog}>
        <div className={styles.dialogHead}>
          <h2 id="remove-account-title" className={styles.dialogTitle}>{S.remove.title(agentName, account.name)}</h2>
        </div>
        <div className={styles.dialogBody}>
          <p className={styles.dialogText}>{S.remove.text(agentName, account.profileDir)}</p>
        </div>
        <div className={styles.dialogFoot}>
          <button type="button" className={styles.button} onClick={onCancel}>{S.remove.cancel}</button>
          <button type="button" className={`${styles.button} ${styles.dangerButton}`} onClick={onConfirm}>
            {S.remove.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
