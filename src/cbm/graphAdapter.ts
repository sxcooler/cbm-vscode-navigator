import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  DeclarationDescriptor,
  DeclarationRelationBundle,
  NavigationCandidate,
  SymbolContext,
} from '../contracts.js';
import type { GraphNavigator } from '../navigation/engine.js';
import { buildCandidateQuery, buildDeclarationRelationQueries } from './queryBuilder.js';
import type { RootManager } from './rootManager.js';

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function tableValue(token: string, quoted: boolean): unknown {
  const value = quoted ? JSON.parse(token) as string : token;
  if (value === 'null') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
}

function tokenizeTableRow(line: string): unknown[] {
  const values: unknown[] = [];
  const pattern = /("(?:\\.|[^"\\])*")|(\S+)/g;
  for (const match of line.matchAll(pattern)) {
    const token = match[1] ?? match[2];
    if (token !== undefined) values.push(tableValue(token, match[1] !== undefined));
  }
  return values;
}

function parseTableText(text: string): Record<string, unknown> | undefined {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^rows:\s+\d+\s+\(cols:/.test(line));
  if (headerIndex < 0) return undefined;
  const header = /^rows:\s+\d+\s+\(cols:\s*(.*?)\)\s*$/.exec(lines[headerIndex]!);
  if (!header) return undefined;
  const cols = header[1]!.trim().split(/\s+/).filter(Boolean);
  const rows: unknown[][] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('total:')) continue;
    const values = tokenizeTableRow(trimmed);
    if (values.length === cols.length) rows.push(values);
  }
  return { cols, rows };
}

function payload(raw: unknown): unknown {
  const wrapper = record(raw);
  if (!wrapper) return raw;
  if (wrapper.structuredContent) return wrapper.structuredContent;
  if (Array.isArray(wrapper.content)) {
    const text = wrapper.content
      .map(record)
      .find((item) => item?.type === 'text' && typeof item.text === 'string')?.text;
    if (typeof text === 'string') {
      try { return JSON.parse(text); } catch { return parseTableText(text) ?? raw; }
    }
  }
  return raw;
}

function rows(raw: unknown): Record<string, unknown>[] {
  const body = record(payload(raw));
  if (!body) return [];
  if (Array.isArray(body.groups) && Array.isArray(body.cols)) {
    const cols = body.cols.filter((column): column is string => typeof column === 'string');
    return body.groups.flatMap((value) => {
      const group = record(value);
      if (!group || !Array.isArray(group.rows)) return [];
      const prefix = typeof group.qn_prefix === 'string' ? group.qn_prefix : '';
      const file = typeof group.file === 'string' ? group.file : undefined;
      return group.rows.flatMap((value) => {
        if (!Array.isArray(value)) return [];
        const row = Object.fromEntries(cols.map((column, index) => [column, value[index]]));
        const name = typeof row.name === 'string' ? row.name : '';
        return [{
          ...row,
          qn: prefix && name ? `${prefix}.${name}` : (name || prefix),
          ...(file ? { file } : {}),
        }];
      });
    });
  }
  if (Array.isArray(body.rows)) {
    if (Array.isArray(body.cols)) {
      const cols = body.cols.filter((column): column is string => typeof column === 'string');
      return body.rows.flatMap((row) => Array.isArray(row)
        ? [Object.fromEntries(cols.map((column, index) => [column, row[index]]))]
        : (record(row) ? [record(row)!] : []));
    }
    return body.rows.flatMap((row) => record(row) ? [record(row)!] : []);
  }
  if (Array.isArray(body.results)) return body.results.flatMap((row) => record(row) ? [record(row)!] : []);
  return [];
}

function stringValue(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) if (typeof row[key] === 'string') return row[key] as string;
  return undefined;
}

function numberValue(row: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) if (typeof row[key] === 'number' && Number.isFinite(row[key])) return row[key] as number;
  return undefined;
}

function lines(row: Record<string, unknown>): [number, number] | undefined {
  const explicitStart = numberValue(row, 'start_line', 'startLine');
  const explicitEnd = numberValue(row, 'end_line', 'endLine') ?? explicitStart;
  if (explicitStart !== undefined && explicitStart > 0 && explicitEnd !== undefined) {
    return [explicitStart, Math.max(explicitStart, explicitEnd)];
  }
  const value = stringValue(row, 'lines');
  const match = value ? /^(\d+)(?:-(\d+))?$/.exec(value) : undefined;
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  return start > 0 ? [start, Math.max(start, end)] : undefined;
}

function strategy(value: unknown): NavigationCandidate['strategy'] {
  return ['lsp', 'language_rule', 'heuristic', 'unresolved'].includes(String(value))
    ? value as NavigationCandidate['strategy']
    : undefined;
}

export function normalizeCandidates(raw: unknown, defaultRelationship: string): NavigationCandidate[] {
  return rows(raw).flatMap((row) => {
    const qualifiedName = stringValue(row, 'qn', 'qualified_name', 'qualifiedName');
    const filePath = stringValue(row, 'file', 'file_path', 'filePath');
    const lineRange = lines(row);
    if (!qualifiedName || !filePath || !lineRange) return [];
    const relationship = stringValue(row, 'relationship') ?? defaultRelationship;
    const confidence = numberValue(row, 'confidence');
    const resolvedStrategy = strategy(row.strategy);
    const signature = stringValue(row, 'signature');
    const receiverType = stringValue(row, 'receiver_type', 'receiverType');
    const ownerKind = stringValue(row, 'owner_kind', 'ownerKind')?.toLowerCase();
    const sourceScope = stringValue(row, 'source_scope', 'sourceScope');
    return [{
      kind: (stringValue(row, 'label', 'kind') ?? 'unknown').toLowerCase(),
      qualifiedName,
      relationship,
      filePath,
      startLine: lineRange[0],
      endLine: lineRange[1],
      ...(signature ? { signature } : {}),
      ...(receiverType ? { receiverType } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(resolvedStrategy ? { strategy: resolvedStrategy } : {}),
      ...(sourceScope ? { sourceScope } : {}),
      ...(typeof row.concrete === 'boolean'
        ? { concrete: row.concrete }
        : (ownerKind === 'interface'
            ? { concrete: false }
            : (defaultRelationship === 'IMPLEMENTS' ? { concrete: true } : {}))),
      indexed: true,
      excluded: false,
      evidence: [relationship],
    }];
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function projectRelativeFile(root: string, documentUri: string): string | undefined {
  try {
    const path = relative(resolve(root), resolve(fileURLToPath(documentUri))).replace(/\\/g, '/');
    return path && path !== '..' && !path.startsWith('../') && !isAbsolute(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

function uniqueCandidates(candidates: readonly NavigationCandidate[]): NavigationCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.qualifiedName}\0${candidate.filePath}\0${candidate.startLine}\0${candidate.endLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueOccurrences(candidates: readonly NavigationCandidate[]): NavigationCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.filePath}\0${candidate.startLine}\0${candidate.endLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeDeclarationRelations(
  raw: unknown,
  selected: DeclarationDescriptor,
  defaultRelationship: 'SELECTED' | 'DECLARATION' | 'IMPLEMENTATION' = 'DECLARATION',
): DeclarationRelationBundle {
  const members: NavigationCandidate[] = [];
  const declarations: NavigationCandidate[] = [];
  const implementations: NavigationCandidate[] = [];
  const callers: NavigationCandidate[] = [];
  const references: NavigationCandidate[] = [];
  for (const row of rows(raw)) {
    const qualifiedName = stringValue(row, 'member_qn');
    const memberFile = stringValue(row, 'member_file');
    const memberStart = numberValue(row, 'member_start_line');
    const memberEnd = numberValue(row, 'member_end_line') ?? memberStart;
    const relationship = stringValue(row, 'member_relationship') ?? defaultRelationship;
    const confidence = numberValue(row, 'confidence') ?? 1;
    const resolvedStrategy = strategy(row.strategy) ?? 'language_rule';
    if (!qualifiedName || !memberFile || !memberStart || !memberEnd) continue;
    const member: NavigationCandidate = {
      kind: (stringValue(row, 'member_label') ?? selected.kind).toLowerCase(),
      qualifiedName,
      relationship,
      filePath: memberFile,
      startLine: memberStart,
      endLine: memberEnd,
      ...(stringValue(row, 'member_signature')
        ? { signature: stringValue(row, 'member_signature')! }
        : {}),
      ...(typeof row.member_concrete === 'boolean' ? { concrete: row.member_concrete } : {}),
      confidence,
      strategy: resolvedStrategy,
      indexed: true,
      excluded: false,
      evidence: [relationship],
    };
    members.push(member);
    if (relationship === 'IMPLEMENTATION') implementations.push(member);
    else declarations.push(member);

    const occurrenceFile = stringValue(row, 'occurrence_file');
    const occurrenceLine = numberValue(row, 'occurrence_line');
    if (!occurrenceFile || !occurrenceLine || occurrenceLine <= 0) continue;
    const occurrence: NavigationCandidate = {
      ...member,
      relationship: selected.kind === 'method' || selected.kind === 'constructor' ? 'CALLS' : 'USAGE',
      filePath: occurrenceFile,
      startLine: occurrenceLine,
      endLine: occurrenceLine,
      evidence: [selected.kind === 'method' || selected.kind === 'constructor' ? 'CALLS' : 'USAGE'],
    };
    if (selected.kind === 'method' || selected.kind === 'constructor') callers.push(occurrence);
    else references.push(occurrence);
  }
  return {
    selected,
    family: uniqueCandidates(members),
    declarations: uniqueCandidates(declarations),
    implementations: uniqueCandidates(implementations),
    callers: uniqueOccurrences(callers),
    references: uniqueOccurrences(references),
  };
}

export class McpGraphNavigator implements GraphNavigator {
  constructor(
    readonly manager: RootManager,
    readonly projectForRoot: (root: string) => string | undefined,
    readonly timeoutMs = 5000,
  ) {}

  async #call(
    root: string,
    tool: string,
    args: Readonly<Record<string, unknown>>,
    externalSignal?: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted) controller.abort();
    const timeout = setTimeout(abort, this.timeoutMs);
    try {
      return await this.manager.callTool(root, tool, args, controller.signal);
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abort);
    }
  }

  async definitions(root: string, context: SymbolContext, signal?: AbortSignal) {
    const project = this.projectForRoot(root);
    if (!project) return [];
    const sourceFile = context.role === 'invocation'
      ? projectRelativeFile(root, context.documentUri)
      : undefined;
    if (sourceFile) {
      const query = buildCandidateQuery({
        name: context.name,
        kind: context.kind,
        definitions: true,
        sourceFile,
        sourceLine: context.position.line + 1,
        ...(context.argumentCount !== undefined ? { argumentCount: context.argumentCount } : {}),
      });
      const raw = await this.#call(root, 'query_graph', { project, query }, signal);
      const exact = normalizeCandidates(raw, 'CALLS');
      if (exact.length > 0) return exact;
    }
    const raw = await this.#call(root, 'search_graph', {
      project,
      name_pattern: `^${escapeRegex(context.name)}$`,
      format: 'json',
      fields: ['signature', 'confidence', 'strategy', 'concrete', 'receiver_type', 'source_scope'],
      limit: 100,
    }, signal);
    return normalizeCandidates(raw, 'DEFINES');
  }

  async declarationRelations(
    root: string,
    descriptor: DeclarationDescriptor,
    signal?: AbortSignal,
  ): Promise<DeclarationRelationBundle> {
    const project = this.projectForRoot(root);
    if (!project) {
      return {
        selected: descriptor, family: [], declarations: [], implementations: [], callers: [], references: [],
      };
    }
    const owner = descriptor.kind === 'type'
      ? [descriptor.packageName, descriptor.name].filter(Boolean).join('.')
      : [descriptor.packageName, descriptor.ownerName].filter(Boolean).join('.');
    if (!owner) {
      return {
        selected: descriptor, family: [], declarations: [], implementations: [], callers: [], references: [],
      };
    }
    const sourceFile = projectRelativeFile(root, descriptor.documentUri);
    const queries = buildDeclarationRelationQueries({
      name: descriptor.name,
      kind: descriptor.kind,
      qualifiedOwner: owner,
      ...(sourceFile ? { sourceFile } : {}),
      sourceLine: descriptor.tokenRange.start.line + 1,
      ...(descriptor.argumentCount !== undefined ? { argumentCount: descriptor.argumentCount } : {}),
    });
    const selectedBundle = normalizeDeclarationRelations(
      await this.#call(root, 'query_graph', { project, query: queries.selected }, signal),
      descriptor,
      'SELECTED',
    );
    const declarationBundle = queries.declarations
      ? normalizeDeclarationRelations(
          await this.#call(root, 'query_graph', { project, query: queries.declarations }, signal),
          descriptor,
          'DECLARATION',
        )
      : undefined;
    const implementationBundle = queries.implementations
      ? normalizeDeclarationRelations(
          await this.#call(root, 'query_graph', { project, query: queries.implementations }, signal),
          descriptor,
          'IMPLEMENTATION',
        )
      : undefined;
    const bundle: DeclarationRelationBundle = {
      selected: descriptor,
      family: uniqueCandidates([
        ...selectedBundle.family,
        ...(declarationBundle?.family ?? []),
        ...(implementationBundle?.family ?? []),
      ]),
      declarations: uniqueCandidates(declarationBundle?.family ?? []),
      implementations: uniqueCandidates(implementationBundle?.family ?? []),
      callers: uniqueOccurrences([
        ...selectedBundle.callers,
        ...(declarationBundle?.callers ?? []),
        ...(implementationBundle?.callers ?? []),
      ]),
      references: uniqueOccurrences(selectedBundle.references),
    };
    if (!sourceFile) return bundle;
    const selectedStart = descriptor.declarationRange.start.line + 1;
    const selectedEnd = descriptor.declarationRange.end.line + 1;
    const withoutSelected = (candidate: NavigationCandidate) => !(
      candidate.filePath.replace(/\\/g, '/') === sourceFile
      && candidate.startLine >= selectedStart
      && candidate.startLine <= selectedEnd
    );
    return {
      ...bundle,
      declarations: bundle.declarations.filter(withoutSelected),
      implementations: bundle.implementations.filter(withoutSelected),
      callers: bundle.callers.filter(withoutSelected),
      references: bundle.references.filter(withoutSelected),
    };
  }

  async implementations(root: string, context: SymbolContext, signal?: AbortSignal) {
    return this.#query(root, context, true, 'IMPLEMENTS', signal);
  }

  async references(root: string, context: SymbolContext, signal?: AbortSignal) {
    const occurrences = await this.#query(root, context, false, 'USAGE', signal);
    if (context.kind !== 'type') return occurrences;
    const project = this.projectForRoot(root);
    if (!project) return occurrences;
    const query = buildCandidateQuery({ name: context.name, typeReferences: true });
    const raw = await this.#call(root, 'query_graph', { project, query }, signal);
    return [...occurrences, ...normalizeCandidates(raw, 'IMPLEMENTS')];
  }

  async #query(
    root: string,
    context: SymbolContext,
    implementations: boolean,
    relationship: string,
    signal?: AbortSignal,
  ) {
    const project = this.projectForRoot(root);
    if (!project) return [];
    const qualifiedOwner = context.receiverTypeHint ?? context.enclosingType;
    if (implementations && context.kind !== 'type' && !qualifiedOwner) return [];
    const query = buildCandidateQuery({
      name: context.name,
      ...(qualifiedOwner ? { qualifiedOwner } : {}),
      implementations,
      kind: context.kind,
      ...(context.argumentCount !== undefined ? { argumentCount: context.argumentCount } : {}),
    });
    const raw = await this.#call(root, 'query_graph', { project, query }, signal);
    return normalizeCandidates(raw, relationship);
  }
}
