import * as vscode from 'vscode';
import type {
  DeclarationDescriptor,
  Position,
  TextDocumentLike,
} from './contracts.js';
import type { JavaSyntaxAdapter } from './languages/java/adapter.js';
import type { NavigationEngine } from './navigation/engine.js';
import type { LocationTarget } from './navigation/results.js';
import { COMMANDS } from './commands.js';
import {
  buildDeclarationLenses,
  potentialLensKinds,
  type DeclarationLensKind,
} from './codeLensModel.js';

function documentLike(document: vscode.TextDocument): TextDocumentLike {
  return {
    uri: document.uri.toString(),
    version: document.version,
    languageId: document.languageId,
    getText: () => document.getText(),
  };
}

function range(value: DeclarationDescriptor['tokenRange'] | LocationTarget['range']): vscode.Range {
  return new vscode.Range(
    value.start.line,
    value.start.character,
    value.end.line,
    value.end.character,
  );
}

class PendingDeclarationCodeLens extends vscode.CodeLens {
  constructor(
    lensRange: vscode.Range,
    readonly descriptor: DeclarationDescriptor,
    readonly kind: DeclarationLensKind,
  ) {
    super(lensRange);
  }
}

export class DeclarationCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  readonly #changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.#changed.event;

  constructor(
    readonly engine: NavigationEngine,
    readonly adapter: JavaSyntaxAdapter,
  ) {}

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    try {
      const declarations = await this.adapter.getDeclarations(documentLike(document), token);
      if (token.isCancellationRequested) return [];
      return declarations.flatMap((descriptor) => potentialLensKinds(descriptor).map((kind) =>
        new PendingDeclarationCodeLens(range(descriptor.tokenRange), descriptor, kind)));
    } catch {
      return [];
    }
  }

  async resolveCodeLens(
    codeLens: vscode.CodeLens,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens> {
    if (!(codeLens instanceof PendingDeclarationCodeLens) || token.isCancellationRequested) {
      return codeLens;
    }
    const document = vscode.workspace.textDocuments.find((item) =>
      item.uri.toString() === codeLens.descriptor.documentUri);
    if (!document || document.version !== codeLens.descriptor.documentVersion) return codeLens;
    try {
      const bundle = await this.engine.declarationRelations(
        documentLike(document),
        codeLens.descriptor,
        token,
      );
      if (token.isCancellationRequested || document.version !== codeLens.descriptor.documentVersion) {
        return codeLens;
      }
      const model = buildDeclarationLenses(codeLens.descriptor, bundle)
        .find((item) => item.kind === codeLens.kind);
      if (!model) return codeLens;
      const outcome = await this.engine.outcomeForCandidates(
        codeLens.descriptor.documentUri,
        model.candidates,
        model.mode,
      );
      if (outcome.mode === 'none') return codeLens;
      codeLens.command = {
        title: model.title,
        command: COMMANDS.openCodeLensTargets,
        arguments: [
          codeLens.descriptor.documentUri,
          codeLens.descriptor.tokenRange.start,
          outcome.mode,
          outcome.targets,
        ],
      };
      return codeLens;
    } catch {
      return codeLens;
    }
  }

  refresh(): void {
    this.#changed.fire();
  }

  dispose(): void {
    this.#changed.dispose();
  }
}

function isPosition(value: unknown): value is Position {
  if (!value || typeof value !== 'object') return false;
  const position = value as Partial<Position>;
  return Number.isInteger(position.line) && Number.isInteger(position.character);
}

function isTarget(value: unknown): value is LocationTarget {
  if (!value || typeof value !== 'object') return false;
  const target = value as Partial<LocationTarget>;
  return typeof target.uri === 'string'
    && Boolean(target.range)
    && isPosition(target.range?.start)
    && isPosition(target.range?.end);
}

export function registerDeclarationCodeLens(
  subscriptions: { push(...items: vscode.Disposable[]): unknown },
  selector: vscode.DocumentSelector,
  engine: NavigationEngine,
  adapter: JavaSyntaxAdapter,
): { refreshCodeLenses(): void } {
  const provider = new DeclarationCodeLensProvider(engine, adapter);
  const registration = vscode.languages.registerCodeLensProvider(selector, provider);
  const command = vscode.commands.registerCommand(
    COMMANDS.openCodeLensTargets,
    async (
      sourceUriText: unknown,
      sourcePositionValue: unknown,
      mode: unknown,
      targetValues: unknown,
    ) => {
      if (typeof sourceUriText !== 'string'
          || !isPosition(sourcePositionValue)
          || (mode !== 'direct' && mode !== 'peek')
          || !Array.isArray(targetValues)) return;
      const targets = targetValues.filter(isTarget);
      if (targets.length === 0) return;
      if (mode === 'direct' && targets.length === 1) {
        const target = targets[0]!;
        await vscode.window.showTextDocument(vscode.Uri.parse(target.uri), {
          preview: true,
          selection: range(target.range),
        });
        return;
      }
      const locations = targets.map((target) =>
        new vscode.Location(vscode.Uri.parse(target.uri), range(target.range)));
      await vscode.commands.executeCommand(
        'editor.action.peekLocations',
        vscode.Uri.parse(sourceUriText),
        new vscode.Position(sourcePositionValue.line, sourcePositionValue.character),
        locations,
        'peek',
      );
    },
  );
  subscriptions.push(provider, registration, command);
  return { refreshCodeLenses: () => provider.refresh() };
}
