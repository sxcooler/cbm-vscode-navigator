import type { McpClient, McpClientFactory } from './mcpClient.js';

export class StaleCursorError extends Error {
  constructor() {
    super('stale_cursor');
    this.name = 'StaleCursorError';
  }
}

function isStaleCursor(error: unknown): boolean {
  return error instanceof StaleCursorError
    || (error instanceof Error && error.message.includes('stale_cursor'));
}

function mcpToolError(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const response = result as Record<string, unknown>;
  if (response.isError !== true) return undefined;
  if (response.structuredContent && typeof response.structuredContent === 'object') {
    const error = (response.structuredContent as Record<string, unknown>).error;
    if (typeof error === 'string' && error.trim()) return error;
  }
  if (Array.isArray(response.content)) {
    for (const item of response.content) {
      if (!item || typeof item !== 'object') continue;
      const text = (item as Record<string, unknown>).text;
      if (typeof text === 'string' && text.trim()) return text;
    }
  }
  return 'CBM index_repository failed.';
}

export class RootManager {
  readonly #clients = new Map<string, Promise<McpClient>>();

  constructor(
    readonly executablePath: string,
    readonly factory: McpClientFactory,
  ) {}

  async #client(root: string): Promise<McpClient> {
    let pending = this.#clients.get(root);
    if (!pending) {
      pending = this.factory.create(this.executablePath, {
        CBM_ALLOWED_ROOT: root.replaceAll('\\', '/'),
      }, root);
      this.#clients.set(root, pending);
      void pending.catch(() => this.#clients.delete(root));
    }
    return pending;
  }

  async callTool(
    root: string,
    name: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return (await this.#client(root)).callTool(name, args, signal);
  }

  async listTools(root: string): Promise<readonly string[]> {
    return (await this.#client(root)).listTools();
  }

  async callWithCursorRestart(
    root: string,
    name: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    try {
      return await this.callTool(root, name, args, signal);
    } catch (error) {
      if (!isStaleCursor(error) || !Object.hasOwn(args, 'cursor')) throw error;
      const restartArgs = { ...args };
      delete restartArgs.cursor;
      return this.callTool(root, name, restartArgs, signal);
    }
  }

  async indexRoot(root: string, confirmed: boolean, signal?: AbortSignal): Promise<boolean> {
    if (!confirmed) return false;
    await this.factory.authorizeRoot(this.executablePath, root);
    const result = await this.callTool(
      root,
      'index_repository',
      { repo_path: root, mode: 'fast' },
      signal,
    );
    const error = mcpToolError(result);
    if (error) throw new Error(error);
    return true;
  }

  async closeRoot(root: string): Promise<void> {
    const pending = this.#clients.get(root);
    this.#clients.delete(root);
    if (pending) await (await pending).close();
  }

  async dispose(): Promise<void> {
    const clients = [...this.#clients.values()];
    this.#clients.clear();
    await Promise.allSettled(clients.map(async (pending) => (await pending).close()));
  }
}
