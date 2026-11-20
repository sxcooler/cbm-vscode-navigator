import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CbmInstaller } from './installer.js';

describe('CbmInstaller', () => {
  it('verifies checksum and dry-run before final confirmation and activation', async () => {
    const archive = Buffer.from('verified archive');
    const digest = createHash('sha256').update(archive).digest('hex');
    const events: string[] = [];
    const run = vi.fn(async (_path: string, args: readonly string[]) => {
      events.push(args.join(' '));
      return { stdout: args.includes('--dry-run') ? 'install: /safe/bin/cbm' : 'installed' };
    });
    const installer = new CbmInstaller({
      fetchRelease: async () => ({
        tag_name: 'v0.10.8', draft: false, prerelease: false,
        assets: [
          { name: 'checksums.txt', browser_download_url: 'https://github.com/checksums.txt' },
          { name: 'codebase-memory-mcp-windows-amd64.zip', browser_download_url: 'https://github.com/cbm.zip' },
        ],
      }),
      download: async (asset) => asset.name === 'checksums.txt'
        ? { bytes: Buffer.from(`${digest}  codebase-memory-mcp-windows-amd64.zip\n`), finalUrl: asset.browser_download_url }
        : { bytes: archive, finalUrl: asset.browser_download_url },
      stageArchive: async () => 'C:/private/codebase-memory-mcp.exe',
      run,
      confirm: async (summary) => { events.push(`confirm:${summary}`); return true; },
      verifyInstalled: async () => { events.push('verify'); return true; },
      platform: 'win32', architecture: 'x64',
    });
    await expect(installer.install()).resolves.toEqual({ kind: 'installed', version: 'v0.10.8' });
    expect(events).toEqual([
      'install --dry-run',
      'confirm:install: /safe/bin/cbm',
      'install',
      'verify',
    ]);
  });

  it('stops before extraction when the checksum is wrong', async () => {
    const stageArchive = vi.fn(async () => 'candidate');
    const installer = new CbmInstaller({
      fetchRelease: async () => ({
        tag_name: 'v0.10.8', draft: false, prerelease: false,
        assets: [
          { name: 'checksums.txt', browser_download_url: 'https://github.com/checksums.txt' },
          { name: 'codebase-memory-mcp-windows-amd64.zip', browser_download_url: 'https://github.com/cbm.zip' },
        ],
      }),
      download: async (asset) => ({
        bytes: Buffer.from(asset.name === 'checksums.txt'
          ? `${'0'.repeat(64)}  codebase-memory-mcp-windows-amd64.zip\n`
          : 'corrupt'),
        finalUrl: asset.browser_download_url,
      }),
      stageArchive,
      run: async () => ({ stdout: '' }), confirm: async () => true,
      verifyInstalled: async () => true, platform: 'win32', architecture: 'x64',
    });
    await expect(installer.install()).rejects.toThrow('checksum');
    expect(stageArchive).not.toHaveBeenCalled();
  });

  it('leaves installation unchanged when final confirmation is cancelled', async () => {
    const bytes = Buffer.from('archive');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const run = vi.fn(async () => ({ stdout: 'changes' }));
    const installer = new CbmInstaller({
      fetchRelease: async () => ({
        tag_name: 'v0.10.8', draft: false, prerelease: false,
        assets: [
          { name: 'checksums.txt', browser_download_url: 'https://github.com/checksums.txt' },
          { name: 'codebase-memory-mcp-windows-amd64.zip', browser_download_url: 'https://github.com/cbm.zip' },
        ],
      }),
      download: async (asset) => ({
        bytes: asset.name === 'checksums.txt'
          ? Buffer.from(`${digest}  codebase-memory-mcp-windows-amd64.zip\n`)
          : bytes,
        finalUrl: asset.browser_download_url,
      }),
      stageArchive: async () => 'candidate', run, confirm: async () => false,
      verifyInstalled: async () => true, platform: 'win32', architecture: 'x64',
    });
    await expect(installer.install()).resolves.toEqual({ kind: 'cancelled' });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
