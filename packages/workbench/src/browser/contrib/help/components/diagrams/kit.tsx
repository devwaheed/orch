import React from 'react';
import { Icon } from '../../../../../../../../design/icons/Icon.js';
import type { IconName } from '../../../../../../../../design/icons/icons.js';

export type FigureProps = {
  title: string;
  label: string;
  children: React.ReactNode;
  className?: string;
};

export function Figure({ title, label, children, className = '' }: FigureProps) {
  return (
    <figure
      role="img"
      aria-label={label}
      className={`my-5 flex w-full min-w-0 box-border flex-col gap-4 rounded-lg border border-line bg-panel p-4 ${className}`}
    >
      <figcaption className="text-sm font-semibold text-text">{title}</figcaption>
      {children}
    </figure>
  );
}

export type LaneProps = {
  title: string;
  children: React.ReactNode;
  className?: string;
};

export function Lane({ title, children, className = '' }: LaneProps) {
  return (
    <div className={`flex w-full min-w-0 box-border flex-col gap-3 rounded-lg border border-line bg-panel2 p-3 ${className}`}>
      <span className="text-xs font-semibold uppercase tracking-wider text-muted2">{title}</span>
      {children}
    </div>
  );
}

export type ChipProps = {
  children: React.ReactNode;
  icon?: IconName;
  iconClassName?: string;
  variant?: 'default' | 'mono';
  className?: string;
};

export function Chip({
  children,
  icon,
  iconClassName,
  variant = 'default',
  className = '',
}: ChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border border-line bg-panel px-2 py-1 text-xs text-text ${
        variant === 'mono' ? 'font-mono' : ''
      } ${className}`}
    >
      {icon && (
        <Icon
          name={icon}
          size={12}
          weight={2.2}
          className={iconClassName ?? 'shrink-0 text-muted'}
        />
      )}
      {children}
    </span>
  );
}

export type NodeProps = {
  icon?: IconName;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  chips?: React.ReactNode[];
  badge?: React.ReactNode;
  dashed?: boolean;
  className?: string;
  children?: React.ReactNode;
};

export function Node({
  icon,
  title,
  subtitle,
  chips,
  badge,
  dashed = false,
  className = '',
  children,
}: NodeProps) {
  return (
    <div
      className={`flex min-w-0 box-border flex-col gap-1 rounded-md border ${
        dashed ? 'border-dashed border-line bg-panel' : 'border-line bg-panel'
      } p-3 ${className}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {icon && <Icon name={icon} size={15} className="shrink-0 text-muted" />}
        {badge}
        <span className="min-w-0 break-words text-xs font-semibold text-text">{title}</span>
      </div>
      {subtitle && (
        <span className="min-w-0 break-words text-xs text-muted leading-normal">
          {subtitle}
        </span>
      )}
      {chips && chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">{chips}</div>
      )}
      {children}
    </div>
  );
}

export type StepProps = {
  number: number | string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  chips?: React.ReactNode[];
  icon?: IconName;
  className?: string;
  children?: React.ReactNode;
};

export function Step({
  number,
  title,
  subtitle,
  chips,
  icon,
  className = '',
  children,
}: StepProps) {
  return (
    <div
      className={`flex min-w-0 box-border flex-col gap-2 rounded-lg border border-line bg-panel2 p-3 ${className}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-pill border border-line bg-panel font-mono text-xs font-semibold text-text">
          {number}
        </span>
        {icon && <Icon name={icon} size={14} className="shrink-0 text-muted" />}
        <span className="min-w-0 break-words text-xs font-semibold leading-tight text-text">
          {title}
        </span>
      </div>
      {subtitle && (
        <span className="min-w-0 break-words text-xs text-muted leading-normal">
          {subtitle}
        </span>
      )}
      {chips && chips.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">{chips}</div>
      )}
      {children}
    </div>
  );
}

export type AgentTone = 'cc' | 'cx' | 'gm' | 'oc' | 'ag';

const AGENT_DATA: Record<AgentTone, { code: string; name: string; classes: string }> = {
  cc: { code: 'CC', name: 'Claude Code', classes: 'bg-cc-bg text-cc-fg' },
  cx: { code: 'CX', name: 'Codex', classes: 'bg-cx-bg text-cx-fg' },
  gm: { code: 'GM', name: 'Gemini CLI', classes: 'bg-gm-bg text-gm-fg' },
  oc: { code: 'OC', name: 'OpenCode', classes: 'bg-oc-bg text-oc-fg' },
  ag: { code: 'AG', name: 'Antigravity', classes: 'bg-ag-bg text-ag-fg' },
};

export function AgentBadge({
  tone,
  showName = true,
  className = '',
}: {
  tone: AgentTone;
  showName?: boolean;
  className?: string;
}) {
  const agent = AGENT_DATA[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border border-line bg-panel px-2 py-1 text-xs text-text ${className}`}
    >
      <span className={`rounded-xs px-1 font-mono text-xs font-semibold ${agent.classes}`}>
        {agent.code}
      </span>
      {showName && <span>{agent.name}</span>}
    </span>
  );
}

export type ArrowProps = {
  direction?: 'horizontal' | 'vertical' | 'left';
  label?: string;
  className?: string;
};

export function Arrow({
  direction = 'horizontal',
  label,
  className = '',
}: ArrowProps) {
  if (direction === 'vertical') {
    const svg = React.createElement(
      'svg',
      {
        width: 12,
        height: 24,
        viewBox: '0 0 12 24',
        fill: 'none',
        className: 'shrink-0 stroke-muted text-muted',
      },
      React.createElement('line', {
        x1: 6,
        y1: 0,
        x2: 6,
        y2: 18,
        stroke: 'currentColor',
        strokeWidth: 1.5,
      }),
      React.createElement('path', {
        d: 'M 2 14 L 6 20 L 10 14',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    );

    return (
      <div className={`flex flex-col items-center justify-center gap-1 py-1 shrink-0 ${className}`}>
        {label && (
          <span className="text-center font-mono text-xs text-muted leading-tight">
            {label}
          </span>
        )}
        {svg}
      </div>
    );
  }

  if (direction === 'left') {
    const svg = React.createElement(
      'svg',
      {
        width: 24,
        height: 12,
        viewBox: '0 0 24 12',
        fill: 'none',
        className: 'shrink-0 stroke-muted text-muted',
      },
      React.createElement('line', {
        x1: 24,
        y1: 6,
        x2: 6,
        y2: 6,
        stroke: 'currentColor',
        strokeWidth: 1.5,
      }),
      React.createElement('path', {
        d: 'M 10 2 L 4 6 L 10 10',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    );

    return (
      <div className={`flex items-center justify-center gap-2 shrink-0 ${className}`}>
        {svg}
        {label && (
          <span className="font-mono text-xs text-muted leading-tight">
            {label}
          </span>
        )}
      </div>
    );
  }

  const svg = React.createElement(
    'svg',
    {
      width: 24,
      height: 12,
      viewBox: '0 0 24 12',
      fill: 'none',
      className: 'shrink-0 stroke-muted text-muted',
    },
    React.createElement('line', {
      x1: 0,
      y1: 6,
      x2: 18,
      y2: 6,
      stroke: 'currentColor',
      strokeWidth: 1.5,
    }),
    React.createElement('path', {
      d: 'M 14 2 L 20 6 L 14 10',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  );

  return (
    <div className={`flex flex-col items-center justify-center shrink-0 ${className}`}>
      {label && (
        <span className="mb-1 font-mono text-xs text-muted leading-tight">
          {label}
        </span>
      )}
      {svg}
    </div>
  );
}

export function FanOut({ className = '' }: { className?: string }) {
  const svg = React.createElement(
    'svg',
    {
      viewBox: '0 0 300 32',
      fill: 'none',
      className: 'w-full max-w-[480px] stroke-muted text-muted',
    },
    // Middle line (Work)
    React.createElement('line', {
      x1: 150,
      y1: 0,
      x2: 150,
      y2: 24,
      stroke: 'currentColor',
      strokeWidth: 1.5,
    }),
    React.createElement('path', {
      d: 'M 146 20 L 150 26 L 154 20',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
    // Left curve (Personal)
    React.createElement('path', {
      d: 'M 150 0 C 150 14, 50 10, 50 24',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
    React.createElement('path', {
      d: 'M 46 20 L 50 26 L 54 20',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
    // Right curve (Team)
    React.createElement('path', {
      d: 'M 150 0 C 150 14, 250 10, 250 24',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
    React.createElement('path', {
      d: 'M 246 20 L 250 26 L 254 20',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  );

  return (
    <div className={`flex w-full justify-center py-1 ${className}`}>
      {svg}
    </div>
  );
}
