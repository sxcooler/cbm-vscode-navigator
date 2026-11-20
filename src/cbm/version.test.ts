import { describe, expect, it } from 'vitest';
import { isSupportedVersion, parseSemVer } from './version.js';

describe('parseSemVer', () => {
  it.each([
    ['0.10.8', { major: 0, minor: 10, patch: 8 }],
    ['codebase-memory-mcp 1.2.3', { major: 1, minor: 2, patch: 3 }],
    ['v2.0.0-beta.1+build.4', { major: 2, minor: 0, patch: 0 }],
  ])('parses strict version output %s', (input, expected) => {
    expect(parseSemVer(input)).toEqual(expected);
  });

  it.each(['0.10', 'version 0.10.8 trailing', '01.2.3', '0.10.8.1', '']) (
    'rejects malformed output %j',
    (input) => expect(parseSemVer(input)).toBeUndefined(),
  );
});

describe('isSupportedVersion', () => {
  it('enforces the 0.10.8 compatibility floor without a maximum', () => {
    expect(isSupportedVersion({ major: 0, minor: 10, patch: 7 })).toBe(false);
    expect(isSupportedVersion({ major: 0, minor: 10, patch: 8 })).toBe(true);
    expect(isSupportedVersion({ major: 7, minor: 0, patch: 0 })).toBe(true);
  });
});
