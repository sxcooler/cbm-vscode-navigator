import { describe, expect, it } from 'vitest';
import type { NavigationCandidate, SymbolContext } from '../contracts.js';
import { rankCandidates } from './ranker.js';

const context: SymbolContext = {
  documentUri: 'file:///repo/Caller.java',
  documentVersion: 1,
  languageId: 'java',
  position: { line: 0, character: 0 },
  tokenRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
  name: 'run',
  kind: 'method',
  role: 'invocation',
  receiverTypeHint: 'demo.Service',
  argumentCount: 1,
  imports: [],
};

function candidate(overrides: Partial<NavigationCandidate> = {}): NavigationCandidate {
  return {
    kind: 'method',
    qualifiedName: 'demo.Service.run',
    relationship: 'CALLS',
    filePath: 'src/Service.java',
    startLine: 3,
    endLine: 3,
    signature: 'run(String)',
    receiverType: 'demo.Service',
    confidence: 0.93,
    strategy: 'lsp',
    indexed: true,
    excluded: false,
    concrete: true,
    evidence: ['receiver', 'signature'],
    ...overrides,
  };
}

describe('rankCandidates', () => {
  it('puts a compatible direct semantic match in tier one', () => {
    expect(rankCandidates(context, [candidate()], { minimumDirectConfidence: 0.85 }))
      .toMatchObject([{ tier: 1, direct: true }]);
  });

  it('keeps structural and heuristic candidates out of silent direct navigation', () => {
    const ranked = rankCandidates(context, [
      candidate({ relationship: 'IMPLEMENTS', confidence: 0.8 }),
      candidate({ qualifiedName: 'demo.Other.run', strategy: 'heuristic' }),
    ], { minimumDirectConfidence: 0.85 });
    expect(ranked.map(({ tier, direct }) => ({ tier, direct }))).toEqual([
      { tier: 2, direct: false },
      { tier: 3, direct: false },
    ]);
  });

  it('keeps an exact indexed definition when CBM has no scoring metadata', () => {
    const { confidence: _confidence, strategy: _strategy, ...exactDefinition } = candidate({
      relationship: 'DEFINES',
    });
    const ranked = rankCandidates(context, [exactDefinition], { minimumDirectConfidence: 0.85 });
    expect(ranked).toMatchObject([{ tier: 2, direct: false }]);
  });

  it('accepts a simple Java receiver hint for a qualified CBM receiver', () => {
    const ranked = rankCandidates(
      { ...context, receiverTypeHint: 'AsyncService' },
      [candidate({
        relationship: 'IMPLEMENTS',
        receiverType: 'project.module.com.example.AsyncService',
      })],
      { minimumDirectConfidence: 0.85 },
    );
    expect(ranked).toHaveLength(1);
  });

  it('hard-rejects unsafe, incompatible, and unresolved candidates', () => {
    const ranked = rankCandidates(context, [
      candidate({ indexed: false }),
      candidate({ excluded: true }),
      candidate({ strategy: 'unresolved' }),
      candidate({ kind: 'field' }),
      candidate({ signature: 'run()' }),
      candidate({ receiverType: 'demo.Unrelated' }),
      candidate({ qualifiedName: 'demo.Service.stop' }),
    ], { minimumDirectConfidence: 0.85 });
    expect(ranked).toEqual([]);
  });
});
