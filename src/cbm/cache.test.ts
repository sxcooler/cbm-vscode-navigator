import { describe, expect, it, vi } from 'vitest';
import { SharedPromiseCache } from './cache.js';

describe('SharedPromiseCache', () => {
  it('shares identical in-flight work and invalidates by revision', async () => {
    let resolve!: (value: number) => void;
    const loader = vi.fn(() => new Promise<number>((done) => { resolve = done; }));
    const cache = new SharedPromiseCache<number>();

    const first = cache.getOrCreate('root', 'r1', 'query', loader);
    const second = cache.getOrCreate('root', 'r1', 'query', loader);
    expect(loader).toHaveBeenCalledTimes(1);
    resolve(7);
    await expect(Promise.all([first, second])).resolves.toEqual([7, 7]);

    cache.invalidateRoot('root');
    await cache.getOrCreate('root', 'r2', 'query', async () => 8);
    expect(cache.size).toBe(1);
  });

  it('does not retain rejected promises', async () => {
    const cache = new SharedPromiseCache<number>();
    await expect(cache.getOrCreate('root', 'r1', 'q', async () => { throw new Error('no'); }))
      .rejects.toThrow('no');
    expect(cache.size).toBe(0);
  });
});
