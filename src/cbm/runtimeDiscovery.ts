import type { ExecFileException } from 'node:child_process';
import { parseSemVer, type SemVer } from './version.js';

export interface RuntimeDiscoveryOptions {
  readonly configuredPath?: string;
  readonly pathValue?: string;
  readonly defaultPaths: readonly string[];
  readonly executableName: string;
  readonly pathDelimiter: string;
  readonly probeTimeoutMs?: number;
  readonly exists: (path: string) => Promise<boolean>;
  readonly run: (
    executablePath: string,
    args: readonly string[],
    timeoutMs: number,
  ) => Promise<{ readonly stdout: string }>;
}

export type RuntimeProbe =
  | {
      readonly kind: 'found';
      readonly executablePath: string;
      readonly version: SemVer;
      readonly failures: readonly RuntimeProbeFailure[];
    }
  | { readonly kind: 'missing'; readonly failures: readonly RuntimeProbeFailure[] };

export interface RuntimeProbeFailure {
  readonly executablePath: string;
  readonly reason: 'malformed-version' | 'probe-failed';
}

function joinExecutable(directory: string, name: string): string {
  return `${directory.replace(/[\\/]+$/, '')}/${name}`;
}

function candidatePaths(options: RuntimeDiscoveryOptions): string[] {
  const result: string[] = [];
  if (options.configuredPath?.trim()) result.push(options.configuredPath.trim());
  for (const directory of (options.pathValue ?? '').split(options.pathDelimiter)) {
    if (directory.trim()) result.push(joinExecutable(directory.trim(), options.executableName));
  }
  result.push(...options.defaultPaths);
  const seen = new Set<string>();
  return result.filter((candidate) => {
    const key = candidate.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function discoverRuntime(options: RuntimeDiscoveryOptions): Promise<RuntimeProbe> {
  const failures: RuntimeProbeFailure[] = [];
  for (const executablePath of candidatePaths(options)) {
    if (!(await options.exists(executablePath))) continue;
    try {
      const output = await options.run(
        executablePath,
        ['--version'],
        options.probeTimeoutMs ?? 1500,
      );
      const version = parseSemVer(output.stdout);
      if (version) return { kind: 'found', executablePath, version, failures };
      failures.push({ executablePath, reason: 'malformed-version' });
    } catch {
      failures.push({ executablePath, reason: 'probe-failed' });
    }
  }
  return { kind: 'missing', failures };
}

export async function readAutoIndex(
  executablePath: string,
  run: RuntimeDiscoveryOptions['run'],
): Promise<boolean> {
  const timeoutMs = 30_000;
  const { stdout } = await run(executablePath, ['config', 'get', 'auto_index'], timeoutMs)
    .catch((error: ExecFileException) => {
      if (error?.killed && error.signal === 'SIGTERM' && error.code === null) {
        throw new Error(`CBM auto_index check timed out after ${timeoutMs} ms.`, { cause: error });
      }
      throw error;
    });
  const value = stdout.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('CBM auto_index configuration is not a boolean.');
}
