export interface ConfigurationWriter {
  update(section: string, value: unknown, global: boolean): PromiseLike<void>;
}

export type Keymap = 'vscode' | 'idea';

export async function setKeymap(configuration: ConfigurationWriter, keymap: Keymap): Promise<void> {
  await configuration.update('keymap', keymap, true);
}

export const COMMANDS = {
  setup: 'cbmNavigator.setup',
  upgrade: 'cbmNavigator.upgrade',
  selectExecutable: 'cbmNavigator.selectExecutable',
  indexWorkspace: 'cbmNavigator.indexWorkspace',
  refreshIndex: 'cbmNavigator.refreshIndex',
  showStatus: 'cbmNavigator.showStatus',
  showLogs: 'cbmNavigator.showLogs',
  retryConnection: 'cbmNavigator.retryConnection',
  goToDeclaration: 'cbmNavigator.goToDeclaration',
  openCodeLensTargets: 'cbmNavigator.openCodeLensTargets',
  ideaGoToDefinition: 'cbmNavigator.ideaGoToDefinition',
  ideaGoToImplementation: 'cbmNavigator.ideaGoToImplementation',
  ideaGoToReferences: 'cbmNavigator.ideaGoToReferences',
  enableIdeaKeymap: 'cbmNavigator.enableIdeaKeymap',
  disableIdeaKeymap: 'cbmNavigator.disableIdeaKeymap',
} as const;
