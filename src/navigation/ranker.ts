import type { NavigationCandidate, RankedCandidate, SymbolContext } from '../contracts.js';

export interface RankingPolicy {
  readonly minimumDirectConfidence: number;
  readonly requireConcrete?: boolean;
}

function simpleName(qualifiedName: string): string {
  const hashFree = qualifiedName.replace(/#.*$/, '');
  return hashFree.slice(hashFree.lastIndexOf('.') + 1);
}

function compatibleReceiver(hint: string, candidate: string): boolean {
  if (hint === candidate || candidate.endsWith(`.${hint}`)) return true;
  if (hint.includes('.')) return false;
  return simpleName(candidate) === hint;
}

function signatureArity(signature: string | undefined): number | undefined {
  if (!signature) return undefined;
  const start = signature.indexOf('(');
  const end = signature.lastIndexOf(')');
  if (start < 0 || end < start) return undefined;
  const body = signature.slice(start + 1, end).trim();
  if (!body) return 0;
  let depth = 0;
  let count = 1;
  for (const character of body) {
    if ('<([{'.includes(character)) depth += 1;
    else if ('>)]}'.includes(character)) depth -= 1;
    else if (character === ',' && depth === 0) count += 1;
  }
  return count;
}

function compatibleKind(context: SymbolContext, candidate: NavigationCandidate): boolean {
  if (context.kind === 'unknown') return true;
  const kind = candidate.kind.toLowerCase();
  if (context.kind === 'type') return ['type', 'class', 'interface', 'enum', 'record'].includes(kind);
  return context.kind === kind;
}

function hardFilter(context: SymbolContext, candidate: NavigationCandidate, policy: RankingPolicy): boolean {
  if (candidate.indexed === false || candidate.excluded === true) return false;
  if (candidate.strategy === 'unresolved') return false;
  if (!compatibleKind(context, candidate)) return false;
  if (simpleName(candidate.qualifiedName) !== context.name) return false;
  if (policy.requireConcrete && candidate.concrete !== true) return false;
  const arity = signatureArity(candidate.signature);
  if (context.argumentCount !== undefined && arity !== undefined && arity !== context.argumentCount) return false;
  if (context.receiverTypeHint && candidate.receiverType
      && !compatibleReceiver(context.receiverTypeHint, candidate.receiverType)) return false;
  return true;
}

function tierFor(candidate: NavigationCandidate, minimum: number): 1 | 2 | 3 {
  const directRelationship = ['CALLS', 'CALL_REFERENCE', 'USAGE', 'DEFINES'].includes(candidate.relationship);
  if (directRelationship
      && (candidate.strategy === 'lsp' || candidate.strategy === 'language_rule')
      && (candidate.confidence ?? 0) >= minimum) return 1;
  if (candidate.strategy !== 'heuristic'
      && ['DEFINES', 'IMPLEMENTS', 'INHERITS', 'CALLS', 'CALL_REFERENCE', 'USAGE'].includes(candidate.relationship)) return 2;
  return 3;
}

export function rankCandidates(
  context: SymbolContext,
  candidates: readonly NavigationCandidate[],
  policy: RankingPolicy,
): RankedCandidate[] {
  return candidates
    .filter((candidate) => hardFilter(context, candidate, policy))
    .map((candidate) => {
      const tier = tierFor(candidate, policy.minimumDirectConfidence);
      return { ...candidate, tier, direct: tier === 1 };
    })
    .sort((left, right) => left.tier - right.tier
      || (right.confidence ?? 0) - (left.confidence ?? 0)
      || left.qualifiedName.localeCompare(right.qualifiedName));
}
