import { Language, Node, Parser, Tree } from 'web-tree-sitter';
import type {
  DeclarationDescriptor,
  ImportHint,
  Position,
  Range,
  SymbolContext,
  SymbolKind,
} from '../../contracts.js';
import type { JavaParserBackend } from './parserProtocol.js';

interface CachedTree {
  readonly version: number;
  readonly source: string;
  readonly tree: Tree;
}

const TYPE_DECLARATIONS = new Set([
  'class_declaration', 'interface_declaration', 'enum_declaration',
  'record_declaration', 'annotation_type_declaration',
]);

function nodeIsField(node: Node, parent: Node, field: string): boolean {
  return parent.childForFieldName(field)?.equals(node) ?? false;
}

function ancestor(node: Node | null, predicate: (candidate: Node) => boolean): Node | undefined {
  for (let current = node; current; current = current.parent) {
    if (predicate(current)) return current;
  }
  return undefined;
}

function lineText(source: string, line: number): string {
  return source.split(/\r?\n/)[line] ?? '';
}

function byteColumn(source: string, position: Position): number {
  return Buffer.byteLength(lineText(source, position.line).slice(0, position.character), 'utf8');
}

function characterColumn(source: string, line: number, byteOffset: number): number {
  return Buffer.from(lineText(source, line), 'utf8').subarray(0, byteOffset).toString('utf8').length;
}

function nodeRange(source: string, node: Node): Range {
  return {
    start: {
      line: node.startPosition.row,
      character: characterColumn(source, node.startPosition.row, node.startPosition.column),
    },
    end: {
      line: node.endPosition.row,
      character: characterColumn(source, node.endPosition.row, node.endPosition.column),
    },
  };
}

function positionAtEnd(source: string): { row: number; column: number } {
  const lines = source.split('\n');
  return {
    row: lines.length - 1,
    column: Buffer.byteLength(lines.at(-1) ?? '', 'utf8'),
  };
}

function imports(root: Node): ImportHint[] {
  return root.descendantsOfType('import_declaration').flatMap((node) => {
    if (!node) return [];
    const text = node.text.replace(/^import\s+/, '').replace(/;\s*$/, '').trim();
    const isStatic = text.startsWith('static ');
    const qualifiedName = text.replace(/^static\s+/, '').trim();
    const wildcard = qualifiedName.endsWith('.*');
    const parts = qualifiedName.split('.');
    return [{
      name: wildcard ? '*' : (parts.at(-1) ?? qualifiedName),
      qualifiedName,
      isStatic,
      wildcard,
    }];
  });
}

function packageName(root: Node): string | undefined {
  return root.descendantsOfType('package_declaration')[0]?.text
    .replace(/^package\s+/, '')
    .replace(/;\s*$/, '')
    .trim();
}

function modifiersText(node: Node): string {
  return node.namedChildren.find((child) => child?.type === 'modifiers')?.text ?? '';
}

export function enumerateJavaDeclarations(
  tree: Tree,
  source: string,
  uri: string,
  version: number,
): DeclarationDescriptor[] {
  const root = tree.rootNode;
  const packageHint = packageName(root);
  const declarationTypes = [...TYPE_DECLARATIONS, 'method_declaration', 'constructor_declaration'];
  const declarations: Array<{ descriptor: DeclarationDescriptor; startIndex: number }> = [];

  for (const declaration of root.descendantsOfType(declarationTypes)) {
    if (!declaration) continue;
    const identifier = declaration.childForFieldName('name');
    if (!identifier?.text) continue;
    const kind: DeclarationDescriptor['kind'] = TYPE_DECLARATIONS.has(declaration.type)
      ? 'type'
      : declaration.type === 'constructor_declaration' ? 'constructor' : 'method';
    const owner = ancestor(declaration.parent, (node) => TYPE_DECLARATIONS.has(node.type));
    const argumentCount = kind === 'method' || kind === 'constructor'
      ? callableArity(declaration)
      : undefined;
    const modifiers = modifiersText(declaration);
    const abstract = declaration.type === 'interface_declaration'
      || declaration.type === 'annotation_type_declaration'
      || owner?.type === 'interface_declaration'
      || /\babstract\b/.test(modifiers);
    declarations.push({
      startIndex: identifier.startIndex,
      descriptor: {
        documentUri: uri,
        documentVersion: version,
        name: identifier.text,
        kind,
        tokenRange: nodeRange(source, identifier),
        declarationRange: nodeRange(source, declaration),
        ...(packageHint ? { packageName: packageHint } : {}),
        ...(owner?.childForFieldName('name')?.text
          ? { ownerName: owner.childForFieldName('name')!.text }
          : {}),
        ...(argumentCount !== undefined
          ? { argumentCount, signatureHint: `${identifier.text}/${argumentCount}` }
          : {}),
        abstract,
        override: /@Override\b/.test(modifiers),
      },
    });
  }

  for (const declarator of root.descendantsOfType('variable_declarator')) {
    if (!declarator || declarator.parent?.type !== 'field_declaration') continue;
    const identifier = declarator.childForFieldName('name');
    if (!identifier?.text) continue;
    const owner = ancestor(declarator.parent, (node) => TYPE_DECLARATIONS.has(node.type));
    declarations.push({
      startIndex: identifier.startIndex,
      descriptor: {
        documentUri: uri,
        documentVersion: version,
        name: identifier.text,
        kind: 'field',
        tokenRange: nodeRange(source, identifier),
        declarationRange: nodeRange(source, declarator.parent),
        ...(packageHint ? { packageName: packageHint } : {}),
        ...(owner?.childForFieldName('name')?.text
          ? { ownerName: owner.childForFieldName('name')!.text }
          : {}),
        abstract: false,
        override: false,
      },
    });
  }

  return declarations
    .sort((left, right) => left.startIndex - right.startIndex)
    .map(({ descriptor }) => descriptor);
}

function declarationKind(identifier: Node): { kind: SymbolKind; role: SymbolContext['role']; declaration?: Node } {
  const parent = identifier.parent;
  if (!parent) return { kind: 'unknown', role: 'reference' };
  if (TYPE_DECLARATIONS.has(parent.type) && nodeIsField(identifier, parent, 'name')) {
    return { kind: 'type', role: 'declaration', declaration: identifier };
  }
  if (parent.type === 'method_declaration' && nodeIsField(identifier, parent, 'name')) {
    return { kind: 'method', role: 'declaration', declaration: identifier };
  }
  if (parent.type === 'constructor_declaration' && nodeIsField(identifier, parent, 'name')) {
    return { kind: 'constructor', role: 'declaration', declaration: identifier };
  }
  if (parent.type === 'formal_parameter' && nodeIsField(identifier, parent, 'name')) {
    return { kind: 'parameter', role: 'declaration', declaration: identifier };
  }
  if (parent.type === 'variable_declarator' && nodeIsField(identifier, parent, 'name')) {
    const owner = parent.parent;
    if (owner?.type === 'field_declaration') return { kind: 'field', role: 'declaration', declaration: identifier };
    return { kind: 'local', role: 'declaration', declaration: identifier };
  }
  const invocation = ancestor(identifier, (item) => item.type === 'method_invocation');
  if (invocation?.childForFieldName('name')?.equals(identifier)) {
    return { kind: 'method', role: 'invocation' };
  }
  const creation = ancestor(identifier, (item) => item.type === 'object_creation_expression');
  if (creation?.childForFieldName('type')?.equals(identifier)) {
    return { kind: 'constructor', role: 'invocation' };
  }
  if (identifier.type === 'type_identifier') return { kind: 'type', role: 'typeReference' };
  const access = ancestor(identifier, (item) => item.type === 'field_access');
  if (access?.childForFieldName('field')?.equals(identifier)) return { kind: 'field', role: 'reference' };
  return { kind: 'unknown', role: 'reference' };
}

function callableArity(node: Node | undefined): number | undefined {
  const args = node?.childForFieldName('arguments') ?? node?.childForFieldName('parameters');
  return args ? args.namedChildCount : undefined;
}

function receiverFor(identifier: Node): Node | undefined {
  const invocation = ancestor(identifier, (item) => item.type === 'method_invocation');
  if (invocation?.childForFieldName('name')?.equals(identifier)) {
    return invocation.childForFieldName('object') ?? undefined;
  }
  const access = ancestor(identifier, (item) => item.type === 'field_access');
  return access?.childForFieldName('object') ?? undefined;
}

function variableType(root: Node, name: string, beforeIndex: number): string | undefined {
  let best: { index: number; type: string } | undefined;
  const declarators = root.descendantsOfType(['variable_declarator', 'formal_parameter']);
  for (const declaration of declarators) {
    if (!declaration || declaration.startIndex > beforeIndex) continue;
    if (declaration.childForFieldName('name')?.text !== name) continue;
    const type = declaration.type === 'formal_parameter'
      ? declaration.childForFieldName('type')?.text
      : declaration.parent?.childForFieldName('type')?.text;
    if (type && (!best || declaration.startIndex > best.index)) best = { index: declaration.startIndex, type };
  }
  return best?.type;
}

function enclosingName(identifier: Node, types: ReadonlySet<string>): string | undefined {
  return ancestor(identifier.parent, (node) => types.has(node.type))?.childForFieldName('name')?.text;
}

function sameNode(left: Node | undefined, right: Node | undefined): boolean {
  return Boolean(left && right && left.equals(right));
}

function containsNode(container: Node, node: Node): boolean {
  return Boolean(ancestor(node, (candidate) => candidate.equals(container)));
}

function nearestLocalDeclaration(root: Node, reference: Node): Node | undefined {
  let best: Node | undefined;
  const callableTypes = new Set([
    'method_declaration', 'constructor_declaration', 'lambda_expression',
  ]);
  const referenceCallable = ancestor(reference, (node) => callableTypes.has(node.type));
  if (!referenceCallable) return undefined;
  const scopeTypes = new Set([
    'block', 'for_statement', 'enhanced_for_statement', 'catch_clause',
    'try_with_resources_statement', 'switch_block_statement_group', 'lambda_expression',
  ]);
  for (const node of root.descendantsOfType(['variable_declarator', 'formal_parameter'])) {
    const declaration = node?.childForFieldName('name');
    if (!node || declaration?.text !== reference.text || declaration.startIndex > reference.startIndex) continue;
    if (node.type === 'variable_declarator' && node.parent?.type === 'field_declaration') continue;
    const declarationCallable = ancestor(node, (candidate) => callableTypes.has(candidate.type));
    if (!sameNode(referenceCallable, declarationCallable)) continue;
    if (node.type === 'variable_declarator') {
      const scope = ancestor(node, (candidate) => scopeTypes.has(candidate.type));
      if (scope && !containsNode(scope, reference)) continue;
    }
    if (!best || declaration.startIndex > best.startIndex) best = declaration;
  }
  return best;
}

export function analyzeJavaTree(
  tree: Tree,
  source: string,
  uri: string,
  version: number,
  position: Position,
): SymbolContext | undefined {
  const point = { row: position.line, column: byteColumn(source, position) };
  let identifier = tree.rootNode.descendantForPosition(point);
  if (!identifier) return undefined;
  if (!['identifier', 'type_identifier'].includes(identifier.type)) {
    identifier = ancestor(identifier, (node) => ['identifier', 'type_identifier'].includes(node.type)) ?? identifier;
  }
  if (!['identifier', 'type_identifier'].includes(identifier.type) || !identifier.text) return undefined;
  let classification = declarationKind(identifier);
  const identifierRange = nodeRange(source, identifier);
  const selectedLine = lineText(source, identifierRange.start.line);
  if (classification.role === 'reference'
      && /^\s*\(/.test(selectedLine.slice(identifierRange.end.character))) {
    classification = { kind: 'method', role: 'invocation' };
  }
  const invocation = ancestor(identifier, (node) => ['method_invocation', 'object_creation_expression'].includes(node.type));
  const receiver = receiverFor(identifier);
  const lexicalReceiver = selectedLine
    .slice(0, identifierRange.start.character)
    .match(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.\s*$/)?.[1];
  const receiverText = receiver?.text ?? lexicalReceiver;
  const packageHint = packageName(tree.rootNode);
  const local = nearestLocalDeclaration(tree.rootNode, identifier);
  const argumentCount = classification.role === 'invocation' ? callableArity(invocation) : undefined;
  const receiverTypeHint = receiverText
    ? variableType(tree.rootNode, receiverText, identifier.startIndex)
    : undefined;
  const enclosingType = enclosingName(identifier, TYPE_DECLARATIONS);
  const callableTypes = new Set(['method_declaration', 'constructor_declaration']);
  const enclosingCallable = enclosingName(identifier, callableTypes);
  const context: SymbolContext = {
    documentUri: uri,
    documentVersion: version,
    languageId: 'java',
    position,
    tokenRange: identifierRange,
    name: identifier.text,
    kind: classification.kind,
    role: classification.role,
    imports: imports(tree.rootNode),
    ...(receiverText ? { receiverText } : {}),
    ...(receiverTypeHint ? { receiverTypeHint } : {}),
    ...(argumentCount !== undefined ? { argumentCount, signatureHint: `${identifier.text}/${argumentCount}` } : {}),
    ...(enclosingType ? { enclosingType } : {}),
    ...(enclosingCallable ? { enclosingCallable } : {}),
    ...(packageHint ? { packageName: packageHint } : {}),
    ...(local && !classification.declaration ? { localDeclarationRange: nodeRange(source, local) } : {}),
  };
  return context;
}

export class TreeSitterJavaParser implements JavaParserBackend {
  readonly #parser: Parser;
  readonly #cache = new Map<string, CachedTree>();

  private constructor(parser: Parser) {
    this.#parser = parser;
  }

  static async create(grammarWasmPath: string): Promise<TreeSitterJavaParser> {
    await Parser.init();
    const language = await Language.load(grammarWasmPath);
    const parser = new Parser();
    parser.setLanguage(language);
    return new TreeSitterJavaParser(parser);
  }

  get cachedDocumentCount(): number {
    return this.#cache.size;
  }

  #parse(uri: string, version: number, source: string): Tree | undefined {
    const cached = this.#cache.get(uri);
    if (cached && cached.version > version) return undefined;
    const oldTree = cached?.tree;
    if (cached && cached.version !== version && cached.source !== source) {
      cached.tree.edit({
        startIndex: 0,
        oldEndIndex: Buffer.byteLength(cached.source, 'utf8'),
        newEndIndex: Buffer.byteLength(source, 'utf8'),
        startPosition: { row: 0, column: 0 },
        oldEndPosition: positionAtEnd(cached.source),
        newEndPosition: positionAtEnd(source),
      });
    }
    const tree = this.#parser.parse(source, oldTree);
    if (!tree) return undefined;
    if (cached && cached.tree !== tree) cached.tree.delete();
    this.#cache.set(uri, { version, source, tree });
    return tree;
  }

  async analyze(
    uri: string,
    version: number,
    source: string,
    position: Position,
    signal?: AbortSignal,
  ): Promise<SymbolContext | undefined> {
    if (signal?.aborted) return undefined;
    const tree = this.#parse(uri, version, source);
    if (!tree) return undefined;
    if (signal?.aborted) return undefined;
    return analyzeJavaTree(tree, source, uri, version, position);
  }

  async declarations(
    uri: string,
    version: number,
    source: string,
    signal?: AbortSignal,
  ): Promise<readonly DeclarationDescriptor[]> {
    if (signal?.aborted) return [];
    const tree = this.#parse(uri, version, source);
    if (!tree || signal?.aborted) return [];
    return enumerateJavaDeclarations(tree, source, uri, version);
  }

  disposeDocument(uri: string): void {
    this.#cache.get(uri)?.tree.delete();
    this.#cache.delete(uri);
  }

  async dispose(): Promise<void> {
    for (const entry of this.#cache.values()) entry.tree.delete();
    this.#cache.clear();
    this.#parser.delete();
  }
}
