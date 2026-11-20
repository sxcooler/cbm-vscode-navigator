import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RootManager } from './rootManager.js';
import { McpGraphNavigator, normalizeCandidates } from './graphAdapter.js';

const root = resolve('fixture-repo');
const context = {
  documentUri: pathToFileURL(join(root, 'A.java')).toString(), documentVersion: 1, languageId: 'java',
  position: { line: 2, character: 5 },
  tokenRange: { start: { line: 2, character: 5 }, end: { line: 2, character: 8 } },
  name: 'run', kind: 'method' as const, role: 'invocation' as const,
  receiverTypeHint: 'demo.Service', argumentCount: 0, imports: [],
};

const declarationDescriptor = {
  documentUri: pathToFileURL(join(root, 'src', 'Worker.java')).toString(),
  documentVersion: 1,
  name: 'run',
  kind: 'method' as const,
  tokenRange: context.tokenRange,
  declarationRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 20 } },
  packageName: 'demo',
  ownerName: 'Worker',
  argumentCount: 1,
  signatureHint: 'run/1',
  abstract: true,
  override: false,
};

describe('normalizeCandidates', () => {
  it('normalizes CBM column rows without leaking transport shapes', () => {
    const result = normalizeCandidates({
      structuredContent: {
        cols: ['qn', 'label', 'file', 'lines', 'signature', 'confidence', 'strategy'],
        rows: [['demo.Service.run', 'Method', 'src/Service.java', '10-12', 'run()', 0.96, 'lsp']],
      },
    }, 'DEFINES');
    expect(result).toEqual([{
      kind: 'method', qualifiedName: 'demo.Service.run', relationship: 'DEFINES',
      filePath: 'src/Service.java', startLine: 10, endLine: 12, signature: 'run()',
      confidence: 0.96, strategy: 'lsp', indexed: true, excluded: false,
      evidence: ['DEFINES'],
    }]);
  });

  it('normalizes grouped search_graph JSON responses', () => {
    const result = normalizeCandidates({
      structuredContent: {
        cols: ['name', 'label', 'lines', 'in', 'out', 'signature', 'confidence', 'strategy'],
        groups: [{
          qn_prefix: 'demo.Service',
          file: 'src/Service.java',
          rows: [['run', 'Method', '10-12', 1, 2, 'run()', 0.96, 'lsp']],
        }],
      },
    }, 'DEFINES');
    expect(result).toMatchObject([{
      qualifiedName: 'demo.Service.run', filePath: 'src/Service.java',
      startLine: 10, endLine: 12, kind: 'method', signature: 'run()',
    }]);
  });

  it('normalizes the textual table returned by query_graph', () => {
    const result = normalizeCandidates({
      content: [{
        type: 'text',
        text: 'rows: 1  (cols: qn file start_line end_line signature confidence strategy)\n'
          + '  demo.Service.run "src/Service With Space.java" "10" "12" "run(String value)" "0.96" lsp\n'
          + 'total: 1\n',
      }],
    }, 'CALLS');
    expect(result).toMatchObject([{
      qualifiedName: 'demo.Service.run', filePath: 'src/Service With Space.java',
      startLine: 10, endLine: 12, signature: 'run(String value)', confidence: 0.96,
      strategy: 'lsp', relationship: 'CALLS',
    }]);
  });

  it('rejects malformed locations', () => {
    expect(normalizeCandidates({ rows: [{ qualified_name: 'x', file_path: '', start_line: 0 }] }, 'CALLS'))
      .toEqual([]);
  });
});

describe('McpGraphNavigator', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps a default navigation query alive long enough for a three-second result', async () => {
    vi.useFakeTimers();
    const callTool = vi.fn((_root, _tool, _args, signal?: AbortSignal) => new Promise((resolveResult, reject) => {
      const resultTimer = setTimeout(() => resolveResult({ rows: [{
        qn: 'demo.Service.run', label: 'Method', file: 'src/Service.java',
        start_line: 10, end_line: 12, confidence: 0.96, strategy: 'lsp',
      }] }), 3000);
      signal?.addEventListener('abort', () => {
        clearTimeout(resultTimer);
        reject(new Error('aborted'));
      }, { once: true });
    }));
    const graph = new McpGraphNavigator({ callTool } as unknown as RootManager, () => 'project-id');
    const result = graph.definitions(root, context).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(3000);

    expect(await result).toMatchObject([{
      qualifiedName: 'demo.Service.run', filePath: 'src/Service.java', startLine: 10,
    }]);
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it('cancels an unresolved default query at five seconds', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const callTool = vi.fn((_root, _tool, _args, signal?: AbortSignal) => {
      requestSignal = signal;
      return new Promise((_resolve, reject) => signal?.addEventListener(
        'abort', () => reject(new Error('aborted')), { once: true },
      ));
    });
    const graph = new McpGraphNavigator({ callTool } as unknown as RootManager, () => 'project-id');
    const result = graph.definitions(root, context).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(4999);
    expect(requestSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual(new Error('aborted'));
  });

  it('still cancels immediately when the editor cancels a navigation request', async () => {
    vi.useFakeTimers();
    const cancellation = new AbortController();
    const callTool = vi.fn((_root, _tool, _args, signal?: AbortSignal) =>
      new Promise((_resolve, reject) => signal?.addEventListener(
        'abort', () => reject(new Error('editor cancelled')), { once: true },
      )));
    const graph = new McpGraphNavigator({ callTool } as unknown as RootManager, () => 'project-id');
    const result = graph.definitions(root, context, cancellation.signal).catch((error: unknown) => error);

    cancellation.abort();

    expect(await result).toEqual(new Error('editor cancelled'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('partitions a declaration family and deduplicates verified callers', async () => {
    const callTool = vi.fn(async (_root, _tool: string, args: Readonly<Record<string, unknown>>) => {
      const query = String(args.query);
      if (query.includes('selectedCall:CALLS|CALL_REFERENCE')) return { rows: [{
        member_qn: 'demo.Worker.run', member_label: 'Method',
        member_file: 'src/Worker.java', member_start_line: 2, member_end_line: 2,
        member_signature: 'run(String value)', member_relationship: 'SELECTED',
        occurrence_file: 'src/Caller.java', occurrence_line: 21,
        confidence: 0.96, strategy: 'lsp',
      }] };
      if (query.includes('MATCH (member)-[:OVERRIDE*1..8]->(selected)')) return { rows: [{
        member_qn: 'demo.FastWorker.run', member_label: 'Method',
        member_file: 'src/FastWorker.java', member_start_line: 8, member_end_line: 8,
        member_signature: 'run(String value)', member_relationship: 'IMPLEMENTATION',
        occurrence_file: 'src/Caller.java', occurrence_line: 21,
        confidence: 0.96, strategy: 'lsp',
      }] };
      return { rows: [] };
    });
    const manager = { callTool } as unknown as RootManager;
    const graph = new McpGraphNavigator(manager, () => 'project-id');

    await expect(graph.declarationRelations(root, declarationDescriptor)).resolves.toMatchObject({
      selected: declarationDescriptor,
      declarations: [],
      implementations: [expect.objectContaining({ qualifiedName: 'demo.FastWorker.run' })],
      callers: [expect.objectContaining({ filePath: 'src/Caller.java', startLine: 21 })],
    });
    expect(callTool).toHaveBeenCalledWith(root, 'query_graph', expect.objectContaining({
      project: 'project-id',
      query: expect.stringMatching(/selected\.file_path = 'src\/Worker\.java'.*selected\.start_line <= 3/),
    }), expect.any(AbortSignal));
    expect(callTool).toHaveBeenCalledTimes(3);
  });

  it('uses OVERRIDE direction even when the implementation lacks an annotation', async () => {
    const implementation = {
      ...declarationDescriptor,
      documentUri: pathToFileURL(join(root, 'src', 'FastWorker.java')).toString(),
      abstract: false,
      override: false,
    };
    const callTool = vi.fn(async (_root, _tool: string, args: Readonly<Record<string, unknown>>) => {
      const query = String(args.query);
      if (query.includes('MATCH (selected)-[:OVERRIDE*1..8]->(member)')) return { rows: [{
        member_qn: 'demo.Worker.run', member_label: 'Method',
        member_file: 'src/Worker.java', member_start_line: 2, member_end_line: 2,
        member_relationship: 'DECLARATION',
      }] };
      return { rows: [] };
    });
    const graph = new McpGraphNavigator({ callTool } as unknown as RootManager, () => 'project-id');

    await expect(graph.declarationRelations(root, implementation)).resolves.toMatchObject({
      declarations: [expect.objectContaining({ qualifiedName: 'demo.Worker.run' })],
      implementations: [],
    });
  });

  it('normalizes type-family usages as references', async () => {
    const {
      argumentCount: _argumentCount,
      signatureHint: _signatureHint,
      ...typeBase
    } = declarationDescriptor;
    const typeDescriptor = {
      ...typeBase,
      name: 'Worker',
      kind: 'type' as const,
      tokenRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
      declarationRange: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
    };
    const callTool = vi.fn(async (_root, _tool: string, args: Readonly<Record<string, unknown>>) => {
      const query = String(args.query);
      if (query.includes('selectedUsage:USAGE')) return { rows: [{
        member_qn: 'demo.Worker', member_label: 'Interface',
        member_file: 'src/Worker.java', member_start_line: 1, member_end_line: 3,
        member_relationship: 'SELECTED', occurrence_file: 'src/TypeUser.java',
        occurrence_line: 7, confidence: 0.95, strategy: 'lsp',
      }] };
      if (query.includes('MATCH (member)-[:IMPLEMENTS|INHERITS*1..8]->(selected)')) return { rows: [{
        member_qn: 'demo.FastWorker', member_label: 'Class',
        member_file: 'src/FastWorker.java', member_start_line: 1, member_end_line: 8,
        member_relationship: 'IMPLEMENTATION',
      }] };
      return { rows: [] };
    });
    const graph = new McpGraphNavigator({ callTool } as unknown as RootManager, () => 'project-id');

    await expect(graph.declarationRelations(root, typeDescriptor)).resolves.toMatchObject({
      implementations: [expect.objectContaining({ qualifiedName: 'demo.FastWorker' })],
      references: [expect.objectContaining({ filePath: 'src/TypeUser.java', startLine: 7 })],
    });
    expect(callTool).toHaveBeenCalledTimes(3);
  });

  it('uses the exact source call edge before global definition search', async () => {
    const callTool = vi.fn(async (_root, tool: string) => tool === 'query_graph'
      ? {
          rows: [{
            qn: 'demo.api.ExportService.exportReport', label: 'Method',
            file: 'api/ExportService.java', start_line: 10, end_line: 10,
            signature: 'exportReport(Input input, Output output)',
            receiver_type: 'demo.api.ExportService', owner_kind: 'Interface',
            confidence: 0.95, strategy: 'lsp',
          }],
        }
      : { rows: [] });
    const manager = { callTool } as unknown as RootManager;
    const graph = new McpGraphNavigator(manager, () => 'project-id');
    const result = await graph.definitions(root, context);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith(root, 'query_graph', expect.objectContaining({
      project: 'project-id',
      query: expect.stringMatching(/source\.file_path = 'A\.java'.*r\.line = 3/),
    }), expect.any(AbortSignal));
    expect(result).toMatchObject([{
      qualifiedName: 'demo.api.ExportService.exportReport',
      receiverType: 'demo.api.ExportService', concrete: false, relationship: 'CALLS',
    }]);
  });

  it('falls back to structured global search when no exact call edge exists', async () => {
    const callTool = vi.fn(async () => ({ rows: [] }));
    const manager = { callTool } as unknown as RootManager;
    const graph = new McpGraphNavigator(manager, () => 'project-id');
    await graph.definitions(root, context);
    expect(callTool).toHaveBeenLastCalledWith(root, 'search_graph', expect.objectContaining({
      project: 'project-id', name_pattern: '^run$', format: 'json',
    }), expect.any(AbortSignal));
  });

  it('adds inheritance and implementation ranges to type references', async () => {
    const callTool = vi.fn(async () => ({ rows: [] }));
    const manager = { callTool } as unknown as RootManager;
    const graph = new McpGraphNavigator(manager, () => 'project-id');
    await graph.references(root, { ...context, name: 'Worker', kind: 'type' });
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool).toHaveBeenNthCalledWith(1, root, 'query_graph', expect.objectContaining({
      query: expect.stringContaining('[r:USAGE]'),
    }), expect.any(AbortSignal));
    expect(callTool).toHaveBeenLastCalledWith(root, 'query_graph', expect.objectContaining({
      query: expect.stringContaining('[r:IMPLEMENTS|INHERITS]'),
    }), expect.any(AbortSignal));
  });

  it('aborts a graph request at the configured timeout', async () => {
    const callTool = vi.fn((_root, _tool, _args, signal?: AbortSignal) =>
      new Promise((_resolve, reject) => signal?.addEventListener(
        'abort', () => reject(new Error('aborted')), { once: true },
      )));
    const manager = { callTool } as unknown as RootManager;
    const graph = new McpGraphNavigator(manager, () => 'project-id', 5);
    await expect(graph.definitions(root, context)).rejects.toThrow('aborted');
  });
});
