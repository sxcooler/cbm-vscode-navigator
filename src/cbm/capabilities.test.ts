import { describe, expect, it } from 'vitest';
import { REQUIRED_TOOLS, validateCapabilities } from './capabilities.js';

describe('validateCapabilities', () => {
  it('accepts the complete tool contract and preserves future tools', () => {
    const result = validateCapabilities([...REQUIRED_TOOLS, 'future_tool']);
    expect(result).toEqual({ supported: true, missing: [] });
  });

  it('reports every missing required tool', () => {
    const result = validateCapabilities(['search_graph']);
    expect(result.supported).toBe(false);
    expect(result.missing).toContain('index_repository');
    expect(result.missing).toContain('query_graph');
    expect(result.missing).not.toContain('search_graph');
  });
});
