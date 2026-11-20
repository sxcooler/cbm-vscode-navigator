import { copyFile, mkdir } from 'node:fs/promises';
import { builtinModules, createRequire } from 'node:module';
import { build } from 'esbuild';

const localRequire = createRequire(import.meta.url);
const npmResolver = {
  name: 'local-npm-resolver',
  setup(buildContext) {
    buildContext.onResolve({ filter: /.*/ }, (args) => {
      if (args.path.startsWith('.') || args.path.startsWith('/')
          || args.path.startsWith('node:') || builtinModules.includes(args.path)) {
        return undefined;
      }
      if (args.path === 'vscode' || args.path === 'mocha') {
        return { path: args.path, external: true };
      }
      try {
        return { path: localRequire.resolve(args.path) };
      } catch {
        return undefined;
      }
    });
  },
};

await mkdir('dist', { recursive: true });

await build({
  entryPoints: {
    extension: 'src/extension.ts',
    parserWorker: 'src/languages/java/parserWorker.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  plugins: [npmResolver],
  sourcemap: true,
});

await build({
  entryPoints: {
    index: 'src/test/integration/index.ts',
    smoke: 'src/test/integration/smoke.test.ts',
  },
  outdir: 'dist/test',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode', 'mocha'],
  plugins: [npmResolver],
});

await Promise.all([
  copyFile('node_modules/web-tree-sitter/tree-sitter.wasm', 'dist/tree-sitter.wasm'),
  copyFile('node_modules/tree-sitter-java/tree-sitter-java.wasm', 'dist/tree-sitter-java.wasm'),
]);
