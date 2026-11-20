import { describe, expect, it } from 'vitest';
import type { RankedCandidate } from '../contracts.js';
import { chooseNavigation, normalizeLocations } from './results.js';

const base: RankedCandidate = {
  kind: 'method', qualifiedName: 'a.Service.run', relationship: 'CALLS',
  filePath: 'a.java', startLine: 1, endLine: 1, evidence: [], tier: 1, direct: true,
};

describe('navigation result policy', () => {
  it('directs only one tier-one candidate and uses peek for ambiguity', () => {
    expect(chooseNavigation([base])).toEqual({ kind: 'direct', candidates: [base] });
    const second = { ...base, qualifiedName: 'b.Service.run', filePath: 'b.java' };
    expect(chooseNavigation([base, second])).toEqual({ kind: 'peek', candidates: [base, second] });
    expect(chooseNavigation([{ ...base, tier: 3, direct: false }])).toEqual({ kind: 'none', candidates: [] });
  });

  it('sorts and deduplicates precise locations', () => {
    const locations = normalizeLocations([
      { uri: 'file:///b', range: { start: { line: 2, character: 1 }, end: { line: 2, character: 4 } } },
      { uri: 'file:///a', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } } },
      { uri: 'file:///a', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } } },
    ]);
    expect(locations.map((item) => item.uri)).toEqual(['file:///a', 'file:///b']);
  });
});
