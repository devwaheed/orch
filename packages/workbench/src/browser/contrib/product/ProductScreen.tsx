import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { FactoryPipeline, FactoryAnswers, PipelineRunState, PipelineStage, ProductFile, Result, SpecRun, SpecQueue, TrailRow } from '@orchagents/contracts';
import { Icon } from '../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import { useAccountsStore } from '../../services/stores/accounts.js';
import { useSpecsStore } from '../../services/stores/specs.js';
import { getProductServices, notifyProductChanged } from './productStore.js';
import { specStatus, watchSpecLive } from '../specs/index.js';
import { openJobRun } from '../work/index.js';
import { Markdown } from '../help/index.js';
import { formatWhen } from '../sessions/index.js';
import { countLine, filterTrail, gatesInOpenFirst, groupOrder, groupTitle, productWizardSteps, runControlState, stagesByGroup, stateText, trailActor, wizardCanAdvance, wizardStepLabel, type ProductView, type TrailFilter } from './productView.js';

const VIEWS: readonly ProductView[] = ['map', 'gates', 'design', 'trail', 'files'];
const VIEW_LABEL: Record<ProductView, string> = { map: 'Map', gates: 'Gates', design: 'Design', trail: 'Trail', files: 'Files' };
const FIELD = 'box-border w-full min-w-0 rounded-lg border border-line bg-panel px-4 py-3 text-base text-text placeholder:text-muted2 focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2';
const BUTTON = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-btnline bg-btn px-4 py-2 text-sm font-semibold text-text hover:bg-raised focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:text-disabled';
const PRIMARY = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-accent-solid bg-accent-solid px-5 py-2 text-sm font-semibold text-on-accent hover:opacity-92 focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-raised disabled:text-disabled';
const WIZARD_NEXT = 'flex items-center gap-7px px-15px py-3 min-h-[38px] rounded-md border-0 bg-accent-solid text-on-accent font-semibold text-base cursor-pointer disabled:bg-raised disabled:text-disabled disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2';
const PILL: Record<PipelineStage['state'], string> = {
  done: 'bg-ok-bg text-ok', have: 'bg-neutral text-text2', skipped: 'bg-neutral text-muted', next: 'bg-info-bg text-info-strong', needs_you: 'bg-warn-bg text-warn-text', queued: 'bg-neutral text-text3',
};

export function ProductScreen() {
  const project = useWorkbenchStore((s) => s.activeProject);
  const activeRoute = useWorkbenchStore((s) => s.activeRoute);
  const productData = useProductData(project);
  return activeRoute === '/product/new' ? <NewProductPage /> : <ProductDashboard key={project} {...productData} />;
}

function useProductData(project: string) {
  const [pipeline, setPipeline] = useState<FactoryPipeline | null>(null);
  const [error, setError] = useState<{ message: string; fix?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const port = getProductServices()?.specs;
    if (!project || !port) return undefined;
    let live = true;
    const refresh = async () => {
      setLoading(true);
      const result = await port.factoryPipeline(project);
      if (live && result.ok) { setPipeline(result.value); setError(null); }
      else if (live && !result.ok) setError({ message: result.error.message, ...(result.error.fix ? { fix: result.error.fix } : {}) });
      if (live) setLoading(false);
    };
    void refresh();
    const onChange = (event: Event) => { if ((event as CustomEvent<string>).detail === project) void refresh(); };
    window.addEventListener('orch:product-changed', onChange);
    return () => { live = false; window.removeEventListener('orch:product-changed', onChange); };
  }, [project]);
  return { pipeline, error, loading };
}

function ProductDashboard({ pipeline, error: pipelineError, loading }: { readonly pipeline: FactoryPipeline | null; readonly error: { message: string; fix?: string } | null; readonly loading: boolean }) {
  const project = useWorkbenchStore((s) => s.activeProject);
  const [view, setView] = useState<ProductView>('map');
  const [selectedGate, setSelectedGate] = useState<string | null>(null);
  const [trail, setTrail] = useState<TrailRow[]>([]);
  const [unreadable, setUnreadable] = useState(0);
  const [run, setRun] = useState<PipelineRunState | null>(null);
  const [error, setError] = useState<{ message: string; fix?: string | undefined } | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<TrailFilter>('all');
  const [answer, setAnswer] = useState('');
  const [productFiles, setProductFiles] = useState<ProductFile[]>([]);
  const [filesError, setFilesError] = useState<{ message: string; fix?: string } | null>(null);
  const readFile = useCallback(async (relPath: string) => getProductServices()?.specs.readProductFile(project, relPath), [project]);
  const specs = useSpecsStore((s) => s.queues.find((queue) => queue.repoPath === project)?.specs ?? []);
  const queues = useSpecsStore((s) => s.queues);

  useEffect(() => {
    const port = getProductServices()?.specs;
    if (!project || !port) return;
    let live = true;
    const refresh = async () => {
      const [trailResult, runResult] = await Promise.all([port.factoryTrail(project), port.pipelineRun(project)]);
      if (!live) return;
      if (trailResult.ok) { setTrail(trailResult.value.rows); setUnreadable(trailResult.value.unreadable); }
      if (runResult.ok) setRun(runResult.value);
    };
    void refresh();
    const onChange = (event: Event) => { if ((event as CustomEvent<string>).detail === project) void refresh(); };
    window.addEventListener('orch:product-changed', onChange);
    return () => { live = false; window.removeEventListener('orch:product-changed', onChange); };
  }, [project, pipeline]);

  useEffect(() => {
    const service = getProductServices()?.specs;
    if (!service || !project) return;
    let live = true;
    void service.productFiles(project).then((result) => {
      if (!live) return;
      if (result.ok) { setProductFiles(result.value); setFilesError(null); }
      else setFilesError({ message: result.error.message, ...(result.error.fix ? { fix: result.error.fix } : {}) });
    });
    return () => { live = false; };
  }, [project, pipeline]);

  const gates = useMemo(() => gatesInOpenFirst(pipeline?.stages ?? []), [pipeline]);
  const activeGate = gates.find((gate) => gate.id === selectedGate) ?? gates.find((gate) => gate.state === 'needs_you') ?? gates[0];
  const state = runControlState(run);
  const act = async (action: 'start' | 'pause' | 'stop' | 'resume') => {
    const service = getProductServices()?.specs;
    if (!service) return;
    setBusy(true); setError(null);
    const result = action === 'start' ? await service.startPipelineRun(project)
      : action === 'pause' ? await service.pausePipelineRun(project)
        : action === 'stop' ? await service.stopPipelineRun(project)
          : await service.startPipelineRun(project);
    if (!result.ok) setError({ message: result.error.message, fix: result.error.fix });
    const fresh = await service.pipelineRun(project);
    if (fresh.ok) setRun(fresh.value);
    setBusy(false);
  };
  const recordAnswer = async () => {
    if (!activeGate || !answer.trim()) return;
    const service = getProductServices()?.specs;
    if (!service) return;
    setBusy(true); setError(null);
    const result = await service.answerFactoryGate(project, activeGate.id, answer);
    if (result.ok) { setAnswer(''); setSelectedGate(activeGate.id); notifyProductChanged(project); }
    else setError({ message: result.error.message, fix: result.error.fix });
    setBusy(false);
  };
  const watchLive = (specId: string) => {
    const queue = queues.find((item) => item.repoPath === project);
    if (!queue) return;
    const spec = queue.specs.find((item) => item.id === specId) ?? (pipeline?.product === 'tidemark'
      ? queue.specs.find((item) => ['running', 'verifying', 'auditing', 'waiting_quota'].includes(item.state))
      : undefined);
    if (!spec) return;
    watchSpecLive(spec.id);
  };

  if (loading && !pipeline) return <div role="status" className="flex flex-auto items-center justify-center text-sm text-muted2">Loading product pipeline…</div>;
  if (pipelineError) return <section role="alert" className="m-9 rounded-xl border border-err-line bg-err-bg px-6 py-5 text-err-strong"><h1 className="m-0 text-lg font-semibold">{pipelineError.message}</h1>{pipelineError.fix && <p className="m-0 mt-2 text-sm">{pipelineError.fix}</p>}</section>;
  if (!pipeline) return <div className="flex flex-auto flex-col items-center justify-center gap-4 px-8 text-center"><h1 className="m-0 text-xl font-semibold">This project hasn't been set up as a product yet.</h1><button type="button" className={PRIMARY} onClick={() => useWorkbenchStore.getState().setActiveRoute('/product/new')}>Set up the pipeline</button></div>;
  const groups = stagesByGroup(pipeline);
  const waitingGate = pipeline.stages.find((stage) => stage.state === 'needs_you');
  const now = waitingGate ? `Waiting on you: ${waitingGate.question ?? waitingGate.title}` : pipeline.now ? `Now: ${pipeline.now.title}` : '';
  const groupCounts = (group: typeof groupOrder[number]) => pipeline.groups[group] ?? { total: 0, done: 0, next: 0, needs_you: 0, left: 0, gates_ahead: 0 };
  const productSpecs = pipeline.product === 'tidemark'
    ? specs.filter((spec) => ['running', 'verifying', 'auditing', 'waiting_quota'].includes(spec.state)).slice(0, 1).map((spec) => ({ ...spec, id: '001' as typeof spec.id, attempt: 1, spec: { ...spec.spec, title: 'Booking calendar' } }))
    : specs;

  return <main className="flex min-h-0 flex-auto flex-col overflow-auto text-base text-text font-sans">
    <header className="flex flex-wrap items-end gap-5 border-b border-line px-9 pt-6 pb-5">
      <div className="flex min-w-[250px] flex-auto flex-col gap-2">
        <h1 className="m-0 text-xl font-semibold">Product · {pipeline.product}</h1>
        <div className="flex items-center gap-2 text-sm text-text2">{now && <span>{now}</span>}{run && <RunState run={run} onAction={act} busy={busy} />}</div>
      </div>
      {run && (state === 'working' || state === 'paused') && <div className="flex gap-2">
        {state === 'working' ? <button className={BUTTON} type="button" onClick={() => void act('pause')} disabled={busy}><Icon name="pause" size={13} />Pause</button> : <button className={BUTTON} type="button" onClick={() => void act('resume')} disabled={busy}><Icon name="play" size={13} />Resume</button>}
        <button className={BUTTON} type="button" onClick={() => void act('stop')} disabled={busy}><Icon name="stop" size={13} />Stop</button>
      </div>}
      <div role="group" aria-label="Product views" className="flex flex-wrap rounded-9px border border-line bg-panel2 p-3px">{VIEWS.map((item) => <button key={item} type="button" onClick={() => setView(item)} aria-pressed={view === item} className="min-h-10 rounded-sm border-0 bg-transparent px-4 py-1 text-sm text-muted aria-pressed:bg-seg aria-pressed:text-text">{VIEW_LABEL[item]}</button>)}</div>
    </header>
    {error && view !== 'gates' && <div role="alert" className="mx-9 mt-4 rounded-lg border border-err-line bg-err-bg px-5 py-4 text-sm text-err-strong"><strong>{error.message}</strong>{error.fix && <p className="m-0 mt-1">{error.fix}</p>}</div>}
    <section aria-label="Overall progress" className="mx-9 mt-5 flex flex-col gap-3 rounded-xl border border-line bg-panel px-6 py-5">
      <ProgressBar counts={pipeline.counts} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text2"><strong className="font-semibold text-text">{countLine(pipeline.counts)}</strong><span>{pipeline.counts.gates_ahead} more decisions for you</span></div>
    </section>
    {view === 'map' && <div className="@container flex flex-col gap-5 px-9 py-6">
            <div className="@min-[1000px]:grid-cols-3 grid min-w-0 grid-cols-1 gap-4">{groupOrder.map((group) => <section key={group} aria-label={groupTitle[group]} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-panel">
        <header className="flex flex-col gap-2 border-b border-line px-5 py-4"><div className="flex items-center justify-between"><h2 className="m-0 text-base font-semibold">{groupTitle[group]}</h2><span className="font-mono text-xs text-muted2">{groupCounts(group).done}/{groupCounts(group).total}</span></div><ProgressBar counts={groupCounts(group)} compact /><p className="m-0 text-xs text-muted2">{countLine(groupCounts(group))}</p></header>
        <div className="flex flex-col">{groups[group].map((stage) => <button key={stage.id} type="button" onClick={() => { if (stage.gate) { setSelectedGate(stage.id); setView('gates'); } else { setView('files'); } }} className="flex min-h-16 items-center gap-3 border-0 border-b border-line2 bg-transparent px-5 py-3 text-left last:border-b-0 hover:bg-raised"><span className={`shrink-0 rounded-pill px-3 py-1 text-xs font-medium ${PILL[stage.state]}`}>{stateText[stage.state]}</span><span className="min-w-0 flex-auto"><span className="block truncate text-sm font-medium">{stage.title}</span>{stage.skill && <span className="block truncate text-xs text-muted2">{stage.skill}</span>}</span>{stage.gate && <Icon name="pin" size={15} className="text-warn" />}</button>)}</div>
        {group === 'build' && <BuildSpecs specs={productSpecs} queue={queues.find((queue) => queue.repoPath === project) ?? null} onWatch={watchLive} />}
        <footer className="border-t border-line2 px-5 py-3 text-xs text-muted2">{groupCounts(group).gates_ahead} more decisions for you</footer>
      </section>)}</div>
      <section className="rounded-xl border border-line bg-panel px-5 py-4"><h2 className="m-0 mb-3 text-sm font-semibold">Left</h2><div className="flex flex-wrap gap-2">{pipeline.stages.filter((stage) => ['next', 'needs_you', 'queued'].includes(stage.state)).map((stage) => <span key={stage.id} className="inline-flex items-center gap-2 rounded-md bg-panel2 px-3 py-2 text-sm">{stage.gate && <Icon name="pin" size={13} className="text-warn" />}{stage.title}</span>)}</div></section>
    </div>}
    {view === 'gates' && <section className="flex min-h-0 flex-auto flex-row gap-4 p-4">
      <div className="flex w-[360px] shrink-0 flex-col overflow-auto rounded-xl border border-line bg-panel">{gates.map((gate) => <button key={gate.id} type="button" aria-pressed={gate.id === activeGate?.id} onClick={() => { setSelectedGate(gate.id); setAnswer(''); }} className="flex flex-col gap-2 border-0 border-b border-line2 bg-transparent p-5 text-left aria-pressed:bg-active hover:bg-raised"><span className="flex items-center justify-between gap-3"><strong className="text-sm font-semibold">{gate.title}</strong><span className={`rounded-pill px-3 py-1 text-xs ${PILL[gate.state]}`}>{stateText[gate.state]}</span></span><span className="text-sm text-muted2">{gate.question}</span>{gate.answer && <span className="text-xs text-text2">“{gate.answer.words}” · in {gate.answer.via} · {formatWhen(gate.answer.at, new Date())}</span>}</button>)}</div>
      <div className="flex min-w-0 flex-auto flex-col gap-3 rounded-xl border border-line bg-panel p-4">{activeGate ? <><div><h2 className="m-0 text-lg font-semibold">{activeGate.question ?? activeGate.title}</h2><p className="mt-2 text-sm text-muted2">{activeGate.title}</p></div><div className="grid grid-cols-1 gap-3 md:grid-cols-2">{(activeGate.show ?? []).map((file, index) => <button key={file} type="button" onClick={() => setAnswer(String(index + 1))} aria-label={`Choose image ${index + 1}: ${file}`} className="relative flex min-h-24 items-center justify-center overflow-hidden rounded-lg border border-line bg-panel2 text-sm text-text2 hover:bg-raised"><ProductImage file={file} readFile={readFile} alt={`Option ${index + 1}`} /><span className="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-pill bg-accent-solid text-sm font-semibold text-on-accent">{index + 1}</span></button>)}</div>{activeGate.answer ? <div className="rounded-lg border border-line bg-panel2 p-4"><p className="m-0 text-xs text-muted2">Answered in {activeGate.answer.via} · {formatWhen(activeGate.answer.at, new Date())}</p><p className="m-0 mt-2 whitespace-pre-wrap text-sm text-text">{activeGate.answer.words}</p></div> : <><label htmlFor="gate-answer" className="text-sm font-semibold">Your answer</label><textarea id="gate-answer" className={`${FIELD} box-border min-w-0 min-h-24 resize-y`} value={answer} onChange={(event) => setAnswer(event.target.value)} /><button type="button" className={`${PRIMARY} self-start`} disabled={!answer.trim() || busy} onClick={() => void recordAnswer()}>Record my answer</button>{error && <p role="alert" className="m-0 rounded-md bg-err-bg px-5 py-4 text-sm text-err-strong">{error.message}{error.fix && ` ${error.fix}`}</p>}</>}</> : <p className="m-0 text-sm text-muted2">No gates yet.</p>}</div>
    </section>}
    {view === 'design' && <DesignView pipeline={pipeline} files={productFiles} readFile={readFile} />}
    {view === 'trail' && <TrailView pipeline={pipeline} rows={trail} unreadable={unreadable} filter={filter} setFilter={setFilter} onEvidence={() => setView('files')} />}
    {view === 'files' && <FilesView project={project} files={productFiles} error={filesError} readFile={readFile} />}
  </main>;
}

function ProgressBar({ counts, compact = false }: { readonly counts: { readonly total: number; readonly done: number }; readonly compact?: boolean }) {
  const percent = counts.total ? Math.min(100, counts.done / counts.total * 100) : 0;
  return <div role="progressbar" aria-valuemin={0} aria-valuemax={counts.total} aria-valuenow={counts.done} className={`overflow-hidden rounded-pill bg-line ${compact ? 'h-2' : 'h-3'}`}><div className="h-full w-(--progress-width) rounded-pill bg-ok-dot" style={{ '--progress-width': `${percent}%` } as CSSProperties} /></div>;
}

function ProductImage({ file, readFile, alt }: { readonly file: string; readonly readFile: (relPath: string) => Promise<Result<string> | undefined>; readonly alt: string }) {
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void readFile(file).then((result) => {
      if (live && result?.ok && result.value.trimStart().startsWith('<svg')) {
        setSource(`data:image/svg+xml,${encodeURIComponent(result.value)}`);
      }
    });
    return () => { live = false; };
  }, [file, readFile]);
  const project = useWorkbenchStore((state) => state.activeProject);
  return <img className="h-full w-full object-contain" alt={alt} src={source ?? fileUrl(project, file)} />;
}

function BuildSpecs({ specs, queue, onWatch }: { readonly specs: readonly SpecRun[]; readonly queue: SpecQueue | null; readonly onWatch: (id: string) => void }) {
  const active = specs.filter((spec) => ['running', 'verifying', 'auditing', 'waiting_quota'].includes(spec.state));
  const queued = specs.find((spec) => spec.state === 'queued');
  return <div className="flex flex-col gap-2 border-t border-line2 p-4">{active.length ? active.map((spec) => { const status = specStatus(spec, specs, queue?.settings.advance); return <div key={spec.id} className="flex items-center justify-between gap-3 rounded-lg bg-panel2 p-3"><div className="min-w-0"><strong className="block truncate text-sm">{spec.id} · {spec.spec.title}</strong><span className="block text-xs text-text2">{status.pill}</span><span className="text-xs text-muted2">{status.secondLine}</span></div><button className={BUTTON} type="button" onClick={() => onWatch(spec.id)}>Watch live</button></div>; }) : queued && <p className="m-0 text-sm text-muted2">Next: {queued.id} · {queued.spec.title}</p>}</div>;
}

function RunState({ run, onAction, busy }: { readonly run: PipelineRunState; readonly onAction: (action: 'start' | 'pause' | 'stop' | 'resume') => void; readonly busy: boolean }) {
  const state = runControlState(run);
  if (state === 'working') return <span className="inline-flex items-center gap-2 rounded-pill bg-info-bg px-3 py-1 text-xs text-info-strong">Working: {run.stage ?? ''} <button className="border-0 bg-transparent p-0 text-accent underline" type="button" onClick={() => { useWorkbenchStore.getState().setActiveArea('specs'); openJobRun(run.jobId); }}>Watch live</button></span>;
  if (state === 'paused') return <span className="rounded-pill bg-warn-bg px-3 py-1 text-xs text-warn-text">Paused</span>;
  if (state === 'stopped') return <span className="inline-flex items-center gap-2 rounded-pill bg-err-bg px-3 py-1 text-xs text-err">Stopped: {run.reason ?? ''} <button type="button" className="border-0 bg-transparent p-0 text-accent underline" disabled={busy} onClick={() => onAction('start')}>Start again</button></span>;
  if (state === 'done') return <span className="rounded-pill bg-ok-bg px-3 py-1 text-xs text-ok">Done</span>;
  return <span className="rounded-pill bg-neutral px-3 py-1 text-xs text-text3">Waiting</span>;
}

function DesignView({ pipeline, files, readFile }: { readonly pipeline: FactoryPipeline; readonly files: readonly ProductFile[]; readonly readFile: (relPath: string) => Promise<Result<string> | undefined> }) {
  const [palette, setPalette] = useState<unknown>(null);
  const [manifest, setManifest] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    const load = async (relPath: string, setValue: (value: unknown) => void) => {
      const result = await readFile(relPath);
      if (!live || !result?.ok) return;
      try { setValue(JSON.parse(result.value)); } catch { setValue(null); }
    };
    void load('design/palette.json', setPalette);
    void load('design/assets/manifest.json', setManifest);
    return () => { live = false; };
  }, [files, readFile]);
  const images = files.filter((file) => file.kind === 'image');
  const findImage = (surface: 'web' | 'console', kind: 'pick' | 'prototype' | 'built') => {
    const surfacePattern = surface === 'web' ? /web|site|marketing/i : /console/i;
    const candidates = images.filter((file) => surfacePattern.test(file.path));
    const keyword = kind === 'pick' ? /pick|reference|ref/i : kind === 'prototype' ? /approved|prototype|proto/i : /built|screenshot|parity/i;
    const dirMatch = kind === 'pick' ? candidates.filter((file) => file.path.startsWith('refs/')) : candidates.filter((file) => file.path.startsWith('design/'));
    return dirMatch.find((file) => keyword.test(file.path)) ?? candidates.find((file) => keyword.test(file.path));
  };
  const paletteItems = flattenRecords(palette).filter((item) => typeof item.color === 'string' || typeof item.hex === 'string');
  const assetItems = flattenRecords(manifest).filter((item) => typeof item.credit === 'string' || typeof item.licence === 'string' || typeof item.license === 'string');
  const contractExists = files.some((file) => file.path === 'design/contract.json');
  const stageFor = (surface: 'web' | 'console', kind: 'pick' | 'prototype' | 'built') => {
    const surfacePattern = surface === 'web' ? /web|site|marketing/i : /console/i;
    const pattern = kind === 'pick' ? /reference|pick/i : kind === 'prototype' ? /prototype|approve/i : /built|accept/i;
    return pipeline.stages.find((stage) => stage.group === 'design' && surfacePattern.test(`${stage.id} ${stage.title}`) && pattern.test(`${stage.id} ${stage.title}`))?.title
      ?? pipeline.stages.find((stage) => stage.group === (kind === 'built' ? 'build' : 'design') && surfacePattern.test(`${stage.id} ${stage.title}`))?.title
      ?? pipeline.stages.find((stage) => stage.group === 'design')?.title
      ?? 'Design';
  };
  return <div className="flex flex-col gap-6 px-9 py-6">
    {(['web', 'console'] as const).map((surface) => <section key={surface} className="rounded-xl border border-line bg-panel p-5"><h2 className="m-0 mb-4 text-base font-semibold">{surface === 'web' ? 'Marketing site' : 'Console'}</h2><div className="grid grid-cols-1 gap-4 lg:grid-cols-3">{(['pick', 'prototype', 'built'] as const).map((kind) => {
      const label = kind === 'pick' ? 'Your pick' : kind === 'prototype' ? 'Approved prototype' : 'Built';
      const file = findImage(surface, kind);
      return <article key={kind} className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-line2 bg-panel2 p-4 text-center">{file ? <><strong className="text-sm">{label}</strong><div className="flex h-40 w-full items-center justify-center overflow-hidden rounded-md"><ProductImage file={file.path} readFile={readFile} alt={`${label} · ${surface}`} /></div><span className="font-mono text-xs text-muted2">{file.path}</span></> : <><strong className="text-sm">{label}</strong><span className="text-sm text-muted2">Not made yet</span><span className="text-xs text-muted">{stageFor(surface, kind)}</span></>}</article>;
    })}</div></section>)}
    {paletteItems.length > 0 && <section className="rounded-xl border border-line bg-panel p-5"><h2 className="m-0 mb-4 text-base font-semibold">Palette</h2><div className="flex flex-wrap gap-3">{paletteItems.map((item, index) => { const color = String(item.color ?? item.hex); return <div key={`${String(item.name ?? item.title ?? index)}-${index}`} className="flex items-center gap-3 rounded-lg border border-line2 bg-panel2 px-3 py-2"><span aria-hidden="true" className="h-8 w-8 rounded-md border border-line bg-(--palette-color)" style={{ '--palette-color': color } as CSSProperties} /><span className="flex flex-col text-left"><strong className="text-sm">{String(item.name ?? item.title ?? item.key ?? color)}</strong><span className="text-xs text-muted2">{String(item.role ?? item.job ?? item.description ?? '')}</span></span></div>; })}</div></section>}
    {assetItems.length > 0 && <section className="rounded-xl border border-line bg-panel p-5"><h2 className="m-0 mb-4 text-base font-semibold">Assets</h2><ul className="m-0 flex list-none flex-col gap-2 p-0">{assetItems.map((item, index) => <li key={index} className="rounded-lg bg-panel2 px-4 py-3 text-sm"><strong>{String(item.name ?? item.path ?? item.file ?? 'Asset')}</strong><span className="ml-3 text-muted2">{String(item.credit ?? '')}{item.credit && (item.licence || item.license) ? ' · ' : ''}{String(item.licence ?? item.license ?? '')}</span></li>)}</ul></section>}
    {contractExists && <section className="flex items-center gap-3 rounded-xl border border-line bg-panel px-5 py-4"><span className="text-sm font-semibold">Contract</span><span className="rounded-pill bg-neutral px-3 py-1 text-xs text-text2">Locked</span></section>}
  </div>;
}

function TrailView({ pipeline, rows, unreadable, filter, setFilter, onEvidence }: { readonly pipeline: FactoryPipeline; readonly rows: readonly TrailRow[]; readonly unreadable: number; readonly filter: TrailFilter; readonly setFilter: (filter: TrailFilter) => void; readonly onEvidence: () => void }) {
  const sorted = filterTrail(rows, filter);
  const groups = new Map<string, TrailRow[]>();
  for (const row of sorted) { const key = groupTitle[pipeline.stages.find((stage) => stage.id === row.stage)?.group ?? 'planning']; groups.set(key, [...(groups.get(key) ?? []), row]); }
  return <div className="flex flex-col gap-5 px-9 py-6"><div role="group" aria-label="Trail filter" className="flex w-fit rounded-9px border border-line bg-panel2 p-1">{(['all', 'operator', 'agent'] as const).map((item) => <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)} className="min-h-9 rounded-sm border-0 bg-transparent px-4 text-sm text-muted aria-pressed:bg-seg aria-pressed:text-text">{item === 'all' ? 'All' : item === 'operator' ? 'Your decisions' : 'Agent decisions'}</button>)}</div>{unreadable > 0 && <p className="m-0 text-xs text-muted2">{unreadable} lines in decisions.tsv couldn't be read.</p>}{groupOrder.map((key) => { const group = groupTitle[key]; const items = groups.get(group) ?? []; return items.length > 0 && <section key={group} className="rounded-xl border border-line bg-panel"><h2 className="m-0 border-b border-line px-5 py-3 text-sm font-semibold">{group}</h2>{items.map((row, index) => <article key={`${row.time}-${index}`} className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 border-b border-line2 px-5 py-4 last:border-0"><time className="font-mono text-xs text-muted2">{trailTime(row.time)}</time><p className="m-0 text-sm"><strong>{row.stage === 'init' ? 'Product setup' : pipeline.stages.find((stage) => stage.id === row.stage)?.title ?? row.stage}</strong> · {row.kind} · {trailActor(row.by)} · {row.summary}</p>{row.evidence.length > 0 && <div className="col-start-2 flex flex-wrap gap-2">{row.evidence.map((file) => <button key={file} type="button" className="border-0 bg-transparent p-0 font-mono text-xs text-accent underline" onClick={onEvidence}>{file}</button>)}</div>}</article>)}</section>; })}</div>;
}

function trailTime(value: string): string { return formatWhen(value, new Date()); }

function flattenRecords(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap((item) => item && typeof item === 'object' && !Array.isArray(item) ? [item as Record<string, unknown>, ...flattenRecords(item)] : []);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return [record, ...Object.values(record).flatMap((item) => item && typeof item === 'object' ? flattenRecords(item) : [])];
}

function fileUrl(repoPath: string, relPath: string): string {
  const full = `${repoPath.replace(/[\\/]$/, '')}/${relPath}`.replace(/\\/g, '/');
  const windows = window.orch?.app.os === 'windows' || /^[A-Za-z]:\//.test(full);
  const encoded = full.split('/').map((part, index) => index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)).join('/');
  return windows ? `file:///${encoded.replace(/^\/+/, '')}` : `file://${encoded.startsWith('/') ? '' : '/'}${encoded}`;
}

function FilesView({ project, files, error, readFile }: { readonly project: string; readonly files: readonly ProductFile[]; readonly error: { message: string; fix?: string } | null; readonly readFile: (relPath: string) => Promise<Result<string> | undefined> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [contents, setContents] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const file = files.find((item) => item.path === selected) ?? null;
  useEffect(() => { if (!selected && files.length) setSelected((files.find((item) => item.kind === 'markdown') ?? files[0])?.path ?? null); }, [files, selected]);
  useEffect(() => { if (!selected || file?.kind !== 'markdown') { setContents(null); setReadError(null); return; } let live = true; void readFile(selected).then((result) => { if (!live) return; if (result?.ok) { setContents(result.value); setReadError(null); } else { setContents(null); setReadError(result?.error.message ?? 'The product file could not be read.'); } }); return () => { live = false; }; }, [selected, file?.kind, readFile]);
  const open = (target: ProductFile) => { void window.orch?.app.openPath(fileUrl(project, target.path)); };
  const show = (target: ProductFile) => { void window.orch?.app.showItemInFolder(`${project.replace(/[\\/]$/, '')}/${target.path}`); };
  const grouped = ['docs', 'design', 'specs', 'refs'].map((folder) => ({ folder, items: files.filter((item) => item.path.startsWith(`${folder}/`)) }));
  return <div className="grid min-h-0 flex-auto grid-cols-1 gap-5 p-6 lg:grid-cols-[320px_1fr]">
    <nav aria-label="Product files" className="flex min-h-52 flex-col overflow-auto rounded-xl border border-line bg-panel p-3">{error && <p role="alert" className="m-2 text-sm text-err">{error.message}{error.fix ? ` ${error.fix}` : ''}</p>}{grouped.map(({ folder, items }) => <section key={folder} className="mb-2"><h2 className="m-0 px-3 py-2 font-mono text-xs font-semibold uppercase text-muted2">{folder}/</h2>{items.map((item) => <button key={item.path} type="button" aria-pressed={selected === item.path} onClick={() => setSelected(item.path)} className="flex min-h-9 w-full items-center gap-2 rounded-md border-0 bg-transparent px-3 py-2 text-left text-sm text-text2 aria-pressed:bg-active aria-pressed:text-text hover:bg-raised"><span className="font-mono text-xs">{item.path.slice(folder.length + 1)}</span></button>)}</section>)}</nav>
    <section className="flex min-w-0 flex-col rounded-xl border border-line bg-panel p-5">{file ? <><header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4"><div className="min-w-0"><h2 className="m-0 truncate font-mono text-sm font-semibold">{file.path}</h2><p className="m-0 mt-1 text-xs text-muted2">{file.kind} · {file.size.toLocaleString()} bytes</p></div><div className="flex gap-2"><button className={BUTTON} type="button" onClick={() => open(file)}>Open</button><button className={BUTTON} type="button" onClick={() => show(file)}>Show in Finder</button></div></header>{file.kind === 'image' ? <div className="flex min-h-0 flex-auto items-center justify-center overflow-auto p-4"><ProductImage file={file.path} readFile={readFile} alt={file.path} /></div> : file.kind === 'markdown' ? <div className="min-h-0 flex-auto overflow-auto py-5">{readError ? <p role="alert" className="text-sm text-err">{readError}</p> : contents === null ? <p role="status" className="text-sm text-muted2">Loading file…</p> : <Markdown source={contents} onInternalLink={() => undefined} />}</div> : <p className="m-0 mt-5 text-sm text-muted2">Open this file with the operating system.</p>}</> : <div className="flex flex-auto items-center justify-center text-sm text-muted2">Select a file to view it.</div>}</section>
  </div>;
}

type WizardChoice = 'generate' | 'skip' | 'file';
const DOCS = ['research', 'value_map', 'prd', 'architecture'] as const;
const DOC_LABEL: Record<(typeof DOCS)[number], string> = { research: 'Research', value_map: 'Value map', prd: 'PRD', architecture: 'Architecture' };

export function NewProductPage() {
  const project = useWorkbenchStore((s) => s.activeProject);
  const accounts = useAccountsStore((s) => s.accounts);
  const agents = useAccountsStore((s) => s.agents);
  const availableAgents = agents.filter((candidate) => accounts.some((account) => account.agent === candidate.id && account.use && account.state !== 'signed_out'));
  const [step, setStep] = useState(0);
  const [brief, setBrief] = useState('');
  const [choices, setChoices] = useState<Record<(typeof DOCS)[number], WizardChoice>>({ research: 'generate', value_map: 'generate', prd: 'generate', architecture: 'generate' });
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [surfaces, setSurfaces] = useState<Array<'web' | 'console'>>(['web']);
  const [scope, setScope] = useState<'design' | 'build' | 'full'>('full');
  const [specs, setSpecs] = useState<'one-by-one' | 'parallel' | 'manual'>('one-by-one');
  const [agent, setAgent] = useState<'auto' | FactoryAnswers['agent']>('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choiceStep = step >= 1 && step <= 4 ? DOCS[step - 1] : null;
  const canNext = wizardCanAdvance(step, { brief, choice: choiceStep ? choices[choiceStep] : null, filePath: choiceStep ? paths[choiceStep] ?? '' : '', surfaces });
  const nextStep = () => { if (canNext) setStep((current) => current + 1); };
  const toggleSurface = (surface: 'web' | 'console') => setSurfaces((current) => current.includes(surface) ? current.filter((item) => item !== surface) : [...current, surface]);
  const finish = async () => {
    const service = getProductServices()?.specs;
    if (!service) return;
    const have: FactoryAnswers['have'] = {};
    for (const key of DOCS) have[key] = choices[key] === 'file' ? { path: paths[key] ?? '' } : choices[key];
    const answers: FactoryAnswers = { brief, have, surfaces, scope, specs, agent };
    setBusy(true); setError(null);
    const result = await service.initFactoryProduct(project, answers);
    if (!result.ok) { setError(`${result.error.message}${result.error.fix ? ` ${result.error.fix}` : ''}`); setBusy(false); return; }
    const started = await service.startPipelineRun(project);
    if (!started.ok) { setError(`${started.error.message}${started.error.fix ? ` ${started.error.fix}` : ''}`); setBusy(false); return; }
    useWorkbenchStore.getState().setActiveRoute('/product');
    setBusy(false);
  };
  const stepContent = () => {
    if (step === 0) return <><h2 className="m-0 text-lg font-semibold">Brief</h2><p className="m-0 text-sm text-muted2">Describe the product, or use a file or folder.</p><textarea autoFocus className={`${FIELD} min-h-56 resize-y`} value={brief} onChange={(event) => setBrief(event.target.value)} aria-label="Brief" /></>;
    if (choiceStep) return <><h2 className="m-0 text-lg font-semibold">What you already have: {DOC_LABEL[choiceStep]}</h2><div className="flex flex-col gap-3">{(['generate', 'skip', 'file'] as const).map((value) => <label key={value} className="flex min-h-12 items-center gap-3 rounded-lg border border-line bg-panel px-4"><input type="radio" name={choiceStep} checked={choices[choiceStep] === value} onChange={() => setChoices((current) => ({ ...current, [choiceStep]: value }))} /><span className="text-sm">{value === 'file' ? 'Choose file' : value === 'generate' ? 'Generate' : 'Skip'}</span></label>)}</div>{choices[choiceStep] === 'file' && <input className={FIELD} aria-label={`${DOC_LABEL[choiceStep]} file path`} placeholder="Project-relative file path" value={paths[choiceStep] ?? ''} onChange={(event) => setPaths((current) => ({ ...current, [choiceStep]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); nextStep(); } }} />}</>;
    if (step === 5) return <><h2 className="m-0 text-lg font-semibold">Build</h2><div className="flex flex-col gap-3">{(['web', 'console'] as const).map((surface) => <label key={surface} className="flex min-h-12 items-center gap-3 rounded-lg border border-line bg-panel px-4"><input type="checkbox" checked={surfaces.includes(surface)} onChange={() => toggleSurface(surface)} /><span className="text-sm">{surface === 'web' ? 'Marketing site' : 'Console'}</span></label>)}<p className="m-0 text-xs text-muted2">Choose Marketing site, Console, or Both.</p></div></>;
    if (step === 6) return <ChoiceStep title="How far" values={[['design', 'Design only'], ['build', 'Build the surfaces'], ['full', 'The whole product']]} value={scope} onChange={(value) => setScope(value as typeof scope)} />;
    if (step === 7) return <ChoiceStep title="Specs after design" values={[["one-by-one", 'One by one'], ['parallel', 'In parallel'], ['manual', "I’ll run them"]]} value={specs} onChange={(value) => setSpecs(value as typeof specs)} />;
    if (step === 8) return <><h2 className="m-0 text-lg font-semibold">Who builds it</h2><label className="flex min-h-12 items-center gap-3 rounded-lg border border-line bg-panel px-4"><input type="radio" name="product-agent" checked={agent === 'auto'} onChange={() => setAgent('auto')} /><span className="text-sm">Auto</span></label>{availableAgents.map((candidate) => <label key={candidate.id} className="flex min-h-12 items-center gap-3 rounded-lg border border-line bg-panel px-4"><input type="radio" name="product-agent" checked={agent === candidate.id} onChange={() => setAgent(candidate.id)} /><span className="text-sm">{candidate.displayName}</span></label>)}</>;
    return <><h2 className="m-0 text-lg font-semibold">Summary</h2><dl className="grid grid-cols-[140px_1fr] gap-3 text-sm">{[['Brief', brief], ...DOCS.map((key) => [DOC_LABEL[key], choices[key] === 'file' ? paths[key] : choices[key]]), ['Build', surfaces.map((surface) => surface === 'web' ? 'Marketing site' : 'Console').join(' + ') || '—'], ['How far', scope], ['Specs after design', specs], ['Who builds it', agent]].map(([key, value]) => <div key={key} className="contents"><dt className="text-muted2">{key}</dt><dd className="m-0 whitespace-pre-wrap">{value}</dd></div>)}</dl></>;
  };
  return <main className="flex min-h-0 flex-auto flex-col overflow-auto px-9 py-7 text-base text-text font-sans"><div className="flex flex-col gap-3"><h1 className="m-0 text-xl font-semibold">New product</h1><p className="m-0 text-muted">Set up a product pipeline with the SaaS Factory.</p></div><section className="mt-7 flex w-full max-w-[760px] flex-col gap-5 rounded-xl border border-line bg-panel p-7"><p className="m-0 text-sm text-muted2">{wizardStepLabel(step)}</p>{stepContent()}{error && <p role="alert" className="m-0 text-sm text-err">{error}</p>}<footer className="flex items-center justify-between border-t border-line pt-5">{step > 0 ? <button type="button" className={BUTTON} disabled={busy} onClick={() => setStep((current) => current - 1)}>Back</button> : <span />}{step === productWizardSteps.length - 1 ? <button type="button" className={PRIMARY} disabled={busy || !brief.trim() || surfaces.length === 0} onClick={() => void finish()}>Set up and start</button> : <button type="button" className={WIZARD_NEXT} disabled={!canNext} onClick={nextStep}>Next</button>}</footer></section></main>;
}

function ChoiceStep({ title, values, value, onChange }: { readonly title: string; readonly values: readonly [string, string][]; readonly value: string; readonly onChange: (value: string) => void }) {
  return <><h2 className="m-0 text-lg font-semibold">{title}</h2><div className="flex flex-col gap-3">{values.map(([id, label]) => <label key={id} className="flex min-h-12 items-center gap-3 rounded-lg border border-line bg-panel px-4"><input type="radio" name={title} checked={value === id} onChange={() => onChange(id)} /><span className="text-sm">{label}</span></label>)}</div></>;
}
