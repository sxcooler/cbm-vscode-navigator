import { parentPort, workerData } from 'node:worker_threads';
import { TreeSitterJavaParser } from './javaAnalysis.js';
import type { JavaParserRequest, JavaParserResponse } from './parserProtocol.js';

const port = parentPort;
if (!port) throw new Error('Java parser worker requires a parent port');

const data = workerData as { readonly grammarWasmPath: string };
const parserPromise = TreeSitterJavaParser.create(data.grammarWasmPath);

port.on('message', async (request: JavaParserRequest) => {
  try {
    const parser = await parserPromise;
    if (request.type === 'dispose') {
      parser.disposeDocument(request.uri);
      port.postMessage({ id: request.id, ok: true } satisfies JavaParserResponse);
      return;
    }
    if (request.type === 'declarations') {
      const declarations = await parser.declarations(
        request.uri,
        request.version,
        request.source,
      );
      port.postMessage({ id: request.id, ok: true, declarations } satisfies JavaParserResponse);
      return;
    }
    const context = await parser.analyze(
      request.uri,
      request.version,
      request.source,
      request.position,
    );
    port.postMessage({
      id: request.id,
      ok: true,
      ...(context ? { context } : {}),
    } satisfies JavaParserResponse);
  } catch (error) {
    port.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies JavaParserResponse);
  }
});
