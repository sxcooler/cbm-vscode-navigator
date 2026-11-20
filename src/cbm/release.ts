import { createHash, timingSafeEqual } from 'node:crypto';

export const OFFICIAL_RELEASE_API =
  'https://api.github.com/repos/DeusData/codebase-memory-mcp/releases/latest';

export interface ReleaseAsset {
  readonly name: string;
  readonly browser_download_url: string;
}

export interface StableRelease {
  readonly tag_name: string;
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly assets: readonly ReleaseAsset[];
}

export interface SelectedReleaseAssets {
  readonly version: string;
  readonly archive: ReleaseAsset;
  readonly checksums: ReleaseAsset;
}

const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  win32: 'windows',
  darwin: 'darwin',
  linux: 'linux',
};

const ARCH_NAMES: Readonly<Record<string, string>> = {
  x64: 'amd64',
  arm64: 'arm64',
};

export function selectReleaseAssets(
  release: StableRelease,
  platform: NodeJS.Platform,
  architecture: string,
): SelectedReleaseAssets {
  if (release.draft || release.prerelease) throw new Error('Only stable CBM releases can be installed');
  const os = PLATFORM_NAMES[platform];
  const arch = ARCH_NAMES[architecture];
  if (!os || !arch) throw new Error(`Unsupported platform tuple: ${platform}/${architecture}`);
  const suffix = platform === 'win32' ? '.zip' : '.tar.gz';
  const expectedName = `codebase-memory-mcp-${os}-${arch}${suffix}`;
  const archive = release.assets.find((asset) => asset.name === expectedName);
  const checksums = release.assets.find((asset) => asset.name === 'checksums.txt');
  if (!archive || !checksums) throw new Error(`Release is missing ${expectedName} or checksums.txt`);
  return { version: release.tag_name, archive, checksums };
}

export function parseChecksumManifest(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+\*?([^\s]+)$/.exec(line.trim());
    if (match?.[1] && match[2]) result.set(match[2], match[1].toLowerCase());
  }
  return result;
}

export function verifyBytes(bytes: Uint8Array, expectedHex: string): boolean {
  if (!/^[a-fA-F0-9]{64}$/.test(expectedHex)) return false;
  const actual = createHash('sha256').update(bytes).digest();
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const ALLOWED_RELEASE_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'raw.githubusercontent.com',
]);

export function isAllowedReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_RELEASE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
