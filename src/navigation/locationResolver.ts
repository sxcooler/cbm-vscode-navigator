import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NavigationCandidate } from '../contracts.js';
import type { LocationTarget } from './results.js';

function within(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function tokenName(qualifiedName: string): string {
  const withoutSignature = qualifiedName.replace(/\(.*$/, '').replace(/#.*$/, '');
  return withoutSignature.slice(withoutSignature.lastIndexOf('.') + 1);
}

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findToken(lines: readonly string[], token: string, from: number, to: number) {
  const expression = new RegExp(`\\b${escapedRegex(token)}\\b`);
  for (let line = from; line <= to; line += 1) {
    const text = lines[line];
    if (text === undefined) continue;
    const match = expression.exec(text);
    if (match) {
      return {
        start: { line, character: match.index },
        end: { line, character: match.index + token.length },
      };
    }
  }
  return undefined;
}

export async function resolveCandidate(
  authorizedRoot: string,
  candidate: NavigationCandidate,
): Promise<LocationTarget | undefined> {
  try {
    const root = await realpath(authorizedRoot);
    const proposed = isAbsolute(candidate.filePath)
      ? candidate.filePath
      : resolve(root, candidate.filePath);
    const target = await realpath(proposed);
    if (!within(root, target)) return undefined;
    const source = await readFile(target, 'utf8');
    const lines = source.split(/\r?\n/);
    if (lines.length === 0) return undefined;
    const token = tokenName(candidate.qualifiedName);
    const start = Math.max(0, Math.min(lines.length - 1, candidate.startLine - 1));
    const end = Math.max(start, Math.min(lines.length - 1, candidate.endLine - 1));
    const range = findToken(lines, token, start, end)
      ?? findToken(lines, token, 0, lines.length - 1);
    if (!range) return undefined;
    return { uri: pathToFileURL(target).toString(), range };
  } catch {
    return undefined;
  }
}
