import { type IDisposable, toDisposable } from './lifecycle.js';

/** Subscribes a listener and returns the subscription, which unsubscribes on `dispose()`. */
export type Event<T> = (listener: (value: T) => void) => IDisposable;

interface Registration<T> {
  readonly listener: (value: T) => void;
  active: boolean;
}

/**
 * Fires values to its listeners.
 *
 * - Listeners are called in the order they subscribed.
 * - A listener added during `fire` is not called for that event.
 * - A listener disposed during `fire` is not called for the rest of that event.
 * - A throwing listener does not stop the others. After every listener has run,
 *   the first error is rethrown.
 * - `dispose()` removes all listeners. Later subscriptions are no-ops and `fire` does nothing.
 */
export class Emitter<T> implements IDisposable {
  private registrations: Registration<T>[] = [];
  private disposed = false;

  /** Subscribe to this emitter's values. */
  readonly event: Event<T> = (listener) => {
    if (this.disposed) {
      return toDisposable(() => undefined);
    }
    const registration: Registration<T> = { listener, active: true };
    this.registrations.push(registration);
    return toDisposable(() => {
      registration.active = false;
      this.registrations = this.registrations.filter((r) => r !== registration);
    });
  };

  fire(value: T): void {
    if (this.disposed) {
      return;
    }
    const snapshot = this.registrations.slice();
    const errors: unknown[] = [];
    for (const registration of snapshot) {
      if (!registration.active) {
        continue;
      }
      try {
        registration.listener(value);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw errors[0];
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const registration of this.registrations) {
      registration.active = false;
    }
    this.registrations = [];
  }
}
