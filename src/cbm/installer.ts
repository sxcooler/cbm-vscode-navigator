import {
  isAllowedReleaseUrl,
  parseChecksumManifest,
  selectReleaseAssets,
  verifyBytes,
  type ReleaseAsset,
  type StableRelease,
} from './release.js';

export interface DownloadedAsset {
  readonly bytes: Uint8Array;
  readonly finalUrl: string;
}

export interface InstallerDependencies {
  readonly fetchRelease: () => Promise<StableRelease>;
  readonly download: (asset: ReleaseAsset) => Promise<DownloadedAsset>;
  readonly stageArchive: (asset: ReleaseAsset, bytes: Uint8Array) => Promise<string>;
  readonly run: (
    executablePath: string,
    args: readonly string[],
  ) => Promise<{ readonly stdout: string }>;
  readonly confirm: (dryRunSummary: string) => Promise<boolean>;
  readonly verifyInstalled: () => Promise<boolean>;
  readonly cleanup?: () => Promise<void>;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
}

export type InstallResult =
  | { readonly kind: 'installed'; readonly version: string }
  | { readonly kind: 'cancelled' };

export class CbmInstaller {
  constructor(readonly dependencies: InstallerDependencies) {}

  async install(): Promise<InstallResult> {
    try {
      const selected = selectReleaseAssets(
        await this.dependencies.fetchRelease(),
        this.dependencies.platform,
        this.dependencies.architecture,
      );
      const [archive, manifest] = await Promise.all([
        this.dependencies.download(selected.archive),
        this.dependencies.download(selected.checksums),
      ]);
      if (!isAllowedReleaseUrl(archive.finalUrl) || !isAllowedReleaseUrl(manifest.finalUrl)) {
        throw new Error('Release download redirected to an untrusted origin');
      }
      const checksums = parseChecksumManifest(Buffer.from(manifest.bytes).toString('utf8'));
      const expected = checksums.get(selected.archive.name);
      if (!expected || !verifyBytes(archive.bytes, expected)) {
        throw new Error(`CBM archive checksum verification failed for ${selected.archive.name}`);
      }
      const candidate = await this.dependencies.stageArchive(selected.archive, archive.bytes);
      const dryRun = await this.dependencies.run(candidate, ['install', '--dry-run']);
      if (!(await this.dependencies.confirm(dryRun.stdout))) return { kind: 'cancelled' };
      await this.dependencies.run(candidate, ['install']);
      if (!(await this.dependencies.verifyInstalled())) {
        throw new Error('Installed CBM runtime failed post-install verification');
      }
      return { kind: 'installed', version: selected.version };
    } finally {
      await this.dependencies.cleanup?.();
    }
  }
}
