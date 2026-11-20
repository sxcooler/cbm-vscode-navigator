import type {
  DeclarationDescriptor,
  DeclarationRelationBundle,
  NavigationCandidate,
} from './contracts.js';

export type DeclarationLensKind = 'declaration' | 'implementations' | 'callers' | 'references';

export interface DeclarationLensModel {
  readonly kind: DeclarationLensKind;
  readonly title: string;
  readonly mode: 'direct' | 'peek';
  readonly candidates: readonly NavigationCandidate[];
}

function countTitle(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function potentialLensKinds(descriptor: DeclarationDescriptor): DeclarationLensKind[] {
  if (descriptor.kind === 'field') return ['references'];
  if (descriptor.kind === 'type') return ['declaration', 'implementations', 'references'];
  return ['declaration', 'implementations', 'callers'];
}

export function buildDeclarationLenses(
  descriptor: DeclarationDescriptor,
  bundle: DeclarationRelationBundle,
): DeclarationLensModel[] {
  const lenses: DeclarationLensModel[] = [];
  if (bundle.declarations.length > 0) {
    lenses.push({
      kind: 'declaration',
      title: '↑ declaration',
      mode: bundle.declarations.length === 1 ? 'direct' : 'peek',
      candidates: bundle.declarations,
    });
  } else if (bundle.implementations.length > 0) {
    lenses.push({
      kind: 'implementations',
      title: `↓ ${countTitle(bundle.implementations.length, 'implementation', 'implementations')}`,
      mode: bundle.implementations.length === 1 ? 'direct' : 'peek',
      candidates: bundle.implementations,
    });
  }
  if (descriptor.kind === 'method' || descriptor.kind === 'constructor') {
    if (bundle.callers.length > 0) {
      lenses.push({
        kind: 'callers',
        title: countTitle(bundle.callers.length, 'caller', 'callers'),
        mode: 'peek',
        candidates: bundle.callers,
      });
    }
  } else if (bundle.references.length > 0) {
    lenses.push({
      kind: 'references',
      title: countTitle(bundle.references.length, 'reference', 'references'),
      mode: 'peek',
      candidates: bundle.references,
    });
  }
  return lenses;
}
