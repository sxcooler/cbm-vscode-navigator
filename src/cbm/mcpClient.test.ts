import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  transportOptions: vi.fn(),
  callTool: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = sdk.connect;
    callTool = sdk.callTool;
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  getDefaultEnvironment: () => ({ PATH: 'safe-path' }),
  StdioClientTransport: class {
    constructor(options: unknown) {
      sdk.transportOptions(options);
    }

    close = vi.fn(async () => undefined);
  },
}));

import { StdioMcpClientFactory } from './mcpClient.js';

describe('StdioMcpClientFactory', () => {
  afterEach(() => {
    vi.useRealTimers();
    sdk.callTool.mockReset();
  });

  it('allows indexing to finish beyond the SDK default one-minute timeout', async () => {
    vi.useFakeTimers();
    sdk.callTool.mockImplementation((_request, _schema, options) => new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Request timed out')), options?.timeout ?? 60_000);
      setTimeout(() => {
        clearTimeout(deadline);
        resolve({ isError: false });
      }, 90_000);
    }));
    const client = await new StdioMcpClientFactory().create('cbm', {}, 'C:/repo');
    const finished = client.callTool('index_repository', { repo_path: 'C:/repo' })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(await finished).toEqual({ isError: false });
  });

  it('preserves cancellation and the default timeout for navigation requests', async () => {
    const signal = new AbortController().signal;
    const client = await new StdioMcpClientFactory().create('cbm', {}, 'C:/repo');
    await client.callTool('query_graph', { query: 'RETURN 1' }, signal);
    expect(sdk.callTool).toHaveBeenCalledWith(
      { name: 'query_graph', arguments: { query: 'RETURN 1' } }, undefined, { signal },
    );
    await client.callTool('index_repository', { repo_path: 'C:/repo' }, signal);
    expect(sdk.callTool).toHaveBeenLastCalledWith(
      { name: 'index_repository', arguments: { repo_path: 'C:/repo' } }, undefined,
      expect.objectContaining({ signal, timeout: expect.any(Number) }),
    );
  });

  it('authorizes the workspace root with an argument-safe executable call', async () => {
    const runExecutable = vi.fn(async () => undefined);
    const factory = new StdioMcpClientFactory(runExecutable);

    await factory.authorizeRoot(
      'C:/bin/codebase-memory-mcp.exe',
      'C:\\repo\\module',
    );

    expect(runExecutable).toHaveBeenCalledWith(
      'C:/bin/codebase-memory-mcp.exe',
      ['allow-root', 'C:/repo/module'],
    );
  });

  it('starts CBM in the workspace root instead of inheriting the extension host cwd', async () => {
    const factory = new StdioMcpClientFactory();

    await factory.create(
      'C:/bin/codebase-memory-mcp.exe',
      { CBM_ALLOWED_ROOT: 'C:/repo' },
      'C:\\repo',
    );

    expect(sdk.transportOptions).toHaveBeenCalledWith({
      command: 'C:/bin/codebase-memory-mcp.exe',
      args: [],
      env: {
        PATH: 'safe-path',
        CBM_ALLOWED_ROOT: 'C:/repo',
      },
      cwd: 'C:\\repo',
      stderr: 'pipe',
    });
  });
});
