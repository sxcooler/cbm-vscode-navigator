import { describe, expect, it, vi } from 'vitest';
import type { ReleaseAsset } from './release.js';
import { downloadReleaseAsset, resolveStagedCandidate } from './installerNode.js';

describe('resolveStagedCandidate', () => {
  it('selects only the exact executable inside its private staging root', () => {
    expect(resolveStagedCandidate('C:/stage', [
      'C:/stage/readme.txt',
      'C:/stage/bin/codebase-memory-mcp.exe',
    ], 'win32')).toBe('C:/stage/bin/codebase-memory-mcp.exe');
    expect(() => resolveStagedCandidate('C:/stage', [
      'C:/outside/codebase-memory-mcp.exe',
    ], 'win32')).toThrow('staging root');
  });
});

describe('downloadReleaseAsset', () => {
  it('validates every redirect and the final origin', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://release-assets.githubusercontent.com/object' },
      }))
      .mockResolvedValueOnce(new Response('archive', { status: 200 }));
    const asset: ReleaseAsset = {
      name: 'archive.zip',
      browser_download_url: 'https://github.com/DeusData/release/archive.zip',
    };
    await expect(downloadReleaseAsset(asset, fetchImpl)).resolves.toMatchObject({
      bytes: new Uint8Array(Buffer.from('archive')),
      finalUrl: 'https://release-assets.githubusercontent.com/object',
    });
  });

  it('rejects a redirect before contacting an untrusted host', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {
      status: 302, headers: { location: 'https://evil.example/archive' },
    }));
    await expect(downloadReleaseAsset({
      name: 'archive.zip', browser_download_url: 'https://github.com/archive.zip',
    }, fetchImpl)).rejects.toThrow('origin');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
