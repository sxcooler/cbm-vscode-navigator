import { describe, expect, it } from 'vitest';
import { statusPresentation } from './status.js';

describe('statusPresentation', () => {
  it.each([
    ['Disconnected', '$(debug-disconnect) CBM: Connect', 'cbmNavigator.retryConnection'],
    ['Connecting', '$(sync~spin) CBM: Connecting…', 'cbmNavigator.showLogs'],
    ['Missing', '$(cloud-download) CBM: Install', 'cbmNavigator.setup'],
    ['Unsupported', '$(warning) CBM: Upgrade', 'cbmNavigator.upgrade'],
    ['ReadyWithoutIndex', '$(database) CBM: Index', 'cbmNavigator.indexWorkspace'],
    ['Indexing', '$(sync~spin) CBM: Indexing…', 'cbmNavigator.showLogs'],
    ['Ready', '$(check) CBM: Ready', 'cbmNavigator.showStatus'],
    ['Stale', '$(refresh) CBM: Stale', 'cbmNavigator.refreshIndex'],
    ['Error', '$(error) CBM: Error', 'cbmNavigator.showStatus'],
  ] as const)('maps %s to its compact action', (kind, text, command) => {
    expect(statusPresentation(kind)).toEqual({ text, command });
  });
});
