import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface KeybindingContribution {
  readonly command: string;
  readonly key: string;
  readonly when?: string;
}

interface MenuContribution {
  readonly command: string;
}

interface ExtensionManifest {
  readonly version: string;
  readonly icon?: string;
  readonly contributes: {
    readonly keybindings: readonly KeybindingContribution[];
    readonly menus?: Readonly<Record<string, readonly MenuContribution[]>>;
  };
}

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
) as ExtensionManifest;

describe('extension navigation contributions', () => {
  it('packages release 0.1.6 with the supplied 256px PNG icon', () => {
    expect(manifest.version).toBe('0.1.6');
    expect(manifest.icon).toBe('images/icon.png');
    const icon = readFileSync(resolve(process.cwd(), manifest.icon!));
    expect(icon.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(icon.readUInt32BE(16)).toBe(256);
    expect(icon.readUInt32BE(20)).toBe(256);
  });

  it('keeps conditional IDEA shortcuts off VS Code built-in command ids', () => {
    expect(manifest.contributes.keybindings.map(({ command, key, when }) => ({ command, key, when })))
      .toEqual([
        {
          command: 'cbmNavigator.ideaGoToDefinition',
          key: 'ctrl+b',
          when: 'editorTextFocus && editorLangId == java && config.cbmNavigator.keymap == idea',
        },
        {
          command: 'cbmNavigator.ideaGoToImplementation',
          key: 'ctrl+alt+b',
          when: 'editorTextFocus && editorLangId == java && config.cbmNavigator.keymap == idea',
        },
        {
          command: 'cbmNavigator.ideaGoToReferences',
          key: 'alt+f7',
          when: 'editorTextFocus && editorLangId == java && config.cbmNavigator.keymap == idea',
        },
      ]);
  });

  it('does not duplicate VS Code navigation commands in the editor context menu', () => {
    const editorMenu = manifest.contributes.menus?.['editor/context'] ?? [];
    expect(editorMenu).not.toContainEqual({
      command: 'cbmNavigator.goToDeclaration',
      when: 'editorLangId == java',
      group: 'navigation@2',
    });
  });
});
