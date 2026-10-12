import { useMemo, useRef } from 'react';
import type { CoreServices } from '../../../services/channelSchemas.js';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { configLineTone, markErrors, numberedLines } from '../configFile.js';
import { saveConfig } from '../actions.js';
import { accountsStrings as S } from '../strings.js';
import { useAccountsUiStore } from '../stores/accountsUi.js';
import { useConfigErrorsStore } from '../../../services/stores/config.js';
import styles from './AccountsScreen.module.css';

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
    <section aria-label={S.config.fileName} className={styles.configBlock}>
      <div className={styles.configHead}>
        <span className={styles.fileName}>
          <Icon name="file" size={13} />
          {S.config.fileName}
        </span>
        <span className={styles.configHint}>{S.config.hint}</span>
        <button type="button" className={styles.configOpenButton}>
          <Icon name="code" size={12} />
          {S.config.openEditor}
        </button>
      </div>
      <div className={styles.editorWrap}>
        <div ref={gutterRef} className={styles.gutter} aria-hidden="true">
          {lines.map((line) => (
            <div key={line.n} className={marks.byLine.has(line.n) ? styles.gutterMarked : undefined}>
              {line.n}
            </div>
          ))}
        </div>
        <div className={styles.code}>
        {/* The coloured copy the design shows; the transparent textarea on top keeps the file editable. */}
        <pre ref={highlightRef} className={styles.highlight} aria-hidden="true">
          {draft.split('\n').map((line, index) => (
            <div key={index} className={styles[`tone_${configLineTone(line)}`]}>
              {line || ' '}
            </div>
          ))}
        </pre>
        <textarea
          className={styles.editor}
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
        <ul className={styles.errors}>
          {messages.map((message, index) => (
            <li key={`${index}-${message}`}>{message}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
