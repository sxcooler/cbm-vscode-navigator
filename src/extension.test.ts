import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUIRED_TOOLS } from './cbm/capabilities.js';

const host = vi.hoisted(() => {
  const uri = { fsPath: 'C:/cbm-test-root', toString: () => 'file:///C:/cbm-test-root' };
  return {
    folder: { uri },
    commands: new Map<string, (...args: unknown[]) => unknown>(),
    status: { text: '', tooltip: '', show() {}, dispose() {} },
    project: { name: 'test-root', root_path: uri.fsPath },
    indexed: false,
    autoIndex: false,
    trusted: true,
    grantTrust: () => {},
    readAutoIndex: vi.fn(async () => false),
    connect: vi.fn(async () => undefined),
    warning: vi.fn(async (_message: string, _options: unknown, action: string) => action as string | undefined),
  };
});

vi.mock('vscode', () => ({
  StatusBarAlignment: { Left: 1 },
  window: {
    createOutputChannel: () => ({ info() {}, error() {}, dispose() {} }),
    createStatusBarItem: () => host.status,
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    showWarningMessage: host.warning,
  },
  workspace: {
    workspaceFolders: [host.folder],
    get isTrusted() { return host.trusted; },
    getConfiguration: () => ({ get: () => undefined }),
    getWorkspaceFolder: () => host.folder,
    onDidCloseTextDocument: () => ({ dispose() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidGrantWorkspaceTrust: (listener: () => void) => {
      host.grantTrust = listener;
      return { dispose() {} };
    },
  },
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      host.commands.set(id, handler);
      return { dispose() {} };
    },
  },
}));

vi.mock('./cbm/runtimeDiscovery.js', () => ({
  discoverRuntime: async () => ({
    kind: 'found', executablePath: 'cbm', version: { major: 0, minor: 11, patch: 0 }, failures: [],
  }),
  readAutoIndex: host.readAutoIndex,
}));
vi.mock('./cbm/mcpClient.js', () => ({
  StdioMcpClientFactory: class {
    async authorizeRoot() {}
    async create() {
      await host.connect();
      return {
        listTools: async () => REQUIRED_TOOLS,
        close: async () => undefined,
        callTool: async (name: string, args: Record<string, unknown>) => {
          if (name === 'index_repository') {
            host.indexed = true;
            return { isError: false };
          }
          // CBM 0.11.0 defaults to tree text without structuredContent.
          return {
            content: [{ type: 'text', text: args.format === 'json'
              ? JSON.stringify({ projects: host.indexed ? [host.project] : [], has_more: false })
              : `projects: 1  (cols: name root_path)\n  ${host.project.name} ${host.project.root_path}\n` }],
          };
        },
      };
    }
  },
}));
vi.mock('./languages/java/workerParser.js', () => ({
  WorkerJavaParser: { create: () => ({ dispose: async () => undefined }) },
}));
vi.mock('./providers.js', () => ({
  registerNavigationProviders: () => ({ refreshCodeLenses() {} }),
}));

import { activate } from './extension.js';
import type * as vscode from 'vscode';

describe('workspace index discovery', () => {
  const subscriptions: vscode.Disposable[] = [];
  beforeEach(() => {
    for (const subscription of subscriptions.splice(0)) subscription.dispose();
    host.commands.clear();
    host.indexed = false;
    host.autoIndex = false;
    host.trusted = true;
    host.status.text = '';
    host.status.tooltip = '';
    host.readAutoIndex.mockReset().mockImplementation(async () => host.autoIndex);
    host.connect.mockReset().mockResolvedValue(undefined);
    host.warning.mockReset().mockImplementation(async (_message, _options, action) => action);
  });

  function load() {
    activate({ subscriptions, asAbsolutePath: (path: string) => path } as vscode.ExtensionContext);
  }

  async function start() {
    load();
    await vi.waitFor(() => expect(host.status.text).toMatch(/CBM: (Ready|Index)$/));
  }

  async function waitForManualConnection() {
    await vi.waitFor(() => expect(host.status.text).toBe('$(debug-disconnect) CBM: Connect'));
  }

  it('recognizes an existing CBM 0.11.0 index on startup', async () => {
    host.indexed = true;
    await start();
    expect(host.status.text).toContain('Ready');
  });

  it('recognizes the root after indexing instead of reporting discovery failure', async () => {
    await start();
    await host.commands.get('cbmNavigator.indexWorkspace')!();
    expect(host.status.text).toContain('Ready');
    expect(host.status.tooltip).toBe(host.folder.uri.fsPath);
  });

  it('does not create an MCP session on startup when auto_index is enabled', async () => {
    host.autoIndex = true;
    load();
    await waitForManualConnection();

    expect(host.readAutoIndex).toHaveBeenCalledWith('cbm', expect.any(Function));
    expect(host.connect).not.toHaveBeenCalled();
    expect(host.status).toMatchObject({ command: 'cbmNavigator.retryConnection' });
    expect(host.status.tooltip).toContain('auto_index');
  });

  it('keeps automatic connection when auto_index is disabled', async () => {
    host.indexed = true;
    await start();

    expect(host.readAutoIndex).toHaveBeenCalledTimes(1);
    expect(host.connect).toHaveBeenCalledTimes(1);
    expect(host.warning).not.toHaveBeenCalled();
  });

  it('keeps the session disconnected if configuration cannot be read', async () => {
    host.readAutoIndex.mockRejectedValue(new Error('timed out'));
    load();
    await waitForManualConnection();

    expect(host.connect).not.toHaveBeenCalled();
    expect(host.status.tooltip).toContain('could not be read');
  });

  it('allows an explicitly confirmed manual connection and preserves the index action', async () => {
    host.autoIndex = true;
    load();
    await waitForManualConnection();
    await host.commands.get('cbmNavigator.retryConnection')!();

    expect(host.warning).toHaveBeenCalledWith(expect.stringContaining('automatically index'), { modal: true }, 'Connect');
    expect(host.readAutoIndex).toHaveBeenCalledTimes(2);
    expect(host.connect).toHaveBeenCalledTimes(1);
    expect(host.status.text).toBe('$(database) CBM: Index');
    expect(host.status).toMatchObject({ command: 'cbmNavigator.indexWorkspace' });
  });

  it('keeps the session disconnected when manual connection is cancelled', async () => {
    host.autoIndex = true;
    host.warning.mockResolvedValue(undefined);
    load();
    await waitForManualConnection();
    await host.commands.get('cbmNavigator.retryConnection')!();

    expect(host.connect).not.toHaveBeenCalled();
    expect(host.status.text).toBe('$(debug-disconnect) CBM: Connect');
  });

  it('allows a warned manual connection when configuration is unavailable', async () => {
    host.readAutoIndex.mockRejectedValue(new Error('unsupported config command'));
    load();
    await waitForManualConnection();
    await host.commands.get('cbmNavigator.retryConnection')!();

    expect(host.warning).toHaveBeenCalledWith(expect.stringContaining('could not be read'), { modal: true }, 'Connect');
    expect(host.connect).toHaveBeenCalledTimes(1);
  });

  it('shows connection progress and retains a connection failure', async () => {
    host.autoIndex = true;
    let failConnection!: (reason: Error) => void;
    host.connect.mockImplementation(() => new Promise((_resolve, reject) => { failConnection = reject; }));
    load();
    await waitForManualConnection();
    const connecting = host.commands.get('cbmNavigator.retryConnection')!();
    await vi.waitFor(() => expect(host.connect).toHaveBeenCalledTimes(1));
    expect(host.status.text).toBe('$(sync~spin) CBM: Connecting…');
    expect(host.status).toMatchObject({ command: 'cbmNavigator.showLogs' });

    failConnection(new Error('connection failed'));
    await connecting;
    expect(host.status.text).toBe('$(error) CBM: Error');
  });

  it('applies the startup guard after workspace trust is granted', async () => {
    host.trusted = false;
    host.autoIndex = true;
    load();
    await vi.waitFor(() => expect(host.status.text).toContain('Trust Required'));
    expect(host.readAutoIndex).not.toHaveBeenCalled();
    expect(host.connect).not.toHaveBeenCalled();

    host.trusted = true;
    host.grantTrust();
    await waitForManualConnection();
    expect(host.readAutoIndex).toHaveBeenCalledTimes(1);
    expect(host.connect).not.toHaveBeenCalled();
  });

  it('does not connect after disposal while a configuration read is pending', async () => {
    let finishRead!: (value: boolean) => void;
    host.readAutoIndex.mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
    load();
    await vi.waitFor(() => expect(host.readAutoIndex).toHaveBeenCalledTimes(1));
    const stopped = host.commands.get('cbmNavigator.retryConnection')!();
    for (const subscription of subscriptions.splice(0)) subscription.dispose();
    finishRead(false);
    await stopped;

    expect(host.connect).not.toHaveBeenCalled();
  });
});
