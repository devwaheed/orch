import { create } from 'zustand';
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../../services/workbenchStore.js';
import { Markdown } from './Markdown.js';
import { docs, pageKey, pages } from '../pages.js';

const FALLBACK = 'README.md';
/** The page Help shows; opening Help again (F1, the book button) moves it even while Help is open. */
const useHelpPage = create<{ file: string }>(() => ({ file: FALLBACK }));

export function helpPageForArea(area: string): string {
  const pagesByArea: Record<string, string> = { work: 'work.md', newjob: 'new-job.md', specs: 'specs.md', review: 'review.md', sessions: 'sessions.md', trust: 'trust.md', accounts: 'accounts.md' };
  const selected = pagesByArea[area] ?? 'README.md';
  return docs[pageKey(selected)] ? selected : FALLBACK;
}

export function openHelpForArea(area: string): void {
  useHelpPage.setState({ file: helpPageForArea(area) });
  useWorkbenchStore.getState().setActiveRoute('/help');
}

export function HelpScreen() {
  const selectedFile = useHelpPage((state) => state.file);
  const setSelectedFile = (file: string) => useHelpPage.setState({ file });
  const [query, setQuery] = useState('');
  const [anchor, setAnchor] = useState('');
  const filtered = useMemo(() => pages.filter((page) => `${page.title} ${page.source}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [query]);
  const selected = pages.find((page) => page.file === selectedFile) ?? pages[0];
  const heading = selected?.blocks.filter((block) => block.type === 'heading' && block.level === 2) ?? [];
  useEffect(() => { if (anchor) document.getElementById(anchor)?.scrollIntoView(); }, [selectedFile, anchor]);
  if (!selected) return <div className="p-8 text-muted">Help</div>;
  const goTo = (target: string) => {
    const [file, targetAnchor] = target.split('#');
    if (file?.endsWith('.md')) setSelectedFile(file);
    setAnchor(targetAnchor ?? '');
    if (!targetAnchor && !file) setSelectedFile(FALLBACK);
  };
  const index = pages.findIndex((page) => page.file === selected.file);
  return <div className="flex min-h-full bg-bg text-text">
    <aside className="flex w-[240px] shrink-0 flex-col gap-3 border-r border-line bg-panel p-4">
      <label className="flex min-h-hit-min items-center gap-2 rounded-md border border-line bg-panel2 px-3"><Icon name="search" size={15} weight={1.8} className="text-muted" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search help" aria-label="Search help" className="min-w-0 flex-1 border-0 bg-transparent text-sm text-text outline-none placeholder:text-muted2" /></label>
      <nav className="flex flex-col gap-1" aria-label="Help pages">{filtered.map((page) => <button key={page.file} type="button" onClick={() => setSelectedFile(page.file)} aria-current={page.file === selected.file ? 'page' : undefined} className={`min-h-hit-min rounded-md border-0 px-3 text-left text-sm ${page.file === selected.file ? 'bg-active font-semibold text-text' : 'bg-transparent text-muted2 hover:bg-raised'}`}>{page.title}</button>)}</nav>
    </aside>
    <article className="flex min-w-0 flex-1 justify-center overflow-y-auto px-8 py-8">
      <div className="flex w-full max-w-[1000px] items-start gap-8">
        <main className="min-w-0 w-full max-w-[760px] flex-1"><Markdown source={selected.source} onInternalLink={goTo} />
          <nav className="mt-10 flex justify-between border-t border-line pt-5" aria-label="Help page navigation">
            {index > 0 ? <button type="button" onClick={() => setSelectedFile(pages[index - 1]!.file)} className="min-h-hit-min rounded-md border border-line bg-panel px-4 text-sm text-text">Previous</button> : <span />}
            {index < pages.length - 1 ? <button type="button" onClick={() => setSelectedFile(pages[index + 1]!.file)} className="min-h-hit-min rounded-md border border-line bg-panel px-4 text-sm text-text">Next</button> : <span />}
          </nav>
        </main>
        <aside className="sticky top-0 hidden w-[180px] shrink-0 flex-col gap-2 text-sm min-[1100px]:flex"><h2 className="font-semibold text-text">On this page</h2>{heading.map((item) => item.type === 'heading' && <a key={item.id} href={`#${item.id}`} className="text-muted2 hover:text-text">{item.text}</a>)}</aside>
      </div>
    </article>
  </div>;
}
