import type {
  CancellationLike,
  DeclarationDescriptor,
  DeclarationRelationBundle,
  NavigationCandidate,
  Position,
  Range,
  RootStateKind,
  SymbolContext,
  TextDocumentLike,
} from '../contracts.js';
import type { LanguageAdapterRegistry } from '../languages/registry.js';
import { rankCandidates } from './ranker.js';
import { DeclarationRelationCache } from './declarationCache.js';
import type { LocationTarget } from './results.js';
import { normalizeLocations } from './results.js';

export interface GraphNavigator {
  definitions(root: string, context: SymbolContext, signal?: AbortSignal): Promise<NavigationCandidate[]>;
  implementations(root: string, context: SymbolContext, signal?: AbortSignal): Promise<NavigationCandidate[]>;
  references(root: string, context: SymbolContext, signal?: AbortSignal): Promise<NavigationCandidate[]>;
  declarationRelations(
    root: string,
    descriptor: DeclarationDescriptor,
    signal?: AbortSignal,
  ): Promise<DeclarationRelationBundle>;
}

export interface RootResolution {
  readonly root: string;
  readonly state: RootStateKind;
  readonly indexKey: string;
}

export interface NavigationEngineOptions {
  readonly registry: LanguageAdapterRegistry;
  readonly graph: GraphNavigator;
  readonly resolveLocation: (
    root: string,
    candidate: NavigationCandidate,
  ) => Promise<LocationTarget | undefined>;
  readonly resolveRoot: (documentUri: string) => RootResolution | undefined;
  readonly minimumDirectConfidence: number;
}

export interface NavigationOutcome {
  readonly mode: 'direct' | 'peek' | 'none';
  readonly targets: readonly LocationTarget[];
}

const NONE: NavigationOutcome = { mode: 'none', targets: [] };

function emptyRelations(selected: DeclarationDescriptor): DeclarationRelationBundle {
  return { selected, family: [], declarations: [], implementations: [], callers: [], references: [] };
}

function sameRange(left: Range, right: Range): boolean {
  return left.start.line === right.start.line
    && left.start.character === right.start.character
    && left.end.line === right.end.line
    && left.end.character === right.end.character;
}

function abortSignal(cancellation?: CancellationLike): {
  readonly signal?: AbortSignal;
  readonly dispose: () => void;
} {
  if (!cancellation) return { dispose() {} };
  const controller = new AbortController();
  if (cancellation.isCancellationRequested) controller.abort();
  const subscription = cancellation.onCancellationRequested(() => controller.abort());
  return { signal: controller.signal, dispose: () => subscription.dispose() };
}

export class NavigationEngine {
  readonly #relations = new DeclarationRelationCache();

  constructor(readonly options: NavigationEngineOptions) {}

  async #context(
    document: TextDocumentLike,
    position: Position,
    cancellation?: CancellationLike,
  ): Promise<SymbolContext | undefined> {
    return this.options.registry.get(document.languageId)
      ?.getSymbolContext(document, position, cancellation);
  }

  async #resolve(
    root: string,
    candidates: readonly NavigationCandidate[],
  ): Promise<LocationTarget[]> {
    const targets = await Promise.all(
      candidates.map((candidate) => this.options.resolveLocation(root, candidate)),
    );
    return normalizeLocations(targets.filter((target): target is LocationTarget => Boolean(target)));
  }

  #rank(context: SymbolContext, candidates: readonly NavigationCandidate[]) {
    return rankCandidates(context, candidates, {
      minimumDirectConfidence: this.options.minimumDirectConfidence,
    });
  }

  async #declarationAt(
    document: TextDocumentLike,
    range: Range,
    cancellation?: CancellationLike,
  ): Promise<DeclarationDescriptor | undefined> {
    const adapter = this.options.registry.get(document.languageId);
    const declarations = await adapter?.getDeclarations?.(document, cancellation) ?? [];
    return declarations.find((item) => sameRange(item.tokenRange, range));
  }

  async #relationsFor(
    root: RootResolution,
    descriptor: DeclarationDescriptor,
    cancellation?: CancellationLike,
  ): Promise<DeclarationRelationBundle> {
    const abort = abortSignal(cancellation);
    try {
      return await this.#relations.getOrCreate({
        root: root.root,
        indexKey: root.indexKey,
        documentUri: descriptor.documentUri,
        documentVersion: descriptor.documentVersion,
        tokenRange: descriptor.tokenRange,
      }, () => this.options.graph.declarationRelations(root.root, descriptor, abort.signal));
    } finally {
      abort.dispose();
    }
  }

  async declarationRelations(
    document: TextDocumentLike,
    descriptor: DeclarationDescriptor,
    cancellation?: CancellationLike,
  ): Promise<DeclarationRelationBundle> {
    if (descriptor.documentVersion !== document.version || cancellation?.isCancellationRequested) {
      return emptyRelations(descriptor);
    }
    const root = this.options.resolveRoot(document.uri);
    if (!root || root.state !== 'Ready') return emptyRelations(descriptor);
    return this.#relationsFor(root, descriptor, cancellation);
  }

  async outcomeForCandidates(
    documentUri: string,
    candidates: readonly NavigationCandidate[],
    requestedMode: 'direct' | 'peek',
  ): Promise<NavigationOutcome> {
    const root = this.options.resolveRoot(documentUri);
    if (!root || root.state !== 'Ready' || candidates.length === 0) return NONE;
    const targets = await this.#resolve(root.root, candidates);
    if (targets.length === 0) return NONE;
    return {
      mode: requestedMode === 'direct' && targets.length === 1 ? 'direct' : 'peek',
      targets,
    };
  }

  invalidateDocument(documentUri: string): void {
    this.#relations.invalidateDocument(documentUri);
  }

  invalidateRoot(root: string): void {
    this.#relations.invalidateRoot(root);
  }

  dispose(): void {
    this.#relations.clear();
  }

  async definition(
    document: TextDocumentLike,
    position: Position,
    cancellation?: CancellationLike,
  ): Promise<NavigationOutcome> {
    if (cancellation?.isCancellationRequested) return NONE;
    const context = await this.#context(document, position, cancellation);
    if (!context || cancellation?.isCancellationRequested) return NONE;
    if (context.localDeclarationRange) {
      return { mode: 'direct', targets: [{ uri: document.uri, range: context.localDeclarationRange }] };
    }
    const root = this.options.resolveRoot(document.uri);
    if (!root || root.state !== 'Ready') return NONE;
    if (context.role === 'declaration'
        && ['type', 'method', 'constructor', 'field'].includes(context.kind)) {
      const descriptor = await this.#declarationAt(document, context.tokenRange, cancellation);
      if (!descriptor || cancellation?.isCancellationRequested) return NONE;
      const bundle = await this.#relationsFor(root, descriptor, cancellation);
      const related = context.kind === 'method' || context.kind === 'constructor'
        ? bundle.callers
        : bundle.references;
      const candidates = this.#rank(context, related).filter((candidate) => candidate.tier <= 2);
      const targets = await this.#resolve(root.root, candidates);
      return targets.length > 0 ? { mode: 'peek', targets } : NONE;
    }
    const abort = abortSignal(cancellation);
    try {
      const declarations = this.#rank(
        context,
        await this.options.graph.definitions(root.root, context, abort.signal),
      ).filter((candidate) => candidate.tier <= 2);
      if (abort.signal?.aborted || declarations.length === 0) return NONE;
      const best = declarations[0];
      if (best && best.concrete === false) {
        const implementationContext = best.receiverType
          ? { ...context, receiverTypeHint: best.receiverType }
          : context;
        const implementations = this.#rank(
          context,
          await this.options.graph.implementations(root.root, implementationContext, abort.signal),
        ).filter((candidate) => candidate.tier <= 2 && candidate.concrete !== false);
        const implementationTargets = await this.#resolve(root.root, implementations);
        if (implementationTargets.length === 1) return { mode: 'direct', targets: implementationTargets };
        if (implementationTargets.length > 1) return { mode: 'peek', targets: implementationTargets };
      }
      const targets = await this.#resolve(root.root, declarations);
      if (targets.length === 1) return { mode: 'direct', targets };
      return targets.length > 1 ? { mode: 'peek', targets } : NONE;
    } finally {
      abort.dispose();
    }
  }

  async declaration(
    document: TextDocumentLike,
    position: Position,
    cancellation?: CancellationLike,
  ): Promise<NavigationOutcome> {
    return this.#graphOutcome('definitions', document, position, cancellation);
  }

  async implementations(
    document: TextDocumentLike,
    position: Position,
    cancellation?: CancellationLike,
  ): Promise<NavigationOutcome> {
    return this.#graphOutcome('implementations', document, position, cancellation);
  }

  async references(
    document: TextDocumentLike,
    position: Position,
    cancellation?: CancellationLike,
  ): Promise<NavigationOutcome> {
    return this.#graphOutcome('references', document, position, cancellation);
  }

  async #graphOutcome(
    operation: 'definitions' | 'implementations' | 'references',
    document: TextDocumentLike,
    position: Position,
    cancellation?: CancellationLike,
  ): Promise<NavigationOutcome> {
    if (cancellation?.isCancellationRequested) return NONE;
    const context = await this.#context(document, position, cancellation);
    const root = this.options.resolveRoot(document.uri);
    if (!context || !root || root.state !== 'Ready') return NONE;
    const abort = abortSignal(cancellation);
    try {
      const ranked = this.#rank(
        context,
        await this.options.graph[operation](root.root, context, abort.signal),
      ).filter((candidate) => candidate.tier <= 2);
      if (abort.signal?.aborted) return NONE;
      const targets = await this.#resolve(root.root, ranked);
      if (targets.length === 0) return NONE;
      return { mode: targets.length === 1 ? 'direct' : 'peek', targets };
    } finally {
      abort.dispose();
    }
  }
}
