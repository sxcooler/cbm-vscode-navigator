import type { Range, RankedCandidate } from '../contracts.js';

export interface LocationTarget {
  readonly uri: string;
  readonly range: Range;
}

export type NavigationChoice =
  | { readonly kind: 'direct'; readonly candidates: readonly RankedCandidate[] }
  | { readonly kind: 'peek'; readonly candidates: readonly RankedCandidate[] }
  | { readonly kind: 'none'; readonly candidates: readonly RankedCandidate[] };

export function chooseNavigation(candidates: readonly RankedCandidate[]): NavigationChoice {
  const tierOne = candidates.filter((candidate) => candidate.tier === 1);
  if (tierOne.length === 1) return { kind: 'direct', candidates: tierOne };
  if (tierOne.length > 1) return { kind: 'peek', candidates: tierOne };
  const structural = candidates.filter((candidate) => candidate.tier === 2);
  if (structural.length > 0) return { kind: 'peek', candidates: structural };
  return { kind: 'none', candidates: [] };
}

function key(target: LocationTarget): string {
  const { start, end } = target.range;
  return `${target.uri}:${start.line}:${start.character}:${end.line}:${end.character}`;
}

export function normalizeLocations(targets: readonly LocationTarget[]): LocationTarget[] {
  const unique = new Map(targets.map((target) => [key(target), target]));
  return [...unique.values()].sort((left, right) =>
    left.uri.localeCompare(right.uri)
    || left.range.start.line - right.range.start.line
    || left.range.start.character - right.range.start.character
    || left.range.end.line - right.range.end.line
    || left.range.end.character - right.range.end.character);
}
