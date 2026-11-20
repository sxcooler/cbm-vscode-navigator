import type { RootStateKind } from './contracts.js';

export interface StatusPresentation {
  readonly text: string;
  readonly command: string;
}

const PRESENTATIONS: Record<RootStateKind, StatusPresentation> = {
  Untrusted: { text: '$(lock) CBM: Trust Required', command: 'workbench.trust.manage' },
  Disconnected: { text: '$(debug-disconnect) CBM: Connect', command: 'cbmNavigator.retryConnection' },
  Connecting: { text: '$(sync~spin) CBM: Connecting…', command: 'cbmNavigator.showLogs' },
  Missing: { text: '$(cloud-download) CBM: Install', command: 'cbmNavigator.setup' },
  Unsupported: { text: '$(warning) CBM: Upgrade', command: 'cbmNavigator.upgrade' },
  ReadyWithoutIndex: { text: '$(database) CBM: Index', command: 'cbmNavigator.indexWorkspace' },
  Indexing: { text: '$(sync~spin) CBM: Indexing…', command: 'cbmNavigator.showLogs' },
  Ready: { text: '$(check) CBM: Ready', command: 'cbmNavigator.showStatus' },
  Stale: { text: '$(refresh) CBM: Stale', command: 'cbmNavigator.refreshIndex' },
  Degraded: { text: '$(warning) CBM: Degraded', command: 'cbmNavigator.retryConnection' },
  Error: { text: '$(error) CBM: Error', command: 'cbmNavigator.showStatus' },
};

export function statusPresentation(kind: RootStateKind): StatusPresentation {
  return PRESENTATIONS[kind];
}
