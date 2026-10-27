import { useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { CoreServices } from '../../../services/channelSchemas.js';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { type ConfigLineTone, configLineTone, markErrors, numberedLines } from '../configFile.js';
import { saveConfig } from '../actions.js';
import { accountsStrings as S } from '../strings.js';
import { useAccountsUiStore } from '../stores/accountsUi.js';
import { useConfigErrorsStore } from '../../../services/stores/config.js';

const TONE_CLASS: Record<ConfigLineTone, string> = {
  comment: 'text-faint',
  key: 'text-info-tool',
  text: 'text-text2',
};

export function ConfigFileView({ services }: { readonly services: CoreServices | null }) {
  const draft = useAccountsUiStore((s) => s.configDraft);
  const dirty = useAccountsUiStore((s) => s.configDirty);
  const errors = useConfigErrorsStore((s) => s.errors);
  const setDraft = useAccountsUiStore((s) => s.setDraft);
  const gutterRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  const lines = useMemo(() => numberedLines(draft), [draft]);
  const marks = useMemo(() => markErrors(draft, errors), [draft, errors]);
  const messages = [
    ...[...marks.byLine.values()].flat(),
    ...marks.fileLevel,
  ];

  return (
    <section aria-label={S.config.fileName} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex items-center gap-2 font-mono text-12p5">
          <Icon name="file" size={13} />
          {S.config.fileName}
        </span>
        <span className="flex-[1_1_260px] text-sm text-muted2">{S.config.hint}</span>
        <button
          type="button"
          className="flex items-center gap-2 min-h-[32px] px-11px py-2 border border-btnline rounded-7px bg-btn text-sm text-text cursor-pointer"
        >
          <Icon name="code" size={12} />
          {S.config.openEditor}
        </button>
      </div>
      <div
        className="flex bg-term border border-line rounded-xl overflow-hidden font-mono text-base leading-(--editor-leading)"
        style={{ '--editor-leading': '1.75' } as CSSProperties}
      >
        <div
          ref={gutterRef}
          className="flex-none w-[34px] pt-6 pb-6 pl-7 text-lnum overflow-hidden select-none whitespace-pre"
          aria-hidden="true"
        >
          {lines.map((line) => (
            <div key={line.n} className={marks.byLine.has(line.n) ? 'text-err' : undefined}>
              {line.n}
            </div>
          ))}
        </div>
        <div className="relative flex-auto min-w-0">
        {/* The coloured copy the design shows; the transparent textarea on top keeps the file editable. */}
        <pre
          ref={highlightRef}
          className="m-0 py-6 pr-7 pl-0 font-mono text-base leading-(--editor-leading) whitespace-pre absolute inset-0 overflow-hidden pointer-events-none"
          aria-hidden="true"
        >
          {draft.split('\n').map((line, index) => (
            <div key={index} className={TONE_CLASS[configLineTone(line)]}>
              {line || ' '}
            </div>
          ))}
        </pre>
        <textarea
          className="relative block w-full box-border min-h-[260px] m-0 py-6 pr-7 pl-0 border-0 bg-transparent text-base text-transparent caret-text overflow-auto resize-y outline-none focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-2px font-mono leading-(--editor-leading) whitespace-pre"
          aria-label={S.config.fileName}
          // Tall enough for the whole file, so it sits exactly over the coloured copy.
          rows={lines.length}
          value={draft}
          spellCheck={false}
          disabled={!services}
          onChange={(event) => setDraft(event.target.value)}
          onScroll={(event) => {
            if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
            if (highlightRef.current) {
              highlightRef.current.scrollTop = event.currentTarget.scrollTop;
              highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
            }
          }}
          onBlur={() => {
            if (services && dirty) void saveConfig(services, draft);
          }}
        />
        </div>
      </div>
      {messages.length > 0 ? (
        <ul className="flex flex-col gap-2 m-0 py-4 pr-5 pl-7 rounded-lg border border-err-line bg-err-bg text-sm text-err-strong">
          {messages.map((message, index) => (
            <li key={`${index}-${message}`}>{message}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
