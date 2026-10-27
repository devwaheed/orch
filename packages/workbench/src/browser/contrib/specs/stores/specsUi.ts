/**
 * Area-local UI state for the Specs screen: which view (queue / map / plan) is active, which
 * spec row is expanded, which spec the map has selected, and the last load result.
 *
 * Spec data itself lives in services/stores/specs.ts and is fed by queue.changed /
 * spec.changed events. UI-only state that isn't a live object lives here, mirroring
 * the Trust and Sessions areas.
 */
import { create } from 'zustand';
import type { OrchError, SpecLoadProblem } from '@orchagents/contracts';

export type SpecsView = 'list' | 'map' | 'plan';

/** Which Plan graph decorations are drawn. All on by default. */
export interface PlanLayers {
  readonly wires: boolean;
  readonly waves: boolean;
  readonly agents: boolean;
  /** Off: shipped specs show only where an open spec depends on them. */
  readonly shipped: boolean;
}

export type PlanLayerKey = keyof PlanLayers;

export interface SpecsUiState {
  readonly view: SpecsView;
  /** The spec row expanded to show its done-when details, or null. */
  readonly expandedId: string | null;
  /** The spec the agent map and the Plan view highlight. */
  readonly selectedId: string | null;
  /** The Plan list's id/title search. */
  readonly planSearch: string;
  /** Dim everything outside the selected spec's ancestors and descendants. */
  readonly affectedOnly: boolean;
  readonly layers: PlanLayers;
  /** Problems returned by load() (docs/specs/spec-queue.md §11). */
  readonly problems: readonly SpecLoadProblem[];
  readonly loadError: OrchError | null;
  readonly saving: boolean;
  setView(view: SpecsView): void;
  setExpandedId(id: string | null): void;
  setSelectedId(id: string | null): void;
  setPlanSearch(search: string): void;
  setAffectedOnly(affectedOnly: boolean): void;
  setLayer(layer: PlanLayerKey, on: boolean): void;
  setProblems(problems: readonly SpecLoadProblem[]): void;
  setLoadError(error: OrchError | null): void;
  setSaving(saving: boolean): void;
}

export const useSpecsUiStore = create<SpecsUiState>()((set) => ({
  view: 'list',
  expandedId: '42',
  selectedId: '42',
  planSearch: '',
  affectedOnly: false,
  layers: { wires: true, waves: true, agents: true, shipped: false },
  problems: [],
  loadError: null,
  saving: false,
  setView: (view) => set({ view }),
  setExpandedId: (expandedId) => set({ expandedId }),
  setSelectedId: (selectedId) => set({ selectedId }),
  setPlanSearch: (planSearch) => set({ planSearch }),
  setAffectedOnly: (affectedOnly) => set({ affectedOnly }),
  setLayer: (layer, on) => set((state) => ({ layers: { ...state.layers, [layer]: on } })),
  setProblems: (problems) => set({ problems }),
  setLoadError: (loadError) => set({ loadError }),
  setSaving: (saving) => set({ saving }),
}));
