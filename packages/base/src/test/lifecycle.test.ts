import { describe, expect, it } from 'vitest';
import { Disposable, DisposableStore, disposeAll, toDisposable } from '../common/index.js';

describe('DisposableStore', () => {
  it('disposes items in reverse order of addition', () => {
    const order: string[] = [];
    const store = new DisposableStore();
    store.add(toDisposable(() => order.push('a')));
    store.add(toDisposable(() => order.push('b')));
    store.add(toDisposable(() => order.push('c')));
    store.dispose();
    expect(order).toEqual(['c', 'b', 'a']);
  });

  it('disposes each item only once when disposed twice', () => {
    let count = 0;
    const store = new DisposableStore();
    store.add(toDisposable(() => count++));
    store.dispose();
    store.dispose();
    expect(count).toBe(1);
    expect(store.isDisposed).toBe(true);
  });

  it('disposes an item added after the store was disposed, immediately', () => {
    let disposed = false;
    const store = new DisposableStore();
    store.dispose();
    store.add(toDisposable(() => (disposed = true)));
    expect(disposed).toBe(true);
  });

  it('does not dispose an item that was deleted from the store', () => {
    let disposed = false;
    const store = new DisposableStore();
    const item = store.add(toDisposable(() => (disposed = true)));
    store.delete(item);
    store.dispose();
    expect(disposed).toBe(false);
  });

  it('keeps disposing the rest when one item throws, then rethrows the first error', () => {
    const order: string[] = [];
    const store = new DisposableStore();
    store.add(toDisposable(() => order.push('first')));
    store.add(
      toDisposable(() => {
        throw new Error('boom');
      }),
    );
    store.add(toDisposable(() => order.push('last')));
    expect(() => store.dispose()).toThrow('boom');
    expect(order).toEqual(['last', 'first']);
  });
});

describe('toDisposable', () => {
  it('runs its cleanup only once', () => {
    let count = 0;
    const d = toDisposable(() => count++);
    d.dispose();
    d.dispose();
    expect(count).toBe(1);
  });
});

describe('Disposable', () => {
  it('disposes everything registered through _register, in reverse order', () => {
    const order: string[] = [];
    class Owner extends Disposable {
      constructor() {
        super();
        this._register(toDisposable(() => order.push('one')));
        this._register(toDisposable(() => order.push('two')));
      }
    }
    new Owner().dispose();
    expect(order).toEqual(['two', 'one']);
  });
});

describe('disposeAll', () => {
  it('disposes in the given order and rethrows the first error', () => {
    const order: string[] = [];
    expect(() =>
      disposeAll([
        toDisposable(() => {
          throw new Error('first');
        }),
        toDisposable(() => {
          throw new Error('second');
        }),
        toDisposable(() => order.push('third')),
      ]),
    ).toThrow('first');
    expect(order).toEqual(['third']);
  });
});
