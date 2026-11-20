import type { LanguageAdapter } from '../contracts.js';

export class LanguageAdapterRegistry {
  readonly #adapters = new Map<string, LanguageAdapter>();

  register(languageId: string, adapter: LanguageAdapter): { dispose(): void } {
    this.#adapters.set(languageId, adapter);
    return { dispose: () => this.#adapters.delete(languageId) };
  }

  get(languageId: string): LanguageAdapter | undefined {
    return this.#adapters.get(languageId);
  }
}
