export const REQUIRED_TOOLS = [
  'index_repository',
  'list_projects',
  'index_status',
  'check_index_coverage',
  'search_graph',
  'query_graph',
  'trace_path',
  'get_graph_schema',
] as const;

export interface CapabilityResult {
  readonly supported: boolean;
  readonly missing: readonly string[];
}

export function validateCapabilities(tools: readonly string[]): CapabilityResult {
  const available = new Set(tools);
  const missing = REQUIRED_TOOLS.filter((tool) => !available.has(tool));
  return { supported: missing.length === 0, missing };
}
