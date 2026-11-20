import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { WorkerJavaParser, type WorkerLike } from './workerParser.js';

class FakeWorker extends EventEmitter implements WorkerLike {
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn(async () => 0);
}

class GetterPosition {
  constructor(
    private readonly _line: number,
    private readonly _character: number,
  ) {}

  get line(): number { return this._line; }
  get character(): number { return this._character; }
}

describe('WorkerJavaParser', () => {
  it('performs parsing through a worker message boundary', async () => {
    const worker = new FakeWorker();
    const parser = new WorkerJavaParser(worker);
    const pending = parser.analyze('file:///A.java', 3, 'class A {}', { line: 0, character: 6 });
    expect(worker.postMessage).toHaveBeenCalledWith({
      id: 1, type: 'analyze', uri: 'file:///A.java', version: 3,
      source: 'class A {}', position: { line: 0, character: 6 },
    });
    worker.emit('message', {
      id: 1, ok: true,
      context: {
        documentUri: 'file:///A.java', documentVersion: 3, languageId: 'java',
        position: { line: 0, character: 6 },
        tokenRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
        name: 'A', kind: 'type', role: 'declaration', imports: [],
      },
    });
    await expect(pending).resolves.toMatchObject({ name: 'A', documentVersion: 3 });
  });

  it('snapshots getter-backed editor positions before structured cloning', async () => {
    const worker = new FakeWorker();
    const parser = new WorkerJavaParser(worker);
    const pending = parser.analyze(
      'file:///A.java',
      3,
      'class A {}',
      new GetterPosition(0, 6),
    );
    const request = structuredClone(worker.postMessage.mock.calls[0]![0]) as {
      position: unknown;
    };
    expect(request.position).toEqual({ line: 0, character: 6 });
    worker.emit('message', { id: 1, ok: true });
    await expect(pending).resolves.toBeUndefined();
  });

  it('enumerates declarations through a plain worker request', async () => {
    const worker = new FakeWorker();
    const parser = new WorkerJavaParser(worker);
    const pending = parser.declarations('file:///A.java', 3, 'class A {}');
    expect(worker.postMessage).toHaveBeenCalledWith({
      id: 1, type: 'declarations', uri: 'file:///A.java', version: 3, source: 'class A {}',
    });
    worker.emit('message', {
      id: 1, ok: true,
      declarations: [{
        documentUri: 'file:///A.java', documentVersion: 3,
        name: 'A', kind: 'type',
        tokenRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
        declarationRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        abstract: false, override: false,
      }],
    });
    await expect(pending).resolves.toMatchObject([{ name: 'A', documentVersion: 3 }]);
  });

  it('sends document disposal and terminates cleanly', async () => {
    const worker = new FakeWorker();
    const parser = new WorkerJavaParser(worker);
    parser.disposeDocument('file:///A.java');
    expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, type: 'dispose', uri: 'file:///A.java' });
    await parser.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
