import { describe, expect, it } from 'vitest';
import { Emitter } from '../common/index.js';

describe('Emitter', () => {
  it('delivers each value to every listener in subscription order', () => {
    const emitter = new Emitter<number>();
    const calls: string[] = [];
    emitter.event((v) => calls.push(`a:${v}`));
    emitter.event((v) => calls.push(`b:${v}`));
    emitter.fire(1);
    emitter.fire(2);
    expect(calls).toEqual(['a:1', 'b:1', 'a:2', 'b:2']);
  });

  it('stops delivering to a listener after its subscription is disposed', () => {
    const emitter = new Emitter<string>();
    const seen: string[] = [];
    const subscription = emitter.event((v) => seen.push(v));
    emitter.fire('before');
    subscription.dispose();
    emitter.fire('after');
    expect(seen).toEqual(['before']);
  });

  it('does not call a listener added during fire for that same event', () => {
    const emitter = new Emitter<number>();
    const seen: string[] = [];
    emitter.event(() => {
      seen.push('outer');
      emitter.event(() => seen.push('late'));
    });
    emitter.fire(1);
    expect(seen).toEqual(['outer']);
    emitter.fire(2);
    expect(seen).toEqual(['outer', 'outer', 'late']);
  });

  it('does not call a listener disposed during fire, later in the same event', () => {
    const emitter = new Emitter<number>();
    const seen: string[] = [];
    emitter.event(() => {
      seen.push('first');
      second.dispose();
    });
    const second = emitter.event(() => seen.push('second'));
    emitter.fire(1);
    expect(seen).toEqual(['first']);
  });

  it('keeps delivering to other listeners when one throws, then rethrows the first error', () => {
    const emitter = new Emitter<number>();
    const seen: string[] = [];
    emitter.event(() => {
      throw new Error('first failure');
    });
    emitter.event(() => seen.push('still called'));
    emitter.event(() => {
      throw new Error('second failure');
    });
    expect(() => emitter.fire(1)).toThrow('first failure');
    expect(seen).toEqual(['still called']);
  });

  it('dispose removes all listeners and makes later fires and subscriptions inert', () => {
    const emitter = new Emitter<number>();
    const seen: number[] = [];
    emitter.event((v) => seen.push(v));
    emitter.dispose();
    emitter.fire(1);
    const late = emitter.event((v) => seen.push(v));
    emitter.fire(2);
    late.dispose();
    expect(seen).toEqual([]);
  });
});
