export interface Position {
  readonly line: number;
  readonly character: number;
}

export interface Range {
  readonly start: Position;
  readonly end: Position;
}

export interface ImportHint {
  readonly name: string;
  readonly qualifiedName: string;
  readonly isStatic: boolean;
  readonly wildcard: boolean;
}

export type SymbolKind =
  | 'type'
  | 'method'
  | 'constructor'
  | 'field'
  | 'local'
  | 'parameter'
  | 'unknown';

export interface SymbolContext {
  readonly documentUri: string;
  readonly documentVersion: number;
  readonly languageId: string;
  readonly position: Position;
  readonly tokenRange: Range;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly role: 'declaration' | 'reference' | 'invocation' | 'typeReference';
  readonly receiverText?: string;
  readonly receiverTypeHint?: string;
  readonly argumentCount?: number;
  readonly signatureHint?: string;
  readonly enclosingType?: string;
  readonly enclosingCallable?: string;
  readonly packageName?: string;
  readonly imports: readonly ImportHint[];
  readonly localDeclarationRange?: Range;
}

export interface DeclarationDescriptor {
  readonly documentUri: string;
  readonly documentVersion: number;
  readonly name: string;
  readonly kind: Extract<SymbolKind, 'type' | 'method' | 'constructor' | 'field'>;
  readonly tokenRange: Range;
  readonly declarationRange: Range;
  readonly packageName?: string;
  readonly ownerName?: string;
  readonly argumentCount?: number;
  readonly signatureHint?: string;
  readonly abstract: boolean;
  readonly override: boolean;
}

export interface DeclarationRelationBundle {
  readonly selected: DeclarationDescriptor;
  readonly family: readonly NavigationCandidate[];
  readonly declarations: readonly NavigationCandidate[];
  readonly implementations: readonly NavigationCandidate[];
  readonly callers: readonly NavigationCandidate[];
  readonly references: readonly NavigationCandidate[];
}

export interface NavigationCandidate {
  readonly kind: string;
  readonly qualifiedName: string;
  readonly relationship: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly signature?: string;
  readonly receiverType?: string;
  readonly confidence?: number;
  readonly strategy?: 'lsp' | 'language_rule' | 'heuristic' | 'unresolved';
  readonly sourceScope?: string;
  readonly concrete?: boolean;
  readonly indexed?: boolean;
  readonly excluded?: boolean;
  readonly evidence: readonly string[];
}

export interface RankedCandidate extends NavigationCandidate {
  readonly tier: 1 | 2 | 3;
  readonly direct: boolean;
}

export type RootStateKind =
  | 'Untrusted'
  | 'Disconnected'
  | 'Connecting'
  | 'Missing'
  | 'Unsupported'
  | 'ReadyWithoutIndex'
  | 'Indexing'
  | 'Ready'
  | 'Stale'
  | 'Degraded'
  | 'Error';

export interface RootState {
  readonly root: string;
  readonly kind: RootStateKind;
  readonly detail?: string;
  readonly project?: string;
  readonly revision?: string;
}

export interface CancellationLike {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface TextDocumentLike {
  readonly uri: string;
  readonly version: number;
  readonly languageId: string;
  getText(): string;
}

export interface LanguageAdapter {
  getSymbolContext(
    document: TextDocumentLike,
    position: Position,
    cancellation?: CancellationLike,
  ): Promise<SymbolContext | undefined>;
  getDeclarations?(
    document: TextDocumentLike,
    cancellation?: CancellationLike,
  ): Promise<readonly DeclarationDescriptor[]>;
  disposeDocument(uri: string): void;
}

export function createInitialRootState(root: string, trusted: boolean): RootState {
  return { root, kind: trusted ? 'Missing' : 'Untrusted' };
}
