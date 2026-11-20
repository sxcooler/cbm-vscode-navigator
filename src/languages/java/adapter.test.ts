import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Position, TextDocumentLike } from '../../contracts.js';
import { JavaSyntaxAdapter, TreeSitterJavaParser } from './adapter.js';

const fixtureRoot = resolve('examples/java/src/main/java/dev/cbm/fixture');
const grammarPath = resolve('node_modules/tree-sitter-java/tree-sitter-java.wasm');

function fixturePath(relativePath: string): string {
  return resolve(fixtureRoot, relativePath);
}

async function fixtureSource(relativePath: string): Promise<string> {
  return readFile(fixturePath(relativePath), 'utf8');
}

function positionOf(source: string, needle: string, occurrence = 1): Position {
  let offset = -1;
  for (let index = 0; index < occurrence; index += 1) {
    offset = source.indexOf(needle, offset + 1);
  }
  const before = source.slice(0, offset);
  const lines = before.split('\n');
  return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 };
}

function document(
  source: string,
  version = 1,
  uri = 'file:///TaskController.java',
): TextDocumentLike {
  return { uri, version, languageId: 'java', getText: () => source };
}

describe('JavaSyntaxAdapter', () => {
  it('enumerates declarations across the fixture project source files', async () => {
    const parser = await TreeSitterJavaParser.create(grammarPath);
    const adapter = new JavaSyntaxAdapter(parser);
    const relativePaths = [
      'api/TaskService.java',
      'impl/FastTaskService.java',
      'model/TaskMode.java',
      'model/TaskRequest.java',
      'web/TaskController.java',
    ];
    const declarations = (await Promise.all(relativePaths.map(async (relativePath) => {
      const source = await fixtureSource(relativePath);
      return adapter.getDeclarations(document(
        source,
        1,
        pathToFileURL(fixturePath(relativePath)).toString(),
      ));
    }))).flat();

    expect(declarations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'TaskService', kind: 'type', packageName: 'dev.cbm.fixture.api',
        abstract: true, override: false,
      }),
      expect.objectContaining({
        name: 'execute', kind: 'method', ownerName: 'TaskService', argumentCount: 1,
        signatureHint: 'execute/1', abstract: true, override: false,
      }),
      expect.objectContaining({
        name: 'FastTaskService', kind: 'constructor', ownerName: 'FastTaskService', argumentCount: 0,
        signatureHint: 'FastTaskService/0', abstract: false, override: false,
      }),
      expect.objectContaining({
        name: 'invocationCount', kind: 'field', ownerName: 'TaskController',
        abstract: false, override: false,
      }),
      expect.objectContaining({
        name: 'execute', kind: 'method', ownerName: 'FastTaskService', argumentCount: 1,
        signatureHint: 'execute/1', abstract: false, override: true,
      }),
      expect.objectContaining({ name: 'TaskRequest', kind: 'type' }),
      expect.objectContaining({ name: 'TaskMode', kind: 'type' }),
    ]));
    expect(declarations.every((item) => item.documentVersion === 1)).toBe(true);
    expect(declarations.every((item) => item.tokenRange.start.line >= item.declarationRange.start.line))
      .toBe(true);
  });

  it('extracts package, imports, owning symbols, receiver, and exact invocation arity', async () => {
    const relativePath = 'web/TaskController.java';
    const source = await fixtureSource(relativePath);
    const parser = await TreeSitterJavaParser.create(grammarPath);
    const adapter = new JavaSyntaxAdapter(parser);
    const context = await adapter.getSymbolContext(
      document(source, 1, pathToFileURL(fixturePath(relativePath)).toString()),
      positionOf(source, 'execute(normalize(request))'),
    );
    expect(context).toMatchObject({
      name: 'execute', kind: 'method', role: 'invocation', receiverText: 'taskService',
      argumentCount: 1, enclosingType: 'TaskController', enclosingCallable: 'submit',
      packageName: 'dev.cbm.fixture.web',
    });
    expect(context?.imports).toEqual([
      {
        name: 'TaskService', qualifiedName: 'dev.cbm.fixture.api.TaskService',
        isStatic: false, wildcard: false,
      },
      {
        name: 'TaskRequest', qualifiedName: 'dev.cbm.fixture.model.TaskRequest',
        isStatic: false, wildcard: false,
      },
      {
        name: 'normalize', qualifiedName: 'dev.cbm.fixture.support.TaskRequests.normalize',
        isStatic: true, wildcard: false,
      },
    ]);
    expect(context?.tokenRange).toEqual({
      start: positionOf(source, 'execute(normalize(request))'),
      end: {
        ...positionOf(source, 'execute(normalize(request))'),
        character: positionOf(source, 'execute(normalize(request))').character + 7,
      },
    });
  });

  it('distinguishes two calls on one line', async () => {
    const source = await fixtureSource('web/TaskController.java');
    const parser = await TreeSitterJavaParser.create(grammarPath);
    const adapter = new JavaSyntaxAdapter(parser);
    const context = await adapter.getSymbolContext(document(source), positionOf(source, 'status()'));
    expect(context).toMatchObject({ name: 'status', receiverText: 'taskService', argumentCount: 0 });
  });

  it.each([
    ['api/TaskService.java', 'TaskService', 'type'],
    ['model/TaskRequest.java', 'TaskRequest', 'type'],
    ['model/TaskMode.java', 'TaskMode', 'type'],
    ['web/TaskController.java', 'request) {', 'parameter'],
    ['web/TaskController.java', 'local =', 'local'],
  ])('classifies declaration %s:%s as %s', async (relativePath, needle, kind) => {
    const source = await fixtureSource(relativePath);
    const parser = await TreeSitterJavaParser.create(grammarPath);
    const adapter = new JavaSyntaxAdapter(parser);
    const context = await adapter.getSymbolContext(
      document(source, 1, pathToFileURL(fixturePath(relativePath)).toString()),
      positionOf(source, needle),
    );
    expect(context).toMatchObject({ kind, role: 'declaration' });
  });

  it('uses the current unsaved version and tolerates incomplete syntax', async () => {
    const source = 'class Draft { void test() { client.call(';
    const parser = await TreeSitterJavaParser.create(grammarPath);
    const adapter = new JavaSyntaxAdapter(parser);
    const context = await adapter.getSymbolContext(document(source, 7), positionOf(source, 'call'));
    expect(context).toMatchObject({ documentVersion: 7, name: 'call', role: 'invocation' });
  });

  it('discards declaration results from an older document version', async () => {
    const adapter = new JavaSyntaxAdapter({
      analyze: async () => undefined,
      declarations: async () => [{
        documentUri: 'file:///TaskController.java', documentVersion: 3,
        name: 'Draft', kind: 'type',
        tokenRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
        declarationRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 14 } },
        abstract: false, override: false,
      }],
      disposeDocument() {},
    });

    await expect(adapter.getDeclarations(document('class Draft {}', 4))).resolves.toEqual([]);
  });

  it('releases a cached tree when a document closes', async () => {
    const parser = await TreeSitterJavaParser.create(grammarPath);
    const adapter = new JavaSyntaxAdapter(parser);
    await adapter.getSymbolContext(document('class A {}'), { line: 0, character: 6 });
    expect(parser.cachedDocumentCount).toBe(1);
    adapter.disposeDocument('file:///TaskController.java');
    expect(parser.cachedDocumentCount).toBe(0);
  });

  it('does not reuse a local declaration from another callable scope', async () => {
    const source = 'class A { void first(){ int value = 1; } void second(){ use(value); } }';
    const parser = await TreeSitterJavaParser.create(grammarPath);
    const adapter = new JavaSyntaxAdapter(parser);
    const context = await adapter.getSymbolContext(document(source), positionOf(source, 'value', 2));
    expect(context?.localDeclarationRange).toBeUndefined();
  });

  it('does not promote a field to a local declaration', async () => {
    const source = 'class A { int value; void test(){ use(value); } }';
    const parser = await TreeSitterJavaParser.create(grammarPath);
    const adapter = new JavaSyntaxAdapter(parser);
    const context = await adapter.getSymbolContext(document(source), positionOf(source, 'value', 2));
    expect(context?.localDeclarationRange).toBeUndefined();
  });
});
