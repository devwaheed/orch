/** Something that owns resources and releases them on `dispose()`. */
export interface IDisposable {
  dispose(): void;
}

/**
 * Wraps a cleanup function as a disposable. Only the first `dispose()` call runs `fn`.
 */
export function toDisposable(fn: () => void): IDisposable {
  let done = false;
  return {
    dispose(): void {
      if (done) {
        return;
      }
      done = true;
      fn();
    },
  };
}

/**
 * Holds disposables and disposes them in reverse order of addition (last added,
 * first disposed). Disposing twice is a no-op. Adding to an already disposed
 * store disposes the added item immediately, so nothing can leak past disposal.
 *
 * If an item throws while disposing, the rest are still disposed and the first
 * error is rethrown afterwards.
 */
export class DisposableStore implements IDisposable {
  private readonly items = new Set<IDisposable>();
  private disposed = false;

  get isDisposed(): boolean {
    return this.disposed;
  }

  add<T extends IDisposable>(item: T): T {
    if (this.disposed) {
      item.dispose();
      return item;
    }
    this.items.add(item);
    return item;
  }

  /** Removes an item without disposing it. */
  delete(item: IDisposable): void {
    this.items.delete(item);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const toDispose = Array.from(this.items).reverse();
    this.items.clear();
    disposeAll(toDispose);
  }
}

/**
 * Base class for objects that own disposables. Use `_register` to hand
 * resources to the object's store; `dispose()` releases all of them.
 */
export abstract class Disposable implements IDisposable {
  protected readonly _store = new DisposableStore();

  protected _register<T extends IDisposable>(item: T): T {
    return this._store.add(item);
  }

  dispose(): void {
    this._store.dispose();
  }
}

/** Disposes every item in order. Continues past failures, then rethrows the first. */
export function disposeAll(items: readonly IDisposable[]): void {
  let firstError: { error: unknown } | undefined;
  for (const item of items) {
    try {
      item.dispose();
    } catch (error) {
      firstError ??= { error };
    }
  }
  if (firstError) {
    throw firstError.error;
  }
}
