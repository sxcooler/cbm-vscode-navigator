import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { discoverRuntime, readAutoIndex } from './runtimeDiscovery.js';

describe('discoverRuntime', () => {
  it('probes configured path before PATH and official defaults', async () => {
    const run = vi.fn(async (path: string) => ({
      stdout: path === 'C:/configured/cbm.exe' ? '0.10.8' : '9.9.9',
    }));

    const result = await discoverRuntime({
      configuredPath: 'C:/configured/cbm.exe',
      pathValue: 'C:/path-bin',
      defaultPaths: ['C:/official/cbm.exe'],
      executableName: 'cbm.exe',
      pathDelimiter: ';',
      exists: async () => true,
      run,
    });

    expect(result).toMatchObject({
      kind: 'found',
      executablePath: 'C:/configured/cbm.exe',
      version: { major: 0, minor: 10, patch: 8 },
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('C:/configured/cbm.exe', ['--version'], 1500);
  });

  it('skips absent and malformed candidates in documented order', async () => {
    const run = vi.fn(async (path: string) => ({
      stdout: path.includes('path-bin') ? 'not-a-version' : '0.10.9',
    }));

    const result = await discoverRuntime({
      configuredPath: 'C:/missing/cbm.exe',
      pathValue: 'C:/path-bin',
      defaultPaths: ['C:/official/cbm.exe'],
      executableName: 'cbm.exe',
      pathDelimiter: ';',
      exists: async (path) => !path.includes('missing'),
      run,
    });

    expect(result).toMatchObject({ kind: 'found', executablePath: 'C:/official/cbm.exe' });
    expect(run.mock.calls.map((call) => call[0])).toEqual([
      'C:/path-bin/cbm.exe',
      'C:/official/cbm.exe',
    ]);
  });

  it('returns missing when no candidate can be probed', async () => {
    const result = await discoverRuntime({
      pathValue: '',
      defaultPaths: [],
      executableName: 'cbm',
      pathDelimiter: ':',
      exists: async () => false,
      run: async () => ({ stdout: '0.10.8' }),
    });
    expect(result).toEqual({ kind: 'missing', failures: [] });
  });
});

describe('readAutoIndex', () => {
  it.each([
    ['true\r\n', true],
    [' false\n', false],
  ])('reads the local configuration value %j', async (stdout, expected) => {
    const run = vi.fn(async () => ({ stdout }));

    await expect(readAutoIndex('C:/bin/cbm.exe', run)).resolves.toBe(expected);
    expect(run).toHaveBeenCalledWith('C:/bin/cbm.exe', ['config', 'get', 'auto_index'], 30_000);
  });

  it('reads false when the config process needs six seconds to start', async () => {
    const result = readAutoIndex(process.execPath, (path, _args, timeout) =>
      promisify(execFile)(path, ['-e', 'setTimeout(() => console.log(false), 6000)'], {
        timeout, windowsHide: true,
      }));

    await expect(result).resolves.toBe(false);
  }, 15_000);

  it('identifies a config process killed by the read timeout', async () => {
    const error = Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM', code: null });
    await expect(readAutoIndex('cbm', async () => { throw error; }))
      .rejects.toThrow(/timed out after 30000 ms/);
  });

  it.each(['', 'unknown', '{"auto_index":false}'])('rejects ambiguous output %j', async (stdout) => {
    await expect(readAutoIndex('cbm', async () => ({ stdout })))
      .rejects.toThrow('auto_index');
  });

  it('preserves a configuration read failure instead of treating it as false', async () => {
    await expect(readAutoIndex('cbm', async () => { throw new Error('timed out'); }))
      .rejects.toThrow('timed out');
  });
});
