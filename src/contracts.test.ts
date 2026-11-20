import { describe, expect, it } from 'vitest';
import { createInitialRootState } from './contracts.js';

describe('createInitialRootState', () => {
  it('keeps untrusted roots inert', () => {
    expect(createInitialRootState('C:/repo', false)).toEqual({
      root: 'C:/repo',
      kind: 'Untrusted',
    });
  });

  it('does not manufacture a runtime for a trusted root', () => {
    expect(createInitialRootState('C:/repo', true)).toEqual({
      root: 'C:/repo',
      kind: 'Missing',
    });
  });
});
