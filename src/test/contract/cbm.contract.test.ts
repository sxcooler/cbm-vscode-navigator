import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateCapabilities } from '../../cbm/capabilities.js';
import { McpGraphNavigator } from '../../cbm/graphAdapter.js';
import { StdioMcpClientFactory } from '../../cbm/mcpClient.js';
import { rootIdentity } from '../../cbm/rootIdentity.js';
import type { RootManager } from '../../cbm/rootManager.js';
import type { SymbolContext } from '../../contracts.js';
import { rankCandidates } from '../../navigation/ranker.js';
import { resolveCandidate } from '../../navigation/locationResolver.js';

function responseBody(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const value = raw as Record<string, unknown>;
  if (value.structuredContent && typeof value.structuredContent === 'object') {
    return value.structuredContent as Record<string, unknown>;
  }
  if (Array.isArray(value.content)) {
    const text = value.content.find((item) => item && typeof item === 'object'
      && (item as Record<string, unknown>).type === 'text') as Record<string, unknown> | undefined;
    if (typeof text?.text === 'string') {
      try { return JSON.parse(text.text) as Record<string, unknown>; } catch { return {}; }
    }
  }
  return value;
}

function listedProjects(raw: unknown): Array<{ name: string; root_path: string }> {
  const projects = responseBody(raw).projects;
  return Array.isArray(projects)
    ? projects.filter((item): item is { name: string; root_path: string } => Boolean(
      item && typeof item === 'object'
      && typeof (item as Record<string, unknown>).name === 'string'
      && typeof (item as Record<string, unknown>).root_path === 'string',
    ))
    : [];
}

const executable = process.env.CBM_TEST_EXECUTABLE;
describe.skipIf(!executable)('supported CBM executable contract', () => {
  it('discovers an indexed workspace using machine-readable project output', async () => {
    const root = process.env.CBM_TEST_WORKSPACE_ROOT ?? process.cwd();
    const client = await new StdioMcpClientFactory().create(executable!, {
      CBM_ALLOWED_ROOT: root.replaceAll('\\', '/'),
    }, root);
    try {
      const listed = await client.callTool('list_projects', {
        format: 'json', include_details: true, limit: 100, offset: 0,
      });
      expect(Array.isArray(responseBody(listed).projects)).toBe(true);
      if (process.env.CBM_TEST_WORKSPACE_ROOT) {
        expect(listedProjects(listed).some((item) =>
          rootIdentity(item.root_path) === rootIdentity(root))).toBe(true);
      }
    } finally {
      await client.close();
    }
  }, 30_000);

  it('negotiates the tools required by the extension', async () => {
    const client = await new StdioMcpClientFactory().create(executable!, {}, process.cwd());
    try {
      expect(validateCapabilities(await client.listTools())).toEqual({ supported: true, missing: [] });
    } finally {
      await client.close();
    }
  });
});

const liveRoot = process.env.CBM_TEST_WORKSPACE_ROOT;
const liveSymbol = process.env.CBM_TEST_SYMBOL;
const liveReceiver = process.env.CBM_TEST_RECEIVER;
const liveArity = Number(process.env.CBM_TEST_ARITY);
const liveDeclarationFile = process.env.CBM_TEST_DECLARATION_FILE;
const liveDeclarationLine = Number(process.env.CBM_TEST_DECLARATION_LINE);

describe.skipIf(!executable || !liveRoot || !liveSymbol || !liveReceiver || !Number.isInteger(liveArity))(
  'large indexed workspace contract',
  () => {
    it('returns ranked definitions, implementations, and references within the provider timeout', async () => {
      const client = await new StdioMcpClientFactory().create(executable!, {
        CBM_ALLOWED_ROOT: liveRoot!.replaceAll('\\', '/'),
      }, liveRoot!);
      try {
        const listed = await client.callTool('list_projects', { format: 'json', include_details: true, limit: 100, offset: 0 });
        const project = listedProjects(listed).find((item) =>
          rootIdentity(item.root_path) === rootIdentity(liveRoot!));
        expect(project).toBeDefined();
        const manager = {
          callTool: (_root: string, tool: string, args: Readonly<Record<string, unknown>>, signal?: AbortSignal) =>
            client.callTool(tool, args, signal),
        } as unknown as RootManager;
        const graph = new McpGraphNavigator(manager, () => project?.name);
        const context: SymbolContext = {
          documentUri: 'file:///live-workspace.java', documentVersion: 1, languageId: 'java',
          position: { line: 0, character: 0 },
          tokenRange: { start: { line: 0, character: 0 }, end: { line: 0, character: liveSymbol!.length } },
          name: liveSymbol!, kind: 'method', role: 'invocation', receiverTypeHint: liveReceiver!,
          argumentCount: liveArity, imports: [],
        };
        const definitions = await graph.definitions(liveRoot!, context);
        const implementations = await graph.implementations(liveRoot!, context);
        const references = await graph.references(liveRoot!, context);
        for (const candidates of [definitions, implementations, references]) {
          const ranked = rankCandidates(context, candidates, { minimumDirectConfidence: 0.85 })
            .filter((candidate) => candidate.tier <= 2);
          expect(ranked).not.toHaveLength(0);
          await expect(resolveCandidate(liveRoot!, ranked[0]!)).resolves.toBeDefined();
        }
      } finally {
        await client.close();
      }
    }, 30_000);
  },
);

describe.skipIf(
  !executable || !liveRoot || !liveSymbol || !liveReceiver
  || !Number.isInteger(liveArity) || !liveDeclarationFile
  || !Number.isInteger(liveDeclarationLine) || liveDeclarationLine < 1,
)('large indexed declaration contract', () => {
  it('resolves one declaration family and its callers within the provider timeout', async () => {
    const client = await new StdioMcpClientFactory().create(executable!, {
      CBM_ALLOWED_ROOT: liveRoot!.replaceAll('\\', '/'),
    }, liveRoot!);
    try {
      const listed = await client.callTool('list_projects', { format: 'json', include_details: true, limit: 100, offset: 0 });
      const project = listedProjects(listed).find((item) =>
        rootIdentity(item.root_path) === rootIdentity(liveRoot!));
      expect(project).toBeDefined();
      const manager = {
        callTool: (_root: string, tool: string, args: Readonly<Record<string, unknown>>, signal?: AbortSignal) =>
          client.callTool(tool, args, signal),
      } as unknown as RootManager;
      const graph = new McpGraphNavigator(manager, () => project?.name);
      const relations = await graph.declarationRelations(liveRoot!, {
        documentUri: pathToFileURL(liveDeclarationFile!).toString(),
        documentVersion: 1,
        name: liveSymbol!,
        kind: 'method',
        tokenRange: {
          start: { line: liveDeclarationLine - 1, character: 0 },
          end: { line: liveDeclarationLine - 1, character: liveSymbol!.length },
        },
        declarationRange: {
          start: { line: liveDeclarationLine - 1, character: 0 },
          end: { line: liveDeclarationLine - 1, character: liveSymbol!.length },
        },
        ownerName: liveReceiver!,
        argumentCount: liveArity,
        signatureHint: `${liveSymbol}/${liveArity}`,
        abstract: false,
        override: true,
      });
      expect(relations.declarations).not.toHaveLength(0);
      expect(relations.callers).not.toHaveLength(0);
    } finally {
      await client.close();
    }
  }, 30_000);
});
