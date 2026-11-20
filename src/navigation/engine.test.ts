import { describe, expect, it, vi } from 'vitest';
import type {
  CancellationLike,
  DeclarationDescriptor,
  NavigationCandidate,
  SymbolContext,
  TextDocumentLike,
} from '../contracts.js';
import { LanguageAdapterRegistry } from '../languages/registry.js';
import { NavigationEngine, type GraphNavigator } from './engine.js';

const document: TextDocumentLike = {
  uri: 'file:///repo/Caller.java', version: 2, languageId: 'java', getText: () => 'run();',
};

const baseContext: SymbolContext = {
  documentUri: document.uri, documentVersion: 2, languageId: 'java',
  position: { line: 0, character: 0 },
  tokenRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
  name: 'run', kind: 'method', role: 'invocation', argumentCount: 0, imports: [],
};

function candidate(overrides: Partial<NavigationCandidate> = {}): NavigationCandidate {
  return {
    kind: 'method', qualifiedName: 'demo.Service.run', relationship: 'CALLS',
    filePath: 'Service.java', startLine: 1, endLine: 1, signature: 'run()',
    confidence: 0.95, strategy: 'lsp', indexed: true, concrete: true, evidence: [],
    ...overrides,
  };
}

function setup(context = baseContext, graphOverrides: Partial<GraphNavigator> = {}) {
  const registry = new LanguageAdapterRegistry();
  registry.register('java', {
    getSymbolContext: vi.fn(async () => context),
    getDeclarations: vi.fn(async () => []),
    disposeDocument: vi.fn(),
  });
  const graph: GraphNavigator = {
    definitions: vi.fn(async () => [candidate()]),
    implementations: vi.fn(async () => []),
    references: vi.fn(async () => []),
    declarationRelations: vi.fn(async (_root, descriptor) => ({
      selected: descriptor,
      family: [], declarations: [], implementations: [], callers: [], references: [],
    })),
    ...graphOverrides,
  };
  const resolve = vi.fn(async (_root: string, item: NavigationCandidate) => ({
    uri: `file:///repo/${item.filePath}`,
    range: { start: { line: 0, character: 5 }, end: { line: 0, character: 8 } },
  }));
  const engine = new NavigationEngine({
    registry, graph, resolveLocation: resolve,
    resolveRoot: () => ({ root: 'C:/repo', state: 'Ready', indexKey: 'Ready:project-id' }),
    minimumDirectConfidence: 0.85,
  });
  return { engine, graph, resolve };
}

function descriptor(overrides: Partial<DeclarationDescriptor> = {}): DeclarationDescriptor {
  return {
    documentUri: document.uri,
    documentVersion: document.version,
    name: 'run',
    kind: 'method',
    tokenRange: baseContext.tokenRange,
    declarationRange: baseContext.tokenRange,
    packageName: 'demo',
    ownerName: 'Worker',
    argumentCount: 0,
    signatureHint: 'run/0',
    abstract: true,
    override: false,
    ...overrides,
  };
}

describe('NavigationEngine', () => {
  it('resolves prepared CodeLens candidates using the requested presentation mode', async () => {
    const { engine } = setup();
    await expect(engine.outcomeForCandidates(document.uri, [candidate({ filePath: 'Caller.java' })], 'peek'))
      .resolves.toMatchObject({ mode: 'peek', targets: [{ uri: 'file:///repo/Caller.java' }] });
  });

  it('peeks callers when smart navigation starts on a method declaration', async () => {
    const selected = descriptor();
    const declarationContext = { ...baseContext, role: 'declaration' as const };
    const relations = vi.fn(async () => ({
      selected,
      family: [], declarations: [], implementations: [], references: [],
      callers: [candidate({
        qualifiedName: 'demo.Worker.run', filePath: 'Caller.java', startLine: 8, endLine: 8,
      })],
    }));
    const registry = new LanguageAdapterRegistry();
    registry.register('java', {
      getSymbolContext: vi.fn(async () => declarationContext),
      getDeclarations: vi.fn(async () => [selected]),
      disposeDocument: vi.fn(),
    });
    const graph = setup(declarationContext, { declarationRelations: relations }).graph;
    const engine = new NavigationEngine({
      registry,
      graph,
      resolveLocation: async (_root, item) => ({
        uri: `file:///repo/${item.filePath}`,
        range: { start: { line: 7, character: 2 }, end: { line: 7, character: 5 } },
      }),
      resolveRoot: () => ({ root: 'C:/repo', state: 'Ready', indexKey: 'Ready:project-id' }),
      minimumDirectConfidence: 0.85,
    });

    await expect(engine.definition(document, baseContext.position)).resolves.toEqual({
      mode: 'peek',
      targets: [{
        uri: 'file:///repo/Caller.java',
        range: { start: { line: 7, character: 2 }, end: { line: 7, character: 5 } },
      }],
    });
  });

  it('peeks references when smart navigation starts on a type declaration', async () => {
    const methodDescriptor = descriptor();
    const { argumentCount: _argumentCount, signatureHint: _signatureHint, ...typeDescriptor } = methodDescriptor;
    const selected: DeclarationDescriptor = { ...typeDescriptor, name: 'Worker', kind: 'type' };
    const declarationContext: SymbolContext = {
      ...baseContext, name: 'Worker', kind: 'type', role: 'declaration',
    };
    const registry = new LanguageAdapterRegistry();
    registry.register('java', {
      getSymbolContext: vi.fn(async () => declarationContext),
      getDeclarations: vi.fn(async () => [selected]),
      disposeDocument: vi.fn(),
    });
    const graph = setup(declarationContext, {
      declarationRelations: vi.fn(async () => ({
        selected, family: [], declarations: [], implementations: [], callers: [],
        references: [candidate({
          kind: 'type', qualifiedName: 'demo.Worker', relationship: 'USAGE',
          filePath: 'TypeUser.java', startLine: 4, endLine: 4,
        })],
      })),
    }).graph;
    const engine = new NavigationEngine({
      registry,
      graph,
      resolveLocation: async (_root, item) => ({
        uri: `file:///repo/${item.filePath}`,
        range: { start: { line: 3, character: 1 }, end: { line: 3, character: 7 } },
      }),
      resolveRoot: () => ({ root: 'C:/repo', state: 'Ready', indexKey: 'Ready:project-id' }),
      minimumDirectConfidence: 0.85,
    });

    await expect(engine.definition(document, baseContext.position)).resolves.toMatchObject({
      mode: 'peek', targets: [{ uri: 'file:///repo/TypeUser.java' }],
    });
  });

  it('resolves an unsaved local declaration without querying CBM', async () => {
    const local = {
      ...baseContext,
      kind: 'local' as const,
      localDeclarationRange: { start: { line: 3, character: 8 }, end: { line: 3, character: 13 } },
    };
    const { engine, graph } = setup(local);
    await expect(engine.definition(document, { line: 0, character: 0 })).resolves.toEqual({
      mode: 'direct',
      targets: [{ uri: document.uri, range: local.localDeclarationRange }],
    });
    expect(graph.definitions).not.toHaveBeenCalled();
  });

  it('promotes one concrete implementation and peeks multiple implementations', async () => {
    const declaration = candidate({ concrete: false, relationship: 'DEFINES' });
    const first = candidate({ qualifiedName: 'demo.Fast.run', relationship: 'IMPLEMENTS' });
    const second = candidate({ qualifiedName: 'demo.Safe.run', relationship: 'IMPLEMENTS', filePath: 'Safe.java' });
    const one = setup(baseContext, {
      definitions: vi.fn(async () => [declaration]),
      implementations: vi.fn(async () => [first]),
    });
    await expect(one.engine.definition(document, { line: 0, character: 0 }))
      .resolves.toMatchObject({ mode: 'direct', targets: [{ uri: 'file:///repo/Service.java' }] });

    const many = setup(baseContext, {
      definitions: vi.fn(async () => [declaration]),
      implementations: vi.fn(async () => [first, second]),
    });
    await expect(many.engine.definition(document, { line: 0, character: 0 }))
      .resolves.toMatchObject({ mode: 'peek', targets: [{}, {}] });
  });

  it('falls back to the declaration when no implementation exists', async () => {
    const declaration = candidate({ concrete: false, relationship: 'DEFINES' });
    const { engine } = setup(baseContext, {
      definitions: vi.fn(async () => [declaration]), implementations: vi.fn(async () => []),
    });
    await expect(engine.definition(document, { line: 0, character: 0 }))
      .resolves.toMatchObject({ mode: 'direct', targets: [{ uri: 'file:///repo/Service.java' }] });
  });

  it('uses the exact declaration owner when looking up a method implementation', async () => {
    const declaration = candidate({
      concrete: false,
      relationship: 'CALLS',
      receiverType: 'demo.api.ExportService',
    });
    const implementations = vi.fn(async () => [candidate({
      qualifiedName: 'demo.web.ExportServiceImpl.run',
      relationship: 'IMPLEMENTS',
      filePath: 'web/ExportServiceImpl.java',
    })]);
    const { engine } = setup(baseContext, {
      definitions: vi.fn(async () => [declaration]),
      implementations,
    });

    await expect(engine.definition(document, { line: 0, character: 0 }))
      .resolves.toMatchObject({
        mode: 'direct',
        targets: [{ uri: 'file:///repo/web/ExportServiceImpl.java' }],
      });
    expect(implementations).toHaveBeenCalledWith(
      'C:/repo',
      expect.objectContaining({ receiverTypeHint: 'demo.api.ExportService' }),
      undefined,
    );
  });

  it('returns no result when cancelled or the root is not ready', async () => {
    const { engine, graph } = setup();
    const cancelled: CancellationLike = {
      isCancellationRequested: true,
      onCancellationRequested: () => ({ dispose() {} }),
    };
    await expect(engine.definition(document, { line: 0, character: 0 }, cancelled))
      .resolves.toEqual({ mode: 'none', targets: [] });
    expect(graph.definitions).not.toHaveBeenCalled();
  });
});
