import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const liveWorkspace = process.env.CBM_INTEGRATION_WORKSPACE_ROOT;

const electronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_RUN_AS_NODE;
try {
  await runTests({
    ...(process.env.VSCODE_EXECUTABLE_PATH
      ? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH }
      : { version: '1.135.0' }),
    extensionDevelopmentPath: root,
    extensionTestsPath: resolve(root, 'dist', 'test', 'index.js'),
    extensionTestsEnv: {
      JAVA_HOME: '',
      JRE_HOME: '',
      ...(process.env.CBM_INTEGRATION_FILE
        ? { CBM_INTEGRATION_FILE: process.env.CBM_INTEGRATION_FILE }
        : {}),
      ...(process.env.CBM_INTEGRATION_SYMBOL
        ? { CBM_INTEGRATION_SYMBOL: process.env.CBM_INTEGRATION_SYMBOL }
        : {}),
      ...(process.env.CBM_INTEGRATION_LINE
        ? { CBM_INTEGRATION_LINE: process.env.CBM_INTEGRATION_LINE }
        : {}),
      ...(process.env.CBM_INTEGRATION_EXPECT_DEFINITION_SUFFIX
        ? { CBM_INTEGRATION_EXPECT_DEFINITION_SUFFIX: process.env.CBM_INTEGRATION_EXPECT_DEFINITION_SUFFIX }
        : {}),
      ...(process.env.CBM_INTEGRATION_REFERENCE_FILE
        ? { CBM_INTEGRATION_REFERENCE_FILE: process.env.CBM_INTEGRATION_REFERENCE_FILE }
        : {}),
      ...(process.env.CBM_INTEGRATION_REFERENCE_SYMBOL
        ? { CBM_INTEGRATION_REFERENCE_SYMBOL: process.env.CBM_INTEGRATION_REFERENCE_SYMBOL }
        : {}),
      ...(process.env.CBM_INTEGRATION_REFERENCE_LINE
        ? { CBM_INTEGRATION_REFERENCE_LINE: process.env.CBM_INTEGRATION_REFERENCE_LINE }
        : {}),
      ...(process.env.CBM_INTEGRATION_EXPECT_REFERENCE_SUFFIX
        ? { CBM_INTEGRATION_EXPECT_REFERENCE_SUFFIX: process.env.CBM_INTEGRATION_EXPECT_REFERENCE_SUFFIX }
        : {}),
      ...(process.env.CBM_INTEGRATION_CODELENS_FILE
        ? { CBM_INTEGRATION_CODELENS_FILE: process.env.CBM_INTEGRATION_CODELENS_FILE }
        : {}),
      ...(process.env.CBM_INTEGRATION_CODELENS_SYMBOL
        ? { CBM_INTEGRATION_CODELENS_SYMBOL: process.env.CBM_INTEGRATION_CODELENS_SYMBOL }
        : {}),
      ...(process.env.CBM_INTEGRATION_CODELENS_LINE
        ? { CBM_INTEGRATION_CODELENS_LINE: process.env.CBM_INTEGRATION_CODELENS_LINE }
        : {}),
    },
    launchArgs: [
      liveWorkspace ?? resolve(root, 'examples', 'java'),
      '--disable-extensions',
      '--disable-workspace-trust',
    ],
  });
} finally {
  if (electronRunAsNode !== undefined) process.env.ELECTRON_RUN_AS_NODE = electronRunAsNode;
}
