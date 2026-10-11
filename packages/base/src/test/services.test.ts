import { describe, expect, it } from 'vitest';
import { ServiceCollection, createServiceId } from '../common/index.js';

interface IStore {
  readonly kind: 'store';
}
interface IAccounts {
  readonly kind: 'accounts';
}
interface IQuota {
  readonly kind: 'quota';
  readonly store: IStore;
  readonly accounts: IAccounts;
}

const IStoreService = createServiceId<IStore>('store');
const IAccountsService = createServiceId<IAccounts>('accounts');
const IQuotaService = createServiceId<IQuota>('quota');

class Store implements IStore {
  readonly kind = 'store' as const;
}
class Accounts implements IAccounts {
  readonly kind = 'accounts' as const;
}
class Quota implements IQuota {
  readonly kind = 'quota' as const;
  constructor(
    readonly accounts: IAccounts,
    readonly store: IStore,
  ) {}
}

describe('ServiceCollection', () => {
  it('creates a service with its dependencies passed in the registered order', () => {
    const services = new ServiceCollection();
    services.register(IStoreService, Store, []);
    services.register(IAccountsService, Accounts, []);
    services.register(IQuotaService, Quota, [IAccountsService, IStoreService]);

    const quota = services.get(IQuotaService);
    expect(quota.accounts).toBeInstanceOf(Accounts);
    expect(quota.store).toBeInstanceOf(Store);
  });

  it('returns the same instance every time (singleton lifetime)', () => {
    const services = new ServiceCollection();
    services.register(IStoreService, Store, []);
    services.register(IAccountsService, Accounts, []);
    services.register(IQuotaService, Quota, [IAccountsService, IStoreService]);

    expect(services.get(IQuotaService)).toBe(services.get(IQuotaService));
    expect(services.get(IStoreService)).toBe(services.get(IStoreService));
  });

  it('shares one dependency instance between every service that uses it', () => {
    const services = new ServiceCollection();
    services.register(IStoreService, Store, []);
    services.register(IAccountsService, Accounts, []);
    services.register(IQuotaService, Quota, [IAccountsService, IStoreService]);

    expect(services.get(IQuotaService).store).toBe(services.get(IStoreService));
  });

  it('does not create a service until it is requested', () => {
    let created = 0;
    class Counted extends Store {
      constructor() {
        super();
        created++;
      }
    }
    const services = new ServiceCollection();
    services.register(IStoreService, Counted, []);
    expect(created).toBe(0);
    services.get(IStoreService);
    expect(created).toBe(1);
  });

  it('names the cycle path when services depend on each other', () => {
    interface IA {
      readonly a: true;
    }
    interface IB {
      readonly b: true;
    }
    const IA_ = createServiceId<IA>('a');
    const IB_ = createServiceId<IB>('b');
    class A implements IA {
      readonly a = true as const;
      constructor(readonly b: IB) {}
    }
    class B implements IB {
      readonly b = true as const;
      constructor(readonly a: IA) {}
    }
    const services = new ServiceCollection();
    services.register(IA_, A, [IB_]);
    services.register(IB_, B, [IA_]);
    expect(() => services.get(IA_)).toThrow('Service cycle: a -> b -> a');
  });

  it('names the full cycle path, not just the entry point', () => {
    interface IX {
      readonly x: true;
    }
    const IX_ = createServiceId<IX>('x');
    const IY = createServiceId<IX>('y');
    const IZ = createServiceId<IX>('z');
    class Node implements IX {
      readonly x = true as const;
    }
    const services = new ServiceCollection();
    services.register(IX_, Node, [IY]);
    services.register(IY, Node, [IZ]);
    services.register(IZ, Node, [IY]);
    expect(() => services.get(IX_)).toThrow('Service cycle: y -> z -> y');
  });

  it('throws a clear error when a service is not registered', () => {
    const services = new ServiceCollection();
    expect(() => services.get(IStoreService)).toThrow('No service registered for: store');
  });

  it('throws when a dependency is not registered', () => {
    const services = new ServiceCollection();
    services.register(IQuotaService, Quota, [IAccountsService, IStoreService]);
    expect(() => services.get(IQuotaService)).toThrow('No service registered for: accounts');
  });

  it('throws when the same id is registered twice', () => {
    const services = new ServiceCollection();
    services.register(IStoreService, Store, []);
    expect(() => services.register(IStoreService, Store, [])).toThrow(
      'Service already registered: store',
    );
  });
});
