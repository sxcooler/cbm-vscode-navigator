import type { DeclarationRelationBundle, Range } from '../contracts.js';

export interface DeclarationRelationKey {
  readonly root: string;
  readonly indexKey: string;
  readonly documentUri: string;
  readonly documentVersion: number;
  readonly tokenRange: Range;
}

function cacheKey(key: DeclarationRelationKey): string {
  return JSON.stringify([
    key.root,
    key.indexKey,
    key.documentUri,
    key.documentVersion,
    key.tokenRange.start.line,
    key.tokenRange.start.character,
    key.tokenRange.end.line,
    key.tokenRange.end.character,
  ]);
}

export class DeclarationRelationCache {
  readonly #entries = new Map<string, {
    readonly key: DeclarationRelationKey;
    readonly promise: Promise<DeclarationRelationBundle>;
  }>();

  get size(): number {
    return this.#entries.size;
  }

  getOrCreate(
    key: DeclarationRelationKey,
    loader: () => Promise<DeclarationRelationBundle>,
  ): Promise<DeclarationRelationBundle> {
    const identity = cacheKey(key);
    const existing = this.#entries.get(identity);
    if (existing) return existing.promise;
    const promise = loader();
    this.#entries.set(identity, { key, promise });
    void promise.catch(() => {
      if (this.#entries.get(identity)?.promise === promise) this.#entries.delete(identity);
    });
    return promise;
  }

  invalidateDocument(documentUri: string): void {
    for (const [identity, entry] of this.#entries) {
      if (entry.key.documentUri === documentUri) this.#entries.delete(identity);
    }
  }

  invalidateRoot(root: string): void {
    for (const [identity, entry] of this.#entries) {
      if (entry.key.root === root) this.#entries.delete(identity);
    }
  }

  clear(): void {
    this.#entries.clear();
  }
}
