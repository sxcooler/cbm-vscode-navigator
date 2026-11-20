import type {
  CancellationLike,
  DeclarationDescriptor,
  Position,
  SymbolContext,
  TextDocumentLike,
} from '../../contracts.js';
import { TreeSitterJavaParser } from './javaAnalysis.js';
import type { JavaParserBackend } from './parserProtocol.js';

export { TreeSitterJavaParser } from './javaAnalysis.js';

export class JavaSyntaxAdapter {
  constructor(readonly parser: JavaParserBackend) {}

  async getSymbolContext(
    document: TextDocumentLike,
    position: Position,
    cancellation?: CancellationLike,
  ): Promise<SymbolContext | undefined> {
    if (document.languageId !== 'java' || cancellation?.isCancellationRequested) return undefined;
    const controller = new AbortController();
    const subscription = cancellation?.onCancellationRequested(() => controller.abort());
    try {
      const context = await this.parser.analyze(
        document.uri,
        document.version,
        document.getText(),
        position,
        controller.signal,
      );
      if (cancellation?.isCancellationRequested || context?.documentVersion !== document.version) {
        return undefined;
      }
      return context;
    } finally {
      subscription?.dispose();
    }
  }

  async getDeclarations(
    document: TextDocumentLike,
    cancellation?: CancellationLike,
  ): Promise<readonly DeclarationDescriptor[]> {
    if (document.languageId !== 'java' || cancellation?.isCancellationRequested) return [];
    const controller = new AbortController();
    const subscription = cancellation?.onCancellationRequested(() => controller.abort());
    try {
      const declarations = await this.parser.declarations(
        document.uri,
        document.version,
        document.getText(),
        controller.signal,
      );
      if (cancellation?.isCancellationRequested
          || declarations.some((item) => item.documentVersion !== document.version)) {
        return [];
      }
      return declarations;
    } finally {
      subscription?.dispose();
    }
  }

  disposeDocument(uri: string): void {
    this.parser.disposeDocument(uri);
  }
}

void TreeSitterJavaParser;
