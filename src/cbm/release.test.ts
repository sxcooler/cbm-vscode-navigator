import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  isAllowedReleaseUrl,
  parseChecksumManifest,
  selectReleaseAssets,
  verifyBytes,
} from './release.js';

const release = {
  tag_name: 'v0.10.8',
  prerelease: false,
  draft: false,
  assets: [
    { name: 'checksums.txt', browser_download_url: 'https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.10.8/checksums.txt' },
    { name: 'codebase-memory-mcp-windows-amd64.zip', browser_download_url: 'https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.10.8/codebase-memory-mcp-windows-amd64.zip' },
    { name: 'codebase-memory-mcp-linux-arm64.tar.gz', browser_download_url: 'https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.10.8/codebase-memory-mcp-linux-arm64.tar.gz' },
  ],
};

describe('release selection and verification', () => {
  it('selects the exact archive and checksum manifest for the platform tuple', () => {
    expect(selectReleaseAssets(release, 'win32', 'x64')).toMatchObject({
      archive: { name: 'codebase-memory-mcp-windows-amd64.zip' },
      checksums: { name: 'checksums.txt' },
    });
    expect(selectReleaseAssets(release, 'linux', 'arm64')).toMatchObject({
      archive: { name: 'codebase-memory-mcp-linux-arm64.tar.gz' },
    });
  });

  it('parses a checksum by exact filename and rejects mismatched bytes', () => {
    const bytes = Buffer.from('archive');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const manifest = `${digest}  codebase-memory-mcp-windows-amd64.zip\n`;
    expect(parseChecksumManifest(manifest).get('codebase-memory-mcp-windows-amd64.zip')).toBe(digest);
    expect(verifyBytes(bytes, digest)).toBe(true);
    expect(verifyBytes(Buffer.from('corrupt'), digest)).toBe(false);
  });

  it('allows only HTTPS origins used by official GitHub release delivery', () => {
    expect(isAllowedReleaseUrl('https://github.com/DeusData/codebase-memory-mcp/releases')).toBe(true);
    expect(isAllowedReleaseUrl('https://release-assets.githubusercontent.com/object')).toBe(true);
    expect(isAllowedReleaseUrl('http://github.com/file')).toBe(false);
    expect(isAllowedReleaseUrl('https://github.com.evil.example/file')).toBe(false);
  });
});
