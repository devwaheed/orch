import { Figure, Node, Chip, Arrow } from './kit.js';

const FACTORY_STAGES = [
  'brief',
  'research',
  'value map',
  'prd',
  'architecture',
  'references',
  'brand guide',
  'implementation',
];

export function SpecFlowDiagram() {
  return (
    <Figure
      title="From idea to shipped specs"
      label="From idea to shipped specs: SaaS Factory stages produce BMAD stories and Kiro feature specs, which are queued with order and failure rules, then run as verified jobs through review to merge before the next wave starts."
    >
      <div className="flex w-full min-w-0 box-border flex-col gap-2 rounded-lg border border-line bg-panel2 p-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted2">
          SaaS Factory
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {FACTORY_STAGES.map((stage, i) => (
            <span key={stage} className="inline-flex items-center gap-1">
              <Chip>{stage}</Chip>
              {i < FACTORY_STAGES.length - 1 && (
                <span className="font-mono text-xs text-muted" aria-hidden="true">
                  →
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

      <div className="flex justify-center">
        <Arrow direction="vertical" />
      </div>

      <Node
        icon="code"
        title="BMAD stories + Kiro feature specs"
        className="w-full min-w-0 box-border self-center w-auto"
      />

      <div className="flex justify-center">
        <Arrow direction="vertical" />
      </div>

      <Node
        icon="listOrdered"
        title="Spec queue"
        chips={[
          <Chip key="order">Order</Chip>,
          <Chip key="move">Move on when</Chip>,
          <Chip key="fail">If a spec fails</Chip>,
        ]}
        className="w-full min-w-0 box-border self-center w-auto"
      />

      <div className="flex justify-center">
        <Arrow direction="vertical" />
      </div>

      <div className="flex w-full min-w-0 box-border flex-col gap-3 rounded-lg border border-line bg-panel2 p-3">
        <div className="flex w-full min-w-0 items-center justify-between gap-1">
          <Node icon="play" title="Runs as a job" className="flex-1 min-w-0 p-2" />
          <Arrow direction="horizontal" className="shrink-0" />
          <Node icon="check" title="Verified" className="flex-1 min-w-0 p-2" />
          <Arrow direction="horizontal" className="shrink-0" />
          <Node icon="review" title="Review" className="flex-1 min-w-0 p-2" />
          <Arrow direction="horizontal" className="shrink-0" />
          <Node icon="merge" title="Merged" className="flex-1 min-w-0 p-2" />
        </div>
        <div className="flex items-center justify-center border-t border-line pt-2">
          <Arrow direction="left" label="next wave starts" />
        </div>
      </div>
    </Figure>
  );
}
