import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';

export interface McpClient {
  listTools(): Promise<readonly string[]>;
  callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void>;
}

export interface McpClientFactory {
  authorizeRoot(executablePath: string, root: string): Promise<void>;
  create(
    executablePath: string,
    environment: Readonly<Record<string, string>>,
    workingDirectory: string,
  ): Promise<McpClient>;
}

export type ExecutableRunner = (
  executablePath: string,
  args: readonly string[],
) => Promise<void>;

const execFileAsync = promisify(execFile);

const runExecutable: ExecutableRunner = async (executablePath, args) => {
  await execFileAsync(executablePath, [...args], {
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 64 * 1024,
  });
};

class SdkMcpClient implements McpClient {
  constructor(
    readonly client: Client,
    readonly transport: StdioClientTransport,
  ) {}

  async listTools(): Promise<readonly string[]> {
    const result = await this.client.listTools();
    return result.tools.map((tool) => tool.name);
  }

  async callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.client.callTool(
      { name, arguments: { ...args } },
      undefined,
      name === 'index_repository'
        ? { ...(signal ? { signal } : {}), timeout: 30 * 60_000 }
        : (signal ? { signal } : undefined),
    );
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}

export class StdioMcpClientFactory implements McpClientFactory {
  constructor(readonly execute: ExecutableRunner = runExecutable) {}

  async authorizeRoot(executablePath: string, root: string): Promise<void> {
    await this.execute(executablePath, ['allow-root', root.replaceAll('\\', '/')]);
  }

  async create(
    executablePath: string,
    environment: Readonly<Record<string, string>>,
    workingDirectory: string,
  ): Promise<McpClient> {
    const client = new Client({ name: 'cbm-vscode-navigator', version: '0.1.6' });
    const transport = new StdioClientTransport({
      command: executablePath,
      args: [],
      env: { ...getDefaultEnvironment(), ...environment },
      cwd: workingDirectory,
      stderr: 'pipe',
    });
    await client.connect(transport);
    return new SdkMcpClient(client, transport);
  }
}
