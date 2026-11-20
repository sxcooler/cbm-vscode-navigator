import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';
import { promisify } from 'node:util';
import type { InstallerDependencies } from './installer.js';
import {
  isAllowedReleaseUrl,
  OFFICIAL_RELEASE_API,
  type ReleaseAsset,
  type StableRelease,
} from './release.js';

const execFileAsync = promisify(execFile);

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function resolveStagedCandidate(
  stageRoot: string,
  paths: readonly string[],
  platform: NodeJS.Platform,
): string {
  const path = platform === 'win32' ? nodePath.win32 : nodePath.posix;
  const expected = platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp';
  const candidate = paths.find((entry) => path.basename(entry) === expected);
  if (!candidate) throw new Error(`Staged archive is missing ${expected}`);
  const relative = path.relative(path.resolve(stageRoot), path.resolve(candidate));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Staged executable escapes its private staging root');
  }
  return candidate;
}

export async function downloadReleaseAsset(
  asset: ReleaseAsset,
  fetchImpl: FetchLike = fetch,
): Promise<{ bytes: Uint8Array; finalUrl: string }> {
  let current = asset.browser_download_url;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    if (!isAllowedReleaseUrl(current)) throw new Error('Release URL has an untrusted origin');
    const response = await fetchImpl(current, {
      redirect: 'manual',
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'cbm-vscode-navigator' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Release redirect omitted its destination');
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error(`Release download failed with HTTP ${response.status}`);
    if (!isAllowedReleaseUrl(response.url || current)) throw new Error('Release final URL has an untrusted origin');
    return { bytes: new Uint8Array(await response.arrayBuffer()), finalUrl: response.url || current };
  }
  throw new Error('Release download exceeded the redirect limit');
}

async function walk(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = nodePath.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

export interface NodeInstallerOptions {
  readonly confirm: (summary: string) => Promise<boolean>;
  readonly verifyInstalled: () => Promise<boolean>;
  readonly log?: (message: string) => void;
  readonly fetchImpl?: FetchLike;
}

export function createNodeInstallerDependencies(options: NodeInstallerOptions): InstallerDependencies {
  const stagingRoots: string[] = [];
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    platform: process.platform,
    architecture: process.arch,
    fetchRelease: async () => {
      const response = await fetchImpl(OFFICIAL_RELEASE_API, {
        redirect: 'error',
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'cbm-vscode-navigator' },
      });
      if (!response.ok || !isAllowedReleaseUrl(response.url || OFFICIAL_RELEASE_API)) {
        throw new Error(`Official CBM release metadata request failed with HTTP ${response.status}`);
      }
      const release = await response.json() as StableRelease;
      if (!release || typeof release.tag_name !== 'string' || !Array.isArray(release.assets)) {
        throw new Error('Official CBM release metadata is malformed');
      }
      return release;
    },
    download: (asset) => downloadReleaseAsset(asset, fetchImpl),
    stageArchive: async (asset, bytes) => {
      const stageRoot = await mkdtemp(nodePath.join(tmpdir(), 'cbm-navigator-'));
      stagingRoots.push(stageRoot);
      await chmod(stageRoot, 0o700);
      const archivePath = nodePath.join(stageRoot, asset.name);
      const extractRoot = nodePath.join(stageRoot, 'extracted');
      await mkdir(extractRoot, { mode: 0o700 });
      await writeFile(archivePath, bytes, { mode: 0o600, flag: 'wx' });
      await execFileAsync('tar', ['-xf', archivePath, '-C', extractRoot], {
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      });
      const candidate = resolveStagedCandidate(extractRoot, await walk(extractRoot), process.platform);
      const canonicalRoot = await realpath(extractRoot);
      const canonicalCandidate = await realpath(candidate);
      resolveStagedCandidate(canonicalRoot, [canonicalCandidate], process.platform);
      await chmod(canonicalCandidate, 0o700).catch(() => undefined);
      return canonicalCandidate;
    },
    run: async (executablePath, args) => {
      await access(executablePath, constants.X_OK);
      const result = await execFileAsync(executablePath, [...args], {
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      });
      options.log?.(result.stdout);
      return { stdout: result.stdout };
    },
    confirm: options.confirm,
    verifyInstalled: options.verifyInstalled,
    cleanup: async () => {
      await Promise.all(stagingRoots.splice(0).map((root) =>
        rm(root, { recursive: true, force: true, maxRetries: 3 })));
    },
  };
}
