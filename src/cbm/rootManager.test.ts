import { describe, expect, it, vi } from 'vitest';
import type { McpClient, McpClientFactory } from './mcpClient.js';
import { RootManager, StaleCursorError } from './rootManager.js';

function fakeFactory(callTool = vi.fn(async () => ({}))) {
  const authorizeRoot = vi.fn(async () => undefined);
  const client: McpClient = {
    listTools: vi.fn(async () => []),
    callTool,
    close: vi.fn(async () => undefined),
  };
  const factory: McpClientFactory = {
    authorizeRoot,
    create: vi.fn(async () => client),
  };
  return { authorizeRoot, client, factory, callTool };
}

describe('RootManager', () => {
  it('creates one long-lived client per canonical authorized root', async () => {
    const { authorizeRoot, factory } = fakeFactory();
    const manager = new RootManager('C:/bin/cbm.exe', factory);
    await manager.callTool('C:/repo', 'list_projects', {});
    await manager.callTool('C:/repo', 'index_status', {});
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(factory.create).toHaveBeenCalledWith('C:/bin/cbm.exe', {
      CBM_ALLOWED_ROOT: 'C:/repo',
    }, 'C:/repo');
    expect(authorizeRoot).not.toHaveBeenCalled();
  });

  it('normalizes a Windows authorized root for the CBM process boundary', async () => {
    const { factory } = fakeFactory();
    const manager = new RootManager('C:/bin/cbm.exe', factory);
    await manager.callTool('C:\\repo\\module', 'list_projects', {});
    expect(factory.create).toHaveBeenCalledWith('C:/bin/cbm.exe', {
      CBM_ALLOWED_ROOT: 'C:/repo/module',
    }, 'C:\\repo\\module');
  });

  it('never indexes without explicit confirmation and defaults to fast', async () => {
    const { authorizeRoot, callTool, factory } = fakeFactory();
    const manager = new RootManager('cbm', factory);
    await expect(manager.indexRoot('C:/repo', false)).resolves.toBe(false);
    expect(callTool).not.toHaveBeenCalled();
    await expect(manager.indexRoot('C:/repo', true)).resolves.toBe(true);
    expect(authorizeRoot).toHaveBeenCalledWith('cbm', 'C:/repo');
    expect(authorizeRoot.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(factory.create).mock.invocationCallOrder[0] ?? 0);
    expect(callTool).toHaveBeenCalledWith('index_repository', {
      repo_path: 'C:/repo',
      mode: 'fast',
    }, undefined);
  });

  it('does not create an MCP client or index when root authorization fails', async () => {
    const { authorizeRoot, callTool, factory } = fakeFactory();
    authorizeRoot.mockRejectedValueOnce(new Error('authorization failed'));
    const manager = new RootManager('cbm', factory);

    await expect(manager.indexRoot('C:/repo', true)).rejects.toThrow('authorization failed');

    expect(factory.create).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
  });

  it('rejects an MCP index error instead of reporting successful indexing', async () => {
    const { factory } = fakeFactory(vi.fn(async () => ({
      content: [{
        type: 'text',
        text: 'C:/repo is outside the allowed root.',
      }],
      structuredContent: {
        error: 'C:/repo is outside the allowed root.',
      },
      isError: true,
    })));
    const manager = new RootManager('cbm', factory);

    await expect(manager.indexRoot('C:/repo', true))
      .rejects.toThrow('C:/repo is outside the allowed root.');
  });

  it('restarts the original cursor query once', async () => {
    const callTool = vi.fn()
      .mockRejectedValueOnce(new StaleCursorError())
      .mockResolvedValueOnce({ rows: ['fresh'] });
    const { factory } = fakeFactory(callTool);
    const manager = new RootManager('cbm', factory);
    await expect(manager.callWithCursorRestart('C:/repo', 'trace_path', {
      function_name: 'run',
      cursor: 'old',
    })).resolves.toEqual({ rows: ['fresh'] });
    expect(callTool.mock.calls[1]?.[1]).toEqual({ function_name: 'run' });
  });
});
