/**
 * Typed identifier for a service. `T` is the service interface; it exists only
 * at the type level, so `serviceName` is the only runtime data. Name is used in errors.
 */
export interface ServiceId<T> {
  readonly serviceName: string;
  /** Type-only marker. Never set at runtime. */
  readonly serviceType?: T;
}

export function createServiceId<T>(name: string): ServiceId<T> {
  return { serviceName: name } as ServiceId<T>;
}

/** Maps a tuple of service ids to the tuple of service types they resolve to. */
export type ServiceTypes<Ids extends readonly ServiceId<unknown>[]> = {
  [K in keyof Ids]: Ids[K] extends ServiceId<infer U> ? U : never;
};

type AnyConstructor = new (...args: never[]) => unknown;

interface Registration {
  readonly ctor: AnyConstructor;
  readonly deps: readonly ServiceId<unknown>[];
}

/**
 * Registers services with explicit dependency lists and creates them on demand.
 *
 * - `register(id, Ctor, [depIds])` checks at compile time that `Ctor` accepts the
 *   dependencies' types, in order.
 * - `get(id)` creates the service on first use and returns the same instance after
 *   that (singleton). Dependencies are created first and passed to the constructor in order.
 * - A dependency cycle throws `Service cycle: a -> b -> a`, naming the path.
 * - Asking for an unregistered service throws. Registering the same id twice throws.
 */
export class ServiceCollection {
  private readonly registrations = new Map<ServiceId<unknown>, Registration>();
  private readonly instances = new Map<ServiceId<unknown>, unknown>();

  register<T, Deps extends ServiceId<unknown>[]>(
    id: ServiceId<T>,
    ctor: new (...args: ServiceTypes<Deps>) => T,
    deps: [...Deps],
  ): void {
    if (this.registrations.has(id)) {
      throw new Error(`Service already registered: ${id.serviceName}`);
    }
    this.registrations.set(id, { ctor, deps: [...deps] });
  }

  get<T>(id: ServiceId<T>): T {
    return this.resolve(id, []) as T;
  }

  private resolve(id: ServiceId<unknown>, stack: ServiceId<unknown>[]): unknown {
    if (this.instances.has(id)) {
      return this.instances.get(id);
    }
    const registration = this.registrations.get(id);
    if (!registration) {
      throw new Error(`No service registered for: ${id.serviceName}`);
    }
    const cycleStart = stack.indexOf(id);
    if (cycleStart !== -1) {
      const path = [...stack.slice(cycleStart), id].map((s) => s.serviceName);
      throw new Error(`Service cycle: ${path.join(' -> ')}`);
    }

    stack.push(id);
    try {
      const args = registration.deps.map((dep) => this.resolve(dep, stack));
      const Ctor = registration.ctor as new (...args: unknown[]) => unknown;
      const instance = new Ctor(...args);
      this.instances.set(id, instance);
      return instance;
    } finally {
      stack.pop();
    }
  }
}
