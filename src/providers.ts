import * as vscode from 'vscode';
import type { TextDocumentLike } from './contracts.js';
import { registerDeclarationCodeLens } from './codeLens.js';
import type { JavaSyntaxAdapter } from './languages/java/adapter.js';
import type { NavigationEngine, NavigationOutcome } from './navigation/engine.js';

function documentLike(document: vscode.TextDocument): TextDocumentLike {
  return {
    uri: document.uri.toString(),
    version: document.version,
    languageId: document.languageId,
    getText: () => document.getText(),
  };
}

function links(outcome: NavigationOutcome, origin: vscode.Range): vscode.LocationLink[] {
  return outcome.targets.map((target) => {
    const range = new vscode.Range(
      target.range.start.line,
      target.range.start.character,
      target.range.end.line,
      target.range.end.character,
    );
    return {
      originSelectionRange: origin,
      targetUri: vscode.Uri.parse(target.uri),
      targetRange: range,
      targetSelectionRange: range,
    };
  });
}

function origin(document: vscode.TextDocument, position: vscode.Position): vscode.Range {
  return document.getWordRangeAtPosition(position) ?? new vscode.Range(position, position);
}

export function registerNavigationProviders(
  subscriptions: { push(...items: vscode.Disposable[]): unknown },
  engine: NavigationEngine,
  javaAdapter: JavaSyntaxAdapter,
): { refreshCodeLenses(): void } {
  const selector: vscode.DocumentSelector = { language: 'java', scheme: 'file' };
  subscriptions.push(
    vscode.languages.registerDefinitionProvider(selector, {
      async provideDefinition(document, position, token) {
        return links(
          await engine.definition(documentLike(document), position, token),
          origin(document, position),
        );
      },
    }),
    vscode.languages.registerDeclarationProvider(selector, {
      async provideDeclaration(document, position, token) {
        return links(
          await engine.declaration(documentLike(document), position, token),
          origin(document, position),
        );
      },
    }),
    vscode.languages.registerImplementationProvider(selector, {
      async provideImplementation(document, position, token) {
        return links(
          await engine.implementations(documentLike(document), position, token),
          origin(document, position),
        );
      },
    }),
    vscode.languages.registerReferenceProvider(selector, {
      async provideReferences(document, position, _context, token) {
        const outcome = await engine.references(documentLike(document), position, token);
        return outcome.targets.map((target) => new vscode.Location(
          vscode.Uri.parse(target.uri),
          new vscode.Range(
            target.range.start.line,
            target.range.start.character,
            target.range.end.line,
            target.range.end.character,
          ),
        ));
      },
    }),
  );
  return registerDeclarationCodeLens(subscriptions, selector, engine, javaAdapter);
}
