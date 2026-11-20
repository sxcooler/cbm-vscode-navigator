/// <reference types="mocha" />
import assert from 'node:assert/strict';
import * as vscode from 'vscode';

function locationPath(location: unknown): string | undefined {
  if (!location || typeof location !== 'object') return undefined;
  const value = location as { uri?: vscode.Uri; targetUri?: vscode.Uri };
  return (value.targetUri ?? value.uri)?.fsPath.replace(/\\/g, '/');
}

async function waitForLocations(
  command: string,
  uri: vscode.Uri,
  position: vscode.Position,
): Promise<readonly unknown[]> {
  const deadline = Date.now() + 15_000;
  let locations: readonly unknown[] | undefined;
  do {
    locations = await vscode.commands.executeCommand<readonly unknown[]>(command, uri, position);
    if (locations?.length) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  return locations ?? [];
}

async function waitForCodeLenses(
  uri: vscode.Uri,
  targetLine: number,
): Promise<readonly vscode.CodeLens[]> {
  const deadline = Date.now() + 15_000;
  let lenses: readonly vscode.CodeLens[] = [];
  do {
    lenses = await vscode.commands.executeCommand<readonly vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      uri,
    ) ?? [];
    if (lenses.some((lens) => lens.range.start.line === targetLine)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  return lenses;
}

suite('CBM Navigator extension', () => {
  test('activates and registers its user commands without Java runtime variables', async () => {
    assert.ok(!process.env.JAVA_HOME);
    assert.ok(!process.env.JRE_HOME);
    const extension = vscode.extensions.getExtension('sxcooler.cbm-vscode-navigator');
    assert.ok(extension, 'extension is discoverable');
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('cbmNavigator.showStatus'));
    assert.ok(commands.includes('cbmNavigator.retryConnection'));
    assert.ok(commands.includes('cbmNavigator.goToDeclaration'));
    assert.ok(commands.includes('cbmNavigator.enableIdeaKeymap'));
    assert.ok(commands.includes('cbmNavigator.ideaGoToDefinition'));
    assert.ok(commands.includes('cbmNavigator.ideaGoToImplementation'));
    assert.ok(commands.includes('cbmNavigator.ideaGoToReferences'));
  });

  test('provides live declaration CodeLens candidates through the actual provider', async function () {
    const liveFile = process.env.CBM_INTEGRATION_CODELENS_FILE;
    const liveSymbol = process.env.CBM_INTEGRATION_CODELENS_SYMBOL;
    const liveLine = Number(process.env.CBM_INTEGRATION_CODELENS_LINE);
    if (!liveFile || !liveSymbol || !Number.isInteger(liveLine)) this.skip();
    this.timeout(30_000);

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(liveFile!));
    const lenses = await waitForCodeLenses(document.uri, liveLine - 1);
    const line = document.lineAt(liveLine - 1);
    const symbolStart = line.text.indexOf(liveSymbol!);
    assert.ok(symbolStart >= 0, 'configured CodeLens symbol is present');
    assert.ok(lenses.some((lens) => lens.range.start.line === liveLine - 1),
      'declaration has a CodeLens candidate');
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('cbmNavigator.openCodeLensTargets'));
  });

  test('resolves live Java navigation through the actual VS Code providers', async function () {
    const liveFile = process.env.CBM_INTEGRATION_FILE;
    const liveSymbol = process.env.CBM_INTEGRATION_SYMBOL;
    const liveLine = Number(process.env.CBM_INTEGRATION_LINE);
    const expectedDefinitionSuffix = process.env.CBM_INTEGRATION_EXPECT_DEFINITION_SUFFIX
      ?.replace(/\\/g, '/');
    if (!liveFile || !liveSymbol || !Number.isInteger(liveLine)) this.skip();
    this.timeout(30_000);

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(liveFile!));
    await vscode.window.showTextDocument(document);
    const line = document.lineAt(liveLine - 1);
    const symbolStart = line.text.indexOf(liveSymbol!);
    assert.ok(symbolStart >= 0, `${liveSymbol} is present on line ${liveLine}`);
    const position = new vscode.Position(liveLine - 1, symbolStart + 1);
    const commands = [
      'vscode.executeDefinitionProvider',
      'vscode.executeImplementationProvider',
      'vscode.executeReferenceProvider',
    ] as const;
    for (const command of commands) {
      const locations = await waitForLocations(command, document.uri, position);
      assert.ok(locations.length > 0, `${command} returns at least one location`);
      if (command === 'vscode.executeDefinitionProvider' && expectedDefinitionSuffix) {
        assert.equal(locations.length, 1, `${command} returns one concrete target`);
        assert.ok(
          locations.some((location) => locationPath(location)?.endsWith(expectedDefinitionSuffix)),
          `${command} includes the expected concrete target`,
        );
      }
    }
  });

  test('resolves live type references through the actual VS Code provider', async function () {
    const liveFile = process.env.CBM_INTEGRATION_REFERENCE_FILE;
    const liveSymbol = process.env.CBM_INTEGRATION_REFERENCE_SYMBOL;
    const liveLine = Number(process.env.CBM_INTEGRATION_REFERENCE_LINE);
    const expectedSuffix = process.env.CBM_INTEGRATION_EXPECT_REFERENCE_SUFFIX
      ?.replace(/\\/g, '/');
    if (!liveFile || !liveSymbol || !Number.isInteger(liveLine) || !expectedSuffix) this.skip();
    this.timeout(30_000);

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(liveFile!));
    const line = document.lineAt(liveLine - 1);
    const symbolStart = line.text.indexOf(liveSymbol!);
    assert.ok(symbolStart >= 0, `${liveSymbol} is present on line ${liveLine}`);
    const locations = await waitForLocations(
      'vscode.executeReferenceProvider',
      document.uri,
      new vscode.Position(liveLine - 1, symbolStart + 1),
    );
    assert.ok(
      locations.some((location) => locationPath(location)?.endsWith(expectedSuffix!)),
      'reference results include the expected source file',
    );
  });
});
