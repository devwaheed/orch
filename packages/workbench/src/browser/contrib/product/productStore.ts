import { create } from 'zustand';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import type { CoreServices } from '../../services/channelSchemas.js';

interface ProductShellState { factoryProduct: boolean; openGates: number; setProduct: (factoryProduct: boolean, openGates: number) => void }
export const useProductShellStore = create<ProductShellState>((set) => ({ factoryProduct: false, openGates: 0, setProduct: (factoryProduct, openGates) => set({ factoryProduct, openGates }) }));
let services: CoreServices | null = null;
export function bindProductServices(value: CoreServices | null): void {
  services = value;
  if (value) void refreshProductShell();
  else {
    useProductShellStore.getState().setProduct(false, 0);
    useWorkbenchStore.getState().setProductAvailable(false);
    useWorkbenchStore.getState().setBadge('product', undefined);
  }
}
export function getProductServices(): CoreServices | null { return services; }
export async function refreshProductShell(repoPath = useWorkbenchStore.getState().activeProject): Promise<void> {
  if (!services || !repoPath) { useProductShellStore.getState().setProduct(false, 0); useWorkbenchStore.getState().setProductAvailable(false); useWorkbenchStore.getState().setBadge('product', undefined); return; }
  const [pipeline, status] = await Promise.all([services.specs.factoryPipeline(repoPath), services.specs.factoryStatus(repoPath)]);
  const exists = (pipeline.ok && pipeline.value !== null) || (status.ok && status.value !== null);
  const openGates = pipeline.ok && pipeline.value ? pipeline.value.stages.filter((stage) => stage.gate && stage.state === 'needs_you').length : 0;
  if (useWorkbenchStore.getState().activeProject === repoPath) {
    useProductShellStore.getState().setProduct(exists, openGates);
    useWorkbenchStore.getState().setProductAvailable(exists);
    useWorkbenchStore.getState().setBadge('product', openGates || undefined);
  }
}

export function notifyProductChanged(repoPath: string): void {
  void refreshProductShell(repoPath);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('orch:product-changed', { detail: repoPath }));
}

