import { describe, expect, it } from 'vitest';
import { rootIdentity } from './rootIdentity.js';

describe('rootIdentity', () => {
  it('matches CBM forward-slash paths with Windows realpath output', () => {
    expect(rootIdentity('C:\\Repo\\Source\\', 'win32'))
      .toBe(rootIdentity('c:/repo/source', 'win32'));
  });

  it('preserves case significance on Linux', () => {
    expect(rootIdentity('/repo/Source', 'linux')).not.toBe(rootIdentity('/repo/source', 'linux'));
  });
});
