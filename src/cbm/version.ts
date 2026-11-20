export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export const MINIMUM_CBM_VERSION: SemVer = { major: 0, minor: 10, patch: 8 };

const SEMVER = /^(?:codebase-memory(?:-mcp)?\s+)?v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseSemVer(text: string): SemVer | undefined {
  const match = SEMVER.exec(text.trim());
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function compareSemVer(left: SemVer, right: SemVer): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

export function isSupportedVersion(version: SemVer): boolean {
  return compareSemVer(version, MINIMUM_CBM_VERSION) >= 0;
}
