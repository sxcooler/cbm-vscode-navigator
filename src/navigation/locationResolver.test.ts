import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NavigationCandidate } from '../contracts.js';
import { resolveCandidate } from './locationResolver.js';

function candidate(filePath: string, startLine = 2): NavigationCandidate {
  return {
    kind: 'method', qualifiedName: 'demo.Service.run', relationship: 'CALLS',
    filePath, startLine, endLine: startLine, evidence: [], indexed: true,
  };
}

describe('resolveCandidate', () => {
  it('resolves a relative path to the exact token in an authorized root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cbm-nav-'));
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'Service.java'), 'class Service {\n  void run() {}\n}\n');
    const target = await resolveCandidate(root, candidate('src/Service.java'));
    expect(target).toEqual({
      uri: pathToFileURL(join(root, 'src', 'Service.java')).toString(),
      range: { start: { line: 1, character: 7 }, end: { line: 1, character: 10 } },
    });
  });

  it('recovers an exact qualified declaration from a stale line', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cbm-nav-'));
    await writeFile(join(root, 'Service.java'), '// shifted\n// again\nclass Service { void run() {} }\n');
    const target = await resolveCandidate(root, candidate('Service.java', 1));
    expect(target?.range.start).toEqual({ line: 2, character: 21 });
  });

  it('rejects paths outside the authorized root and missing tokens', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cbm-nav-'));
    const outside = await mkdtemp(join(tmpdir(), 'outside-'));
    const outsideFile = join(outside, 'Service.java');
    await writeFile(outsideFile, 'class Service { void run() {} }');
    await writeFile(join(root, 'Service.java'), 'class Service {}');
    await expect(resolveCandidate(root, candidate(outsideFile))).resolves.toBeUndefined();
    await expect(resolveCandidate(root, candidate('Service.java'))).resolves.toBeUndefined();
  });
});
