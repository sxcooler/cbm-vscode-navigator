import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as vscode from 'vscode';
import { validateCapabilities } from './cbm/capabilities.js';
import { McpGraphNavigator } from './cbm/graphAdapter.js';
import { CbmInstaller } from './cbm/installer.js';
import { createNodeInstallerDependencies } from './cbm/installerNode.js';
import { StdioMcpClientFactory } from './cbm/mcpClient.js';
import { RootManager } from './cbm/rootManager.js';
import { rootIdentity } from './cbm/rootIdentity.js';
import { discoverRuntime, readAutoIndex } from './cbm/runtimeDiscovery.js';
import { isSupportedVersion } from './cbm/version.js';
import { COMMANDS, setKeymap } from './commands.js';
import type { RootState, RootStateKind } from './contracts.js';
import { JavaSyntaxAdapter } from './languages/java/adapter.js';
import { WorkerJavaParser } from './languages/java/workerParser.js';
import { LanguageAdapterRegistry } from './languages/registry.js';
import { NavigationEngine } from './navigation/engine.js';
import { resolveCandidate } from './navigation/locationResolver.js';
import { registerNavigationProviders } from './providers.js';
import { statusPresentation } from './status.js';
import { redactLog } from './logging.js';

const execFileAsync = promisify(execFile);

function officialDefaultPaths(): string[] {
  const home = homedir();
  if (process.platform === 'win32') {
    return [
      join(process.env.LOCALAPPDATA ?? home, 'codebase-memory', 'bin', 'codebase-memory-mcp.exe'),
      join(home, '.local', 'bin', 'codebase-memory-mcp.exe'),
    ];
  }
  const name = 'codebase-memory-mcp';
  return process.platform === 'darwin'
    ? [join(home, '.local', 'bin', name), `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]
    : [join(home, '.local', 'bin', name), `/usr/local/bin/${name}`, `/usr/bin/${name}`];
}

async function runRuntime(path: string, args: readonly string[], timeoutMs: number) {
  const result = await execFileAsync(path, [...args], {
    timeout: timeoutMs,
    env: getDefaultEnvironment(),
    windowsHide: true,
    maxBuffer: 64 * 1024,
  });
  return { stdout: result.stdout };
}

async function probeConfiguredRuntime() {
  const configuration = vscode.workspace.getConfiguration('cbmNavigator');
  return discoverRuntime({
    configuredPath: configuration.get<string>('executablePath') ?? '',
    pathValue: process.env.PATH ?? '',
    defaultPaths: officialDefaultPaths(),
    executableName: process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp',
    pathDelimiter: delimiter,
    exists: async (path) => access(path, constants.X_OK).then(() => true, () => false),
    run: runRuntime,
  });
}

function unwrap(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  if (value.structuredContent && typeof value.structuredContent === 'object') {
    return value.structuredContent as Record<string, unknown>;
  }
  if (Array.isArray(value.content)) {
    const block = value.content.find((item) => item && typeof item === 'object'
      && (item as Record<string, unknown>).type === 'text') as Record<string, unknown> | undefined;
    if (typeof block?.text === 'string') {
      try { return JSON.parse(block.text) as Record<string, unknown>; } catch { return value; }
    }
  }
  return value;
}

function projects(raw: unknown): Array<{ name: string; root?: string }> {
  const items = unwrap(raw)?.projects;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const name = typeof row.name === 'string'
      ? row.name
      : (typeof row.project === 'string' ? row.project : undefined);
    if (!name) return [];
    const root = typeof row.root_path === 'string'
      ? row.root_path
      : (typeof row.root === 'string' ? row.root : undefined);
    return [{ name, ...(root ? { root } : {}) }];
  });
}

class ExtensionController implements vscode.Disposable {
  readonly #states = new Map<string, RootState>();
  readonly #folderRoots = new Map<string, string>();
  readonly #projects = new Map<string, string>();
  readonly #runtimeDisposables: vscode.Disposable[] = [];
  readonly #output: vscode.LogOutputChannel;
  readonly #status: vscode.StatusBarItem;
  #manager: RootManager | undefined;
  #parser: WorkerJavaParser | undefined;
  #engine: NavigationEngine | undefined;
  #refreshCodeLenses: (() => void) | undefined;
  #starting: Promise<void> | undefined;
  #disposed = false;

  constructor(readonly context: vscode.ExtensionContext) {
    this.#output = vscode.window.createOutputChannel('CBM Navigator', { log: true });
    this.#status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 30);
    this.#status.show();
    context.subscriptions.push(this.#output, this.#status);
    this.#registerCommands();
    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((document) => {
        const uri = document.uri.toString();
        this.#parser?.disposeDocument(uri);
        this.#engine?.invalidateDocument(uri);
        this.#refreshCodeLenses?.();
      }),
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        this.#engine?.invalidateDocument(document.uri.toString());
        this.#refreshCodeLenses?.();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.#refreshStatusBar()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => void this.start()),
    );
  }

  start(manualConnection = false): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    this.#starting ??= this.#initialize(manualConnection).finally(() => { this.#starting = undefined; });
    return this.#starting;
  }

  async #initialize(manualConnection: boolean): Promise<void> {
    await this.#stopRuntime();
    if (this.#disposed) return;
    this.#states.clear();
    this.#folderRoots.clear();
    this.#projects.clear();
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
      const root = await realpath(folder.uri.fsPath).catch(() => folder.uri.fsPath);
      this.#folderRoots.set(folder.uri.toString(), root);
      this.#states.set(root, { root, kind: vscode.workspace.isTrusted ? 'Connecting' : 'Untrusted' });
    }
    if (this.#disposed) return;
    this.#refreshStatusBar();
    if (!vscode.workspace.isTrusted || folders.length === 0) return;

    const configuration = vscode.workspace.getConfiguration('cbmNavigator');
    const probe = await probeConfiguredRuntime();
    if (this.#disposed) return;
    if (probe.kind === 'missing') {
      this.#setAll('Missing');
      this.#output.info('No supported CBM executable was discovered.');
      return;
    }
    if (!isSupportedVersion(probe.version)) {
      this.#setAll('Unsupported', 'CBM 0.10.8 or newer is required.');
      return;
    }

    let autoIndex: boolean | undefined;
    try {
      autoIndex = await readAutoIndex(probe.executablePath, runRuntime);
    } catch (error) {
      if (this.#disposed) return;
      this.#output.error(redactLog(`CBM auto_index check failed: ${String(error)}`, [...this.#states.keys()]));
    }
    if (this.#disposed) return;
    if (autoIndex !== false) {
      const reason = autoIndex === true ? 'CBM auto_index is enabled.' : 'CBM auto_index could not be read.';
      this.#setAll('Disconnected', `${reason} Connect manually; CBM may automatically index workspace folders.`);
      if (!manualConnection) {
        this.#output.info(`${reason} Automatic connection was skipped; use Connect / Retry Connection.`);
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        `${reason} Connecting may automatically index workspace folders and use significant CPU and memory.`,
        { modal: true },
        'Connect',
      );
      if (choice !== 'Connect') return;
    }
    if (this.#disposed) return;
    this.#setAll('Connecting');
    const manager = new RootManager(probe.executablePath, new StdioMcpClientFactory());
    this.#manager = manager;
    for (const root of this.#states.keys()) {
      try {
        const capability = validateCapabilities(await manager.listTools(root));
        if (!capability.supported) {
          this.#states.set(root, {
            root, kind: 'Unsupported', detail: `Missing MCP tools: ${capability.missing.join(', ')}`,
          });
          continue;
        }
        const listed = await manager.callTool(root, 'list_projects', {
          format: 'json', include_details: true, limit: 100, offset: 0,
        });
        const project = projects(listed).find((item) =>
          item.root ? rootIdentity(item.root) === rootIdentity(root) : false);
        if (project) {
          this.#projects.set(root, project.name);
          this.#states.set(root, { root, kind: 'Ready', project: project.name });
        } else {
          this.#states.set(root, { root, kind: 'ReadyWithoutIndex' });
        }
      } catch (error) {
        this.#states.set(root, {
          root,
          kind: 'Error',
          detail: error instanceof Error ? error.message : String(error),
        });
        this.#output.error(`CBM connection failed for an authorized workspace root: ${String(error)}`);
      }
    }

    if (this.#disposed) return;
    this.#parser = WorkerJavaParser.create(
      this.context.asAbsolutePath(join('dist', 'parserWorker.js')),
      this.context.asAbsolutePath(join('dist', 'tree-sitter-java.wasm')),
    );
    const registry = new LanguageAdapterRegistry();
    const javaAdapter = new JavaSyntaxAdapter(this.#parser);
    registry.register('java', javaAdapter);
    const graph = new McpGraphNavigator(
      manager,
      (root) => this.#projects.get(root),
      configuration.get<number>('queryTimeoutMs'),
    );
    const engine = new NavigationEngine({
      registry,
      graph,
      resolveLocation: resolveCandidate,
      resolveRoot: (uri) => this.#resolveRoot(uri),
      minimumDirectConfidence: configuration.get<number>('minimumDirectJumpConfidence') ?? 0.85,
    });
    this.#engine = engine;
    const providers = registerNavigationProviders(
      { push: (...items) => this.#runtimeDisposables.push(...items) },
      engine,
      javaAdapter,
    );
    this.#refreshCodeLenses = providers.refreshCodeLenses;
    this.#refreshStatusBar();
  }

  #resolveRoot(documentUri: string) {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(documentUri));
    if (!folder) return undefined;
    const root = this.#folderRoots.get(folder.uri.toString());
    const state = root ? this.#states.get(root) : undefined;
    return root && state ? {
      root,
      state: state.kind,
      indexKey: [state.kind, state.project ?? this.#projects.get(root) ?? '', state.revision ?? ''].join(':'),
    } : undefined;
  }

  #currentRoot(): string | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri
      ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
    return folder ? this.#folderRoots.get(folder.uri.toString()) : undefined;
  }

  #setAll(kind: RootStateKind, detail?: string): void {
    for (const root of this.#states.keys()) {
      this.#states.set(root, { root, kind, ...(detail ? { detail } : {}) });
    }
    this.#refreshStatusBar();
  }

  #refreshStatusBar(): void {
    const root = this.#currentRoot();
    const first = this.#states.values().next().value as RootState | undefined;
    const state = root ? this.#states.get(root) : first;
    const presentation = statusPresentation(state?.kind ?? (vscode.workspace.isTrusted ? 'Missing' : 'Untrusted'));
    this.#status.text = presentation.text;
    this.#status.command = presentation.command;
    this.#status.tooltip = state?.detail ?? state?.root ?? 'CBM Navigator';
  }

  #registerCommands(): void {
    const register = (id: string, handler: (...args: unknown[]) => unknown) => {
      this.context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    };
    register(COMMANDS.showLogs, () => this.#output.show(true));
    register(COMMANDS.showStatus, () => {
      const root = this.#currentRoot();
      const state = root ? this.#states.get(root) : undefined;
      void vscode.window.showInformationMessage(state
        ? `${statusPresentation(state.kind).text.replace(/^\$\([^)]*\)\s*/, '')} — ${state.detail ?? state.root}`
        : 'CBM Navigator has no workspace root.');
    });
    register(COMMANDS.selectExecutable, async () => {
      const selected = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFiles: true });
      if (!selected?.[0]) return;
      await vscode.workspace.getConfiguration('cbmNavigator')
        .update('executablePath', selected[0].fsPath, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    });
    register(COMMANDS.retryConnection, async () => {
      await this.#starting;
      await this.start(true);
    });
    register(COMMANDS.ideaGoToDefinition, () =>
      vscode.commands.executeCommand('editor.action.revealDefinition'));
    register(COMMANDS.ideaGoToImplementation, () =>
      vscode.commands.executeCommand('editor.action.goToImplementation'));
    register(COMMANDS.ideaGoToReferences, () =>
      vscode.commands.executeCommand('editor.action.goToReferences'));
    register(COMMANDS.indexWorkspace, () => this.#indexCurrentRoot(false));
    register(COMMANDS.refreshIndex, () => this.#indexCurrentRoot(true));
    register(COMMANDS.goToDeclaration, () =>
      vscode.commands.executeCommand('editor.action.goToDeclaration'));
    register(COMMANDS.enableIdeaKeymap, () =>
      setKeymap(vscode.workspace.getConfiguration('cbmNavigator'), 'idea'));
    register(COMMANDS.disableIdeaKeymap, () =>
      setKeymap(vscode.workspace.getConfiguration('cbmNavigator'), 'vscode'));
    register(COMMANDS.setup, () => this.#installVerified(false));
    register(COMMANDS.upgrade, () => this.#installVerified(true));
  }

  async #installVerified(upgrade: boolean): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      await vscode.window.showWarningMessage('Trust this workspace before installing or upgrading CBM.');
      return;
    }
    const verb = upgrade ? 'Upgrade' : 'Install';
    const first = await vscode.window.showWarningMessage(
      `${verb} the shared CBM runtime from the official DeusData/codebase-memory-mcp release? `
      + 'The archive and checksums will be downloaded first. No system change occurs before a verified dry-run and a second confirmation.',
      { modal: true },
      'Continue',
      'Select Existing Executable',
    );
    if (first === 'Select Existing Executable') {
      await vscode.commands.executeCommand(COMMANDS.selectExecutable);
      return;
    }
    if (first !== 'Continue') return;
    const roots = [...this.#states.keys()];
    const installer = new CbmInstaller(createNodeInstallerDependencies({
      log: (message) => this.#output.info(redactLog(message, roots)),
      confirm: async (summary) => {
        const safeSummary = redactLog(summary, roots).slice(0, 4000);
        const choice = await vscode.window.showWarningMessage(
          `${safeSummary}\n\n${verb}ing coordinates the shared CBM runtime. `
          + 'CBM Navigator will disconnect and reconnect its own sessions; other code-agent sessions may require a restart.',
          { modal: true },
          verb,
        );
        if (choice !== verb) return false;
        await this.#stopRuntime();
        return true;
      },
      verifyInstalled: async () => {
        const probe = await probeConfiguredRuntime();
        if (probe.kind !== 'found' || !isSupportedVersion(probe.version)) return false;
        const root = this.#currentRoot();
        if (!root) return false;
        const verifier = new RootManager(probe.executablePath, new StdioMcpClientFactory());
        try {
          return validateCapabilities(await verifier.listTools(root)).supported;
        } finally {
          await verifier.dispose();
        }
      },
    }));
    try {
      const result = await installer.install();
      if (result.kind === 'installed') {
        await vscode.window.showInformationMessage(`CBM ${result.version} installed and verified.`);
        await this.start();
      }
    } catch (error) {
      this.#output.error(redactLog(String(error), roots));
      await vscode.window.showErrorMessage(`${verb} failed. Open CBM Navigator logs for details.`);
      await this.start();
    }
  }

  async #indexCurrentRoot(refresh: boolean): Promise<void> {
    const root = this.#currentRoot();
    if (!root || !this.#manager) return;
    const action = refresh ? 'Refresh' : 'Start';
    const choice = await vscode.window.showWarningMessage(
      `${action} CBM index for ${root} in fast mode? This authorizes the workspace root in the shared CBM configuration. `
      + 'CBM exclusions and project ignore files apply.',
      { modal: true },
      action,
    );
    if (choice !== action) return;
    this.#engine?.invalidateRoot(root);
    this.#refreshCodeLenses?.();
    this.#states.set(root, { root, kind: 'Indexing' });
    this.#refreshStatusBar();
    try {
      await this.#manager.indexRoot(root, true);
      const listed = await this.#manager.callTool(root, 'list_projects', {
        format: 'json', include_details: true, limit: 100, offset: 0,
      });
      const project = projects(listed).find((item) =>
        item.root ? rootIdentity(item.root) === rootIdentity(root) : false);
      if (project) this.#projects.set(root, project.name);
      this.#states.set(root, project
        ? { root, kind: 'Ready', project: project.name }
        : { root, kind: 'Error', detail: 'Index completed but project discovery did not return this root.' });
    } catch (error) {
      this.#states.set(root, { root, kind: 'Error', detail: String(error) });
      this.#output.error(`Index operation failed: ${String(error)}`);
    }
    this.#engine?.invalidateRoot(root);
    this.#refreshCodeLenses?.();
    this.#refreshStatusBar();
  }

  async #stopRuntime(): Promise<void> {
    for (const disposable of this.#runtimeDisposables.splice(0)) disposable.dispose();
    const parser = this.#parser;
    const manager = this.#manager;
    const engine = this.#engine;
    this.#parser = undefined;
    this.#manager = undefined;
    this.#engine = undefined;
    this.#refreshCodeLenses = undefined;
    engine?.dispose();
    await Promise.allSettled([
      parser?.dispose() ?? Promise.resolve(),
      manager?.dispose() ?? Promise.resolve(),
    ]);
  }

  dispose(): void {
    this.#disposed = true;
    void this.#stopRuntime();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const controller = new ExtensionController(context);
  context.subscriptions.push(controller);
  void controller.start();
}

export function deactivate(): void {}
