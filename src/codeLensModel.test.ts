import { describe, expect, it } from 'vitest';
import type {
  DeclarationDescriptor,
  DeclarationRelationBundle,
  NavigationCandidate,
} from './contracts.js';
import { buildDeclarationLenses } from './codeLensModel.js';

const descriptor: DeclarationDescriptor = {
  documentUri: 'file:///repo/Worker.java', documentVersion: 1,
  name: 'run', kind: 'method',
  tokenRange: { start: { line: 1, character: 7 }, end: { line: 1, character: 10 } },
  declarationRange: { start: { line: 1, character: 2 }, end: { line: 1, character: 16 } },
  packageName: 'demo', ownerName: 'Worker', argumentCount: 0, signatureHint: 'run/0',
  abstract: true, override: false,
};

function candidate(name: string, filePath: string): NavigationCandidate {
  return {
    kind: 'method', qualifiedName: name, relationship: 'CALLS', filePath,
    startLine: 1, endLine: 1, confidence: 0.96, strategy: 'lsp', indexed: true,
    evidence: ['CALLS'],
  };
}

function bundle(overrides: Partial<DeclarationRelationBundle> = {}): DeclarationRelationBundle {
  return {
    selected: descriptor, family: [], declarations: [], implementations: [], callers: [], references: [],
    ...overrides,
  };
}

describe('buildDeclarationLenses', () => {
  it('shows a direct declaration link and always peeks callers', () => {
    expect(buildDeclarationLenses(descriptor, bundle({
      declarations: [candidate('demo.Worker.run', 'Worker.java')],
      callers: [candidate('demo.Worker.run', 'FirstCaller.java'), candidate('demo.Worker.run', 'SecondCaller.java')],
    }))).toEqual([
      expect.objectContaining({ kind: 'declaration', title: '↑ declaration', mode: 'direct' }),
      expect.objectContaining({ kind: 'callers', title: '2 callers', mode: 'peek' }),
    ]);
  });

  it('shows implementation and reference counts with the required presentation modes', () => {
    const type = { ...descriptor, name: 'Worker', kind: 'type' as const };
    expect(buildDeclarationLenses(type, bundle({
      selected: type,
      implementations: [
        candidate('demo.FastWorker', 'FastWorker.java'),
        candidate('demo.SafeWorker', 'SafeWorker.java'),
      ],
      references: [candidate('demo.Worker', 'TypeUser.java')],
    }))).toEqual([
      expect.objectContaining({ kind: 'implementations', title: '↓ 2 implementations', mode: 'peek' }),
      expect.objectContaining({ kind: 'references', title: '1 reference', mode: 'peek' }),
    ]);
  });

  it('omits empty relationships and directly opens one implementation', () => {
    expect(buildDeclarationLenses(descriptor, bundle({
      implementations: [candidate('demo.FastWorker.run', 'FastWorker.java')],
    }))).toEqual([
      expect.objectContaining({ kind: 'implementations', title: '↓ 1 implementation', mode: 'direct' }),
    ]);
  });
});
