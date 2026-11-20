import { Worker } from 'node:worker_threads';
import type { DeclarationDescriptor, Position, SymbolContext } from '../../contracts.js';
import type {
  JavaParserBackend,
  JavaParserRequest,
  JavaParserResponse,
} from './parserProtocol.js';

export interface WorkerLike {
  postMessage(message: JavaParserRequest): void;
  on(event: 'message', listener: (message: JavaParserResponse) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  terminate(): Promise<number>;
}

interface PendingRequest {
  readonly resolve: (response: Extract<JavaParserResponse, { readonly ok: true }>) => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
}

type JavaParserRequestWithoutId = JavaParserRequest extends infer Request
  ? Request extends { readonly id: number } ? Omit<Request, 'id'> : never
  : never;

export class WorkerJavaParser implements JavaParserBackend {
  #nextId = 1;
  readonly #pending = new Map<number, PendingRequest>();

  constructor(readonly worker: WorkerLike) {
    worker.on('message', (message) => this.#handleMessage(message));
    worker.on('error', (error) => this.#failAll(error));
    worker.on('exit', (code) => {
      if (code !== 0) this.#failAll(new Error(`Java parser worker exited with code ${code}`));
    });
  }

  static create(workerScriptPath: string, grammarWasmPath: string): WorkerJavaParser {
    return new WorkerJavaParser(new Worker(workerScriptPath, {
      workerData: { grammarWasmPath },
    }));
  }

  analyze(
    uri: string,
    version: number,
    source: string,
    position: Position,
    signal?: AbortSignal,
  ): Promise<SymbolContext | undefined> {
    return this.#request({
      type: 'analyze', uri, version, source,
      position: { line: position.line, character: position.character },
    }, signal).then((response) => response?.context);
  }

  declarations(
    uri: string,
    version: number,
    source: string,
    signal?: AbortSignal,
  ): Promise<readonly DeclarationDescriptor[]> {
    return this.#request({ type: 'declarations', uri, version, source }, signal)
      .then((response) => response?.declarations ?? []);
  }

  #request(
    request: JavaParserRequestWithoutId,
    signal?: AbortSignal,
  ): Promise<Extract<JavaParserResponse, { readonly ok: true }> | undefined> {
    if (signal?.aborted) return Promise.resolve(undefined);
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.#pending.delete(id);
        resolve(undefined);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#pending.set(id, {
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', onAbort),
      });
      this.worker.postMessage({ id, ...request } as JavaParserRequest);
    });
  }

  disposeDocument(uri: string): void {
    this.worker.postMessage({ id: this.#nextId++, type: 'dispose', uri });
  }

  async dispose(): Promise<void> {
    this.#failAll(new Error('Java parser disposed'));
    await this.worker.terminate();
  }

  #handleMessage(message: JavaParserResponse): void {
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    pending.cleanup();
    if (message.ok) pending.resolve(message);
    else pending.reject(new Error(message.error));
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
