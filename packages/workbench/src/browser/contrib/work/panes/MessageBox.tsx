/**
 * Message to a running agent (JOB-07: it is delivered as the agent's next turn).
 * Enabled only while the run is Running; otherwise the placeholder says why.
 */
import { useId, useState, type FormEvent } from 'react';
import type { Run } from '@orchagents/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import type { RunCommands } from '../hooks/useRunCommands.js';
import { messageBoxView } from '../model/paneModel.js';
import { workStrings } from '../strings.js';
import styles from './panes.module.css';

export function MessageBox({
  run,
  agentName,
  commands,
}: {
  readonly run: Run;
  readonly agentName: string;
  readonly commands: RunCommands;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState('');
  const view = messageBoxView(run.status, agentName, run.id);
  const canSend = view.enabled && draft.trim().length > 0;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSend) return;
    void commands.send(draft).then((sent) => {
      if (sent) setDraft('');
    });
  };

  return (
    <form className={styles.messageBox} onSubmit={onSubmit}>
      <label htmlFor={inputId} className={styles.visuallyHidden}>
        {workStrings.message.label(run.id)}
      </label>
      <input
        id={inputId}
        type="text"
        className={styles.messageInput}
        value={draft}
        disabled={!view.enabled}
        placeholder={view.placeholder}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        type="submit"
        aria-label={workStrings.message.sendAria}
        disabled={!canSend}
        className={`${styles.sendButton} ${view.enabled ? styles.sendOn : styles.sendOff}`}
      >
        <Icon name="send" size={15} weight={2} />
      </button>
    </form>
  );
}
