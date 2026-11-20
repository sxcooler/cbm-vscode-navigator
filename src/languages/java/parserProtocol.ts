import type { DeclarationDescriptor, Position, SymbolContext } from '../../contracts.js';

export type JavaParserRequest =
  | {
      readonly id: number;
      readonly type: 'analyze';
      readonly uri: string;
      readonly version: number;
      readonly source: string;
      readonly position: Position;
    }
  | {
      readonly id: number;
      readonly type: 'declarations';
      readonly uri: string;
      readonly version: number;
      readonly source: string;
    }
  | { readonly id: number; readonly type: 'dispose'; readonly uri: string };

export type JavaParserResponse =
  | {
      readonly id: number;
      readonly ok: true;
      readonly context?: SymbolContext;
      readonly declarations?: readonly DeclarationDescriptor[];
    }
  | { readonly id: number; readonly ok: false; readonly error: string };

export interface JavaParserBackend {
  analyze(
    uri: string,
    version: number,
    source: string,
    position: Position,
    signal?: AbortSignal,
  ): Promise<SymbolContext | undefined>;
  declarations(
    uri: string,
    version: number,
    source: string,
    signal?: AbortSignal,
  ): Promise<readonly DeclarationDescriptor[]>;
  disposeDocument(uri: string): void;
  dispose?(): Promise<void>;
}
