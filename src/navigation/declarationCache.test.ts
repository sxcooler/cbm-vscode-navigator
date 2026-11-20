import { describe, expect, it, vi } from 'vitest';
import type { DeclarationRelationBundle } from '../contracts.js';
import { DeclarationRelationCache, type DeclarationRelationKey } from './declarationCache.js';

const key: DeclarationRelationKey = {
  root: 'C:/repo',
  indexKey: 'Ready:project-id',
  documentUri: 'file:///repo/Worker.java',
  documentVersion: 3,
  tokenRange: { start: { line: 1, character: 7 }, end: { line: 1, character: 10 } },
};

const bundle = { callers: [] } as unknown as DeclarationRelationBundle;

describe('DeclarationRelationCache', () => {
  it('shares identical work but separates document versions and token ranges', async () => {
    const cache = new DeclarationRelationCache();
    const loader = vi.fn(async () => bundle);

    await Promise.all([
      cache.getOrCreate(key, loader),
      cache.getOrCreate(key, loader),
    ]);
    expect(loader).toHaveBeenCalledTimes(1);

    await cache.getOrCreate({ ...key, documentVersion: 4 }, loader);
    await cache.getOrCreate({
      ...key,
      tokenRange: { start: { line: 2, character: 7 }, end: { line: 2, character: 10 } },
    }, loader);
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('invalidates by document and root and does not retain rejection', async () => {
    const cache = new DeclarationRelationCache();
    const loader = vi.fn(async () => bundle);
    await cache.getOrCreate(key, loader);
    cache.invalidateDocument(key.documentUri);
    await cache.getOrCreate(key, loader);
    cache.invalidateRoot(key.root);
    await cache.getOrCreate(key, loader);
    expect(loader).toHaveBeenCalledTimes(3);

    await expect(cache.getOrCreate(
      { ...key, indexKey: 'Ready:new-index' },
      async () => { throw new Error('query failed'); },
    )).rejects.toThrow('query failed');
    expect(cache.size).toBe(1);
  });
});
