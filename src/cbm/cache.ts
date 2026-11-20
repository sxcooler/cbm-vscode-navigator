export class SharedPromiseCache<T> {
  readonly #entries = new Map<string, Promise<T>>();

  get size(): number {
    return this.#entries.size;
  }

  getOrCreate(
    root: string,
    revision: string,
    queryIdentity: string,
    loader: () => Promise<T>,
  ): Promise<T> {
    const key = JSON.stringify([root, revision, queryIdentity]);
    const existing = this.#entries.get(key);
    if (existing) return existing;
    const promise = loader();
    this.#entries.set(key, promise);
    void promise.catch(() => {
      if (this.#entries.get(key) === promise) this.#entries.delete(key);
    });
    return promise;
  }

  invalidateRoot(root: string): void {
    for (const key of this.#entries.keys()) {
      const parsed = JSON.parse(key) as [string, string, string];
      if (parsed[0] === root) this.#entries.delete(key);
    }
  }

  clear(): void {
    this.#entries.clear();
  }
}
