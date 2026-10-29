import type { IDisposable } from '@orchagents/base';
import { workbenchRegistry } from '../../services/registry.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import { ProductScreen } from './ProductScreen.js';
import { refreshProductShell } from './productStore.js';

export function registerProductContribution(): IDisposable[] {
  const route = workbenchRegistry.registerRoute({ id: 'product', path: '/product', title: 'Product', component: ProductScreen });
  const wizard = workbenchRegistry.registerRoute({ id: 'product-new', path: '/product/new', title: 'New product', component: ProductScreen });
  const command = workbenchRegistry.registerCommand({ id: 'product.new', title: 'New product', icon: 'plus', order: 1, category: 'New', action: () => useWorkbenchStore.getState().setActiveRoute('/product/new') });
  const projectSubscription = useWorkbenchStore.subscribe((state, previous) => {
    if (state.activeProject !== previous.activeProject) void refreshProductShell(state.activeProject);
  });
  return [route, wizard, command, { dispose: () => projectSubscription() }];
}

export function productIsAvailable(): boolean { return useWorkbenchStore.getState().productAvailable; }
