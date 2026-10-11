import { describe, expect, it } from 'vitest';
import { ServiceCollection, createServiceId } from '../common/index.js';

interface IStore {
  readonly kind: 'store';
}
interface IAccounts {
  readonly kind: 'accounts';
}
const IStoreService = createServiceId<IStore>('store');
const IAccountsService = createServiceId<IAccounts>('accounts');

class Accounts implements IAccounts {
  readonly kind = 'accounts' as const;
  constructor(readonly store: IStore) {}
}

describe('ServiceCollection typing', () => {
  it('accepts constructors whose parameters match the dependency ids in order', () => {
    const services = new ServiceCollection();
    services.register(IStoreService, class implements IStore {
      readonly kind = 'store' as const;
    }, []);
    services.register(IAccountsService, Accounts, [IStoreService]);
    expect(services.get(IAccountsService).kind).toBe('accounts');
  });
});
