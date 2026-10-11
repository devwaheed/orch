/**
 * Area-local UI state for the Specs screen: which view (queue / map) is active, which
 * spec row is expanded, which spec the map has selected, and the last load result.
 *
 * Spec data itself lives in services/stores/specs.ts and is fed by queue.changed /
 * spec.changed events. UI-only state that isn't a live object lives here, mirroring
 * the Trust and Sessions areas.
 */
import { create } from 'zustand';
import type { OrchError, SpecLoadProblem } from '@orch/contracts';

export type SpecsView = 'list' | 'map';

export interface SpecsUiState {
  readonly view: SpecsView;
  /** The spec row expanded to show its done-when details, or null. */
  readonly expandedId: string | null;
  /** The spec the agent map highlights and shows the steps for. */
  readonly selectedId: string | null;
  /** Problems returned by load() (docs/specs/spec-queue.md §11). */
  readonly problems: readonly SpecLoadProblem[];
  readonly loadError: OrchError | null;
  readonly saving: boolean;
  setView(view: SpecsView): void;
  setExpandedId(id: string | null): void;
  setSelectedId(id: string | null): void;
  setProblems(problems: readonly SpecLoadProblem[]): void;
  setLoadError(error: OrchError | null): void;
  setSaving(saving: boolean): void;
}

export const useSpecsUiStore = create<SpecsUiState>()((set) => ({
  view: 'list',
  expandedId: null,
  selectedId: null,
  problems: [],
  loadError: null,
  saving: false,
  setView: (view) => set({ view }),
  setExpandedId: (expandedId) => set({ expandedId }),
  setSelectedId: (selectedId) => set({ selectedId }),
  setProblems: (problems) => set({ problems }),
  setLoadError: (loadError) => set({ loadError }),
  setSaving: (saving) => set({ saving }),
}));
