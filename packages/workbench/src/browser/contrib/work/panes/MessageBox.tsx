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
import { cx } from '../components/cx.js';

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-2';

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
    <form className="flex items-center gap-3 px-5 py-4 border-t border-line2 bg-chrome" onSubmit={onSubmit}>
      <label htmlFor={inputId} className="absolute w-[1px] h-[1px] overflow-hidden [clip:rect(0_0_0_0)]">
        {workStrings.message.label(run.id)}
      </label>
      <input
        id={inputId}
        type="text"
        className={cx(
          'flex-auto min-w-0 px-5 py-9px rounded-md border border-line bg-bg text-text font-sans leading-normal text-sm',
          'disabled:text-disabled',
          FOCUS_RING,
        )}
        value={draft}
        disabled={!view.enabled}
        placeholder={view.placeholder}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        type="submit"
        aria-label={workStrings.message.sendAria}
        disabled={!canSend}
        className={cx(
          'flex items-center justify-center shrink-0 basis-[36px] w-[36px] h-[36px] border-0 rounded-md',
          view.enabled ? 'bg-accent-solid text-on-accent cursor-pointer' : 'bg-raised text-disabled cursor-default',
          FOCUS_RING,
        )}
      >
        <Icon name="send" size={15} weight={2} />
      </button>
    </form>
  );
}
