# Declaration Navigation and CodeLens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release CBM Navigator 0.1.4 with declaration-site caller/reference navigation, declaration/implementation CodeLens links, and the supplied extension logo.

**Architecture:** Extend the existing Tree-sitter Worker boundary to enumerate Java declarations, add one normalized declaration-relation bundle to the graph/navigation layers, and resolve CodeLens lazily through the same navigation targets and confidence policy. Keep VS Code-specific rendering in a new provider module while the parser, relation cache, and presentation decisions remain independently unit-testable.

**Tech Stack:** TypeScript 5.9, VS Code Extension API 1.96, web-tree-sitter with tree-sitter-java WASM, codebase-memory-mcp graph tools, Vitest, Mocha Extension Test, esbuild, vsce.

**Spec:** `docs/superpowers/specs/2026-08-28-declaration-navigation-codelens-design.md`

## Global Constraints

- The release version is exactly `0.1.4`, not `0.2.0`.
- Java parsing runs in the existing Worker and supports both saved and unsaved editor documents without a JDK/JRE.
- Caller/reference results always use Peek; unique declaration/implementation links may navigate directly.
- Empty, cancelled, timed-out, unready, unsafe, or stale relationships produce no CodeLens and no popup.
- No new keybinding or extension-specific CodeLens setting is introduced.
- All source, fixtures, docs, tests, history introduced by this work, and VSIX contents must contain no private-workspace names, paths, symbols, screenshots, or copied source.
- The supplied logo remains `images/icon.png`, is referenced by the manifest, and is included in the VSIX.

---

## File Structure

- `src/contracts.ts`: shared declaration and relation-bundle contracts; optional declaration enumeration on language adapters.
- `src/languages/java/javaAnalysis.ts`: Tree-sitter declaration extraction and parser-side cache reuse.
- `src/languages/java/parserProtocol.ts`: Worker request/response and backend contracts for declaration enumeration.
- `src/languages/java/parserWorker.ts`: Worker dispatch for `declarations` requests.
- `src/languages/java/workerParser.ts`: Extension-host client for declaration enumeration.
- `src/languages/java/adapter.ts`: document/version/cancellation guard for Java declarations.
- `src/cbm/queryBuilder.ts`: fixed read-only Cypher templates for exact declaration families and callers.
- `src/cbm/graphAdapter.ts`: normalized `DeclarationRelationBundle` construction.
- `src/navigation/declarationCache.ts`: in-flight sharing and root/document invalidation for relation bundles.
- `src/navigation/engine.ts`: declaration-site smart-navigation branch and CodeLens relation outcomes.
- `src/codeLens.ts`: pure CodeLens model plus VS Code provider, resolver, and target-presentation command.
- `src/providers.ts`: register navigation providers and declaration CodeLens together.
- `src/commands.ts`: internal CodeLens target command identifier.
- `src/extension.ts`: provider wiring and cache invalidation on document/index lifecycle events.
- `package.json`, `package-lock.json`, `src/manifest.test.ts`: 0.1.4 version and icon declaration.
- `README.md`, `CHANGELOG.md`: user-facing declaration navigation and CodeLens behavior.

### Task 1: Enumerate Java declarations through the Worker

**Files:**
- Modify: `src/contracts.ts`
- Modify: `src/languages/java/javaAnalysis.ts`
- Modify: `src/languages/java/parserProtocol.ts`
- Modify: `src/languages/java/parserWorker.ts`
- Modify: `src/languages/java/workerParser.ts`
- Modify: `src/languages/java/adapter.ts`
- Modify: `src/languages/java/adapter.test.ts`
- Modify: `src/languages/java/workerParser.test.ts`
- Modify: `examples/java/**`

**Interfaces:**
- Consumes: existing `TextDocumentLike`, `Position`, `Range`, `SymbolKind`, `CancellationLike`, and cached Tree-sitter document trees.
- Produces: `DeclarationDescriptor`, `LanguageAdapter.getDeclarations(...)`, and `JavaParserBackend.declarations(...)` for Tasks 3 and 4.

- [ ] **Step 1: Add failing adapter tests for complete declaration enumeration**

Add generic declarations to the committed multi-file fixture and assert exact names, kinds, owners, arities, ranges, and modifiers:

```ts
const declarations = await adapter.getDeclarations(document(source));
expect(declarations).toEqual(expect.arrayContaining([
  expect.objectContaining({ name: 'Runner', kind: 'type', ownerName: undefined }),
  expect.objectContaining({ name: 'run', kind: 'method', ownerName: 'Runner', argumentCount: 1, abstract: true }),
  expect.objectContaining({ name: 'Demo', kind: 'constructor', ownerName: 'Demo', argumentCount: 0 }),
  expect.objectContaining({ name: 'count', kind: 'field', ownerName: 'Demo' }),
]));
expect(declarations.every((item) => item.documentVersion === 1)).toBe(true);
```

- [ ] **Step 2: Run the focused adapter test and verify the missing API failure**

Run: `npx vitest run src/languages/java/adapter.test.ts`

Expected: FAIL because `JavaSyntaxAdapter.getDeclarations` does not exist.

- [ ] **Step 3: Add the shared declaration contracts**

Add this exact shape to `src/contracts.ts` and extend `LanguageAdapter`:

```ts
export interface DeclarationDescriptor {
  readonly documentUri: string;
  readonly documentVersion: number;
  readonly name: string;
  readonly kind: Extract<SymbolKind, 'type' | 'method' | 'constructor' | 'field'>;
  readonly tokenRange: Range;
  readonly declarationRange: Range;
  readonly packageName?: string;
  readonly ownerName?: string;
  readonly argumentCount?: number;
  readonly signatureHint?: string;
  readonly abstract: boolean;
  readonly override: boolean;
}

getDeclarations?(
  document: TextDocumentLike,
  cancellation?: CancellationLike,
): Promise<readonly DeclarationDescriptor[]>;
```

- [ ] **Step 4: Implement declaration extraction from the cached Tree-sitter tree**

Add `enumerateJavaDeclarations(tree, source, uri, version)` to visit type, method, constructor, and field declaration nodes. Use field-name children for the identifier and parameter list, derive the nearest owning type, detect `abstract`/interface membership and `@Override`, and return source-ordered descriptors. Add `TreeSitterJavaParser.declarations(...)` using the same version/source cache path as `analyze(...)`; do not construct a second parser or tree cache.

```ts
export function enumerateJavaDeclarations(
  tree: Tree,
  source: string,
  uri: string,
  version: number,
): DeclarationDescriptor[];
```

- [ ] **Step 5: Carry the new request through the Worker protocol**

Extend the discriminated unions and backend:

```ts
| { readonly id: number; readonly type: 'declarations'; readonly uri: string;
    readonly version: number; readonly source: string }

| { readonly id: number; readonly ok: true;
    readonly declarations?: readonly DeclarationDescriptor[] }

declarations(
  uri: string,
  version: number,
  source: string,
  signal?: AbortSignal,
): Promise<readonly DeclarationDescriptor[]>;
```

Dispatch `declarations` in `parserWorker.ts`; in `WorkerJavaParser`, share the pending-request machinery while preserving a typed empty-array result on cancellation.

- [ ] **Step 6: Guard document language, cancellation, and version in the adapter**

Implement `JavaSyntaxAdapter.getDeclarations` with the same AbortController/subscription pattern as `getSymbolContext`, returning `[]` for non-Java, cancellation, or any descriptor version that differs from `document.version`.

- [ ] **Step 7: Add Worker-boundary and stale-version tests**

Assert the serialized request contains plain data and that a stale response is discarded:

```ts
expect(worker.postMessage).toHaveBeenCalledWith({
  id: 1, type: 'declarations', uri: 'file:///A.java', version: 3, source: 'class A {}',
});
await expect(adapter.getDeclarations(document(source, 4))).resolves.toEqual([]);
```

- [ ] **Step 8: Run parser tests and type checking**

Run: `npx vitest run src/languages/java/adapter.test.ts src/languages/java/workerParser.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/contracts.ts src/languages/java
git commit -m "Add Java declaration enumeration"
```

### Task 2: Resolve logical declaration families and callers

**Files:**
- Modify: `src/contracts.ts`
- Modify: `src/navigation/engine.ts`
- Modify: `src/cbm/queryBuilder.ts`
- Modify: `src/cbm/queryBuilder.test.ts`
- Modify: `src/cbm/graphAdapter.ts`
- Modify: `src/cbm/graphAdapter.test.ts`
- Modify: `src/test/contract/cbm.contract.test.ts`

**Interfaces:**
- Consumes: `DeclarationDescriptor`, normalized `NavigationCandidate`, root-scoped project identity, and CBM graph rows.
- Produces: `DeclarationRelationBundle` and `GraphNavigator.declarationRelations(root, descriptor, signal)` for Tasks 3 and 4.

- [ ] **Step 1: Add failing query-builder tests for an exact logical member family**

Add assertions that the query anchors the selected owner/name/arity and collects both directions of type inheritance plus incoming call occurrences:

```ts
const query = buildDeclarationRelationsQuery({
  name: 'run', kind: 'method', qualifiedOwner: 'demo.Worker', argumentCount: 1,
});
expect(query).toContain("selected.name = 'run'");
expect(query).toContain("owner.qualified_name = 'demo.Worker'");
expect(query).toContain('selected.param_count = 1');
expect(query).toContain('CALLS|CALL_REFERENCE');
expect(query).toContain('relationship');
expect(query).not.toMatch(/\b(CREATE|DELETE|SET|MERGE|REMOVE|DROP)\b/);
```

- [ ] **Step 2: Run the query-builder test and verify the missing function failure**

Run: `npx vitest run src/cbm/queryBuilder.test.ts`

Expected: FAIL because `buildDeclarationRelationsQuery` does not exist.

- [ ] **Step 3: Define the relation bundle and graph operation**

Add to `src/contracts.ts`:

```ts
export interface DeclarationRelationBundle {
  readonly selected: DeclarationDescriptor;
  readonly family: readonly NavigationCandidate[];
  readonly declarations: readonly NavigationCandidate[];
  readonly implementations: readonly NavigationCandidate[];
  readonly callers: readonly NavigationCandidate[];
  readonly references: readonly NavigationCandidate[];
}
```

Add to `GraphNavigator`:

```ts
declarationRelations(
  root: string,
  descriptor: DeclarationDescriptor,
  signal?: AbortSignal,
): Promise<DeclarationRelationBundle>;
```

- [ ] **Step 4: Implement fixed read-only relation queries**

Create `buildDeclarationRelationsQuery(input)` in `queryBuilder.ts`. For methods/constructors, return rows tagged as `DECLARATION`, `IMPLEMENTATION`, or `CALLER`; callers must expose the occurrence line from `CALLS|CALL_REFERENCE`. For types/fields, reuse verified reference templates and tag rows `REFERENCE`. Escape every external string through `escapeCypherString`; interpolate arity only after `Number.isInteger` validation.

- [ ] **Step 5: Add failing graph-adapter normalization tests**

Mock one mixed relation response and assert partitioning, deduplication, and declaration/override exclusion:

```ts
await expect(graph.declarationRelations(root, declarationDescriptor)).resolves.toMatchObject({
  declarations: [expect.objectContaining({ qualifiedName: 'demo.Worker.run' })],
  implementations: [expect.objectContaining({ qualifiedName: 'demo.FastWorker.run' })],
  callers: [expect.objectContaining({ filePath: 'src/Caller.java', startLine: 21 })],
});
```

Use only generic names such as `Worker`, `FastWorker`, and `Caller`.

- [ ] **Step 6: Implement bundle construction in `McpGraphNavigator`**

Resolve the selected declaration candidates first, derive the most qualified owner from the descriptor package/owner and exact definition rows, execute the relation query, normalize rows by relationship tag, filter incompatible signature/arity results, and deduplicate by qualified name/file/line. Remove the selected declaration's exact file/range from declarations, implementations, callers, and references so self-links are never counted. Populate `selected` with the input descriptor and never leak raw CBM response shapes.

- [ ] **Step 7: Extend the generic CBM contract fixture**

In the temporary `Worker`/`Demo`/`Caller` fixture, assert both interface and implementation declaration contexts yield a bundle whose callers include `Caller.call`, while declaration/implementation lines do not appear in `callers`.

- [ ] **Step 8: Run query, graph, and optional contract tests**

Run: `npx vitest run src/cbm/queryBuilder.test.ts src/cbm/graphAdapter.test.ts`

Expected: PASS.

Run: `npm run test:contract`

Expected: the executable capability contract passes when `CBM_TEST_EXECUTABLE` is configured; otherwise the suite reports a skip without failure. Project-specific graph checks remain opt-in through live-workspace environment variables.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/contracts.ts src/navigation/engine.ts src/cbm/queryBuilder.ts src/cbm/queryBuilder.test.ts src/cbm/graphAdapter.ts src/cbm/graphAdapter.test.ts src/test/contract/cbm.contract.test.ts
git commit -m "Resolve declaration families and callers"
```

### Task 3: Route declaration clicks and cache relation bundles

**Files:**
- Create: `src/navigation/declarationCache.ts`
- Create: `src/navigation/declarationCache.test.ts`
- Modify: `src/navigation/engine.ts`
- Modify: `src/navigation/engine.test.ts`
- Modify: `src/extension.ts`

**Interfaces:**
- Consumes: `GraphNavigator.declarationRelations`, `DeclarationRelationBundle`, `RootResolution`, and `resolveLocation`.
- Produces: declaration-aware `NavigationEngine.definition`, `NavigationEngine.declarationRelations`, and explicit invalidation methods for Task 4.

- [ ] **Step 1: Add failing engine tests for declaration-site behavior**

Test both branches and require Peek even for one usage:

```ts
await expect(methodEngine.definition(document, position)).resolves.toMatchObject({
  mode: 'peek', targets: [{ uri: 'file:///repo/Caller.java' }],
});
expect(methodGraph.declarationRelations).toHaveBeenCalledTimes(1);

await expect(typeEngine.definition(document, position)).resolves.toMatchObject({
  mode: 'peek', targets: [{ uri: 'file:///repo/TypeUser.java' }],
});
```

Also assert invocation behavior still returns unique direct, multiple Peek, and no-implementation declaration fallback.

- [ ] **Step 2: Run the engine test and verify declaration clicks still use definitions**

Run: `npx vitest run src/navigation/engine.test.ts`

Expected: FAIL because `definition` has no declaration-role branch.

- [ ] **Step 3: Implement a declaration relation promise cache**

Create `DeclarationRelationCache` keyed by canonical root, project/index state key, document URI, document version, and token range. It must share an in-flight promise, remove rejected promises, and expose:

```ts
getOrCreate(key: DeclarationRelationKey, loader: () => Promise<DeclarationRelationBundle>): Promise<DeclarationRelationBundle>;
invalidateDocument(documentUri: string): void;
invalidateRoot(root: string): void;
clear(): void;
```

- [ ] **Step 4: Add cache tests for sharing and invalidation**

Assert identical keys call the loader once; a changed document version, range, or index-state key calls it again; document/root invalidation removes matching entries; a rejected loader is not retained.

- [ ] **Step 5: Branch smart navigation by declaration kind**

In `NavigationEngine.definition`, after current-document local handling and Ready-root validation, call `getDeclarations(document, cancellation)` and match the descriptor whose token range equals `context.tokenRange`. Return `NONE` when no current-version descriptor matches. Then branch as follows:

```ts
if (context.role === 'declaration') {
  const descriptor = await this.#declarationAt(document, context.tokenRange, cancellation);
  if (!descriptor) return NONE;
  const bundle = await this.declarationRelations(document, descriptor, cancellation);
  const related = context.kind === 'method' || context.kind === 'constructor'
    ? bundle.callers
    : bundle.references;
  const candidates = this.#rank(context, related).filter((candidate) => candidate.tier <= 2);
  const targets = await this.#resolve(root.root, candidates);
  return targets.length ? { mode: 'peek', targets } : NONE;
}
```

Keep the existing invocation/reference implementation promotion unchanged.

- [ ] **Step 6: Expose relation resolution and invalidation for CodeLens**

Add a public `declarationRelations(document, descriptor, cancellation?)` method that validates the descriptor document version and Ready root, then reads through the cache and calls `graph.declarationRelations(root.root, descriptor, signal)`. Extend `RootResolution` with a required `indexKey` string; `ExtensionController.#resolveRoot` derives it from root state, project identity, and known revision, while tests use `Ready:project-id`. Add `invalidateDocument(uri)`, `invalidateRoot(root)`, and `dispose()` methods that clear cached bundles.

- [ ] **Step 7: Wire lifecycle invalidation**

In `ExtensionController`, retain the current engine, invalidate its document cache on `onDidChangeTextDocument` and `onDidCloseTextDocument`, invalidate a root before and after user-triggered indexing, and dispose it during runtime shutdown. Do not trigger indexing or show notifications from invalidation.

- [ ] **Step 8: Run focused and full unit tests**

Run: `npx vitest run src/navigation/declarationCache.test.ts src/navigation/engine.test.ts`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/navigation/declarationCache.ts src/navigation/declarationCache.test.ts src/navigation/engine.ts src/navigation/engine.test.ts src/extension.ts
git commit -m "Navigate declarations to usages"
```

### Task 4: Add lazy declaration CodeLens and native presentation

**Files:**
- Create: `src/codeLens.ts`
- Create: `src/codeLens.test.ts`
- Modify: `src/commands.ts`
- Modify: `src/providers.ts`
- Modify: `src/extension.ts`
- Modify: `src/test/integration/smoke.test.ts`

**Interfaces:**
- Consumes: `LanguageAdapter.getDeclarations`, `NavigationEngine.declarationRelations`, `NavigationOutcome`, and VS Code `CodeLensProvider`/commands.
- Produces: unresolved declaration lenses, lazy resolved relationship commands, and `cbmNavigator.openCodeLensTargets`.

- [ ] **Step 1: Add failing pure-model tests for CodeLens labels and modes**

Export a pure builder and assert exact lenses:

```ts
expect(buildDeclarationLenses(descriptor, bundle)).toEqual([
  expect.objectContaining({ kind: 'declaration', title: '↑ declaration', mode: 'direct' }),
  expect.objectContaining({ kind: 'callers', title: '2 callers', mode: 'peek' }),
]);
```

Cover `↓ 1 implementation`, `↓ 2 implementations`, `1 caller`, `N callers`, `1 reference`, `N references`, empty omission, and direct-versus-Peek policy.

- [ ] **Step 2: Run the CodeLens model test and verify the missing module failure**

Run: `npx vitest run src/codeLens.test.ts`

Expected: FAIL because `src/codeLens.ts` does not exist.

- [ ] **Step 3: Implement the pure CodeLens model**

Define:

```ts
export type DeclarationLensKind = 'declaration' | 'implementations' | 'callers' | 'references';
export interface DeclarationLensModel {
  readonly kind: DeclarationLensKind;
  readonly title: string;
  readonly mode: 'direct' | 'peek';
  readonly candidates: readonly NavigationCandidate[];
}
export function buildDeclarationLenses(
  descriptor: DeclarationDescriptor,
  bundle: DeclarationRelationBundle,
): DeclarationLensModel[];
```

Implement zero-result omission and singular/plural labels exactly as tested.

- [ ] **Step 4: Implement the lazy VS Code CodeLens provider**

`provideCodeLenses` calls only `getDeclarations` and returns unresolved placeholders for the applicable relationship kinds, anchored to exact declaration token ranges. `resolveCodeLens` calls `engine.declarationRelations` for the descriptor, selects the matching pure model by relationship kind, and attaches `COMMANDS.openCodeLensTargets` with source URI/position, mode, and normalized targets. A placeholder whose relationship is empty resolves without a command and is therefore not displayed. If the document version changed, cancellation occurred, the root is unready, or relation resolution fails from timeout/disconnect, return no command and emit no notification.

- [ ] **Step 5: Implement direct and Peek target presentation**

Register `cbmNavigator.openCodeLensTargets` as an internal command. For one `direct` target use `vscode.window.showTextDocument` with the target selection. For Peek convert targets to `vscode.Location[]` and execute:

```ts
await vscode.commands.executeCommand(
  'editor.action.peekLocations', sourceUri, sourcePosition, locations, 'peek',
);
```

Reject empty or malformed command arguments and any target outside the already resolved target list; do not re-query the graph on click.

- [ ] **Step 6: Register CodeLens with the existing Java selector**

Extend `registerNavigationProviders` to accept the registered Java adapter, register one CodeLens provider, subscribe its disposables, and return a `refreshCodeLenses(): void` handle. `ExtensionController` calls that handle after document edits and root reindex invalidation without adding a new setting or keybinding.

- [ ] **Step 7: Extend integration smoke coverage**

Assert activation registers `cbmNavigator.openCodeLensTargets`. Add an environment-variable-driven live declaration case using `vscode.executeCodeLensProvider`; require at least one resolved `callers` or `references` lens when all variables are supplied, otherwise skip. Persist no environment value in snapshots, logs, or artifacts.

- [ ] **Step 8: Run CodeLens, unit, type, and build checks**

Run: `npx vitest run src/codeLens.test.ts src/navigation/engine.test.ts src/commands.test.ts`

Expected: PASS.

Run: `npm test`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

Run: `npm run build`

Expected: PASS with `dist/extension.js`, `dist/parserWorker.js`, and `dist/tree-sitter-java.wasm` generated.

- [ ] **Step 9: Commit Task 4**

```bash
git add src/codeLens.ts src/codeLens.test.ts src/commands.ts src/providers.ts src/extension.ts src/test/integration/smoke.test.ts
git commit -m "Add declaration CodeLens navigation"
```

### Task 5: Package and verify release 0.1.4

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/manifest.test.ts`
- Add: `images/icon.png`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Generate: `cbm-vscode-navigator-0.1.4.vsix`

**Interfaces:**
- Consumes: completed declaration navigation and CodeLens behavior from Tasks 1-4.
- Produces: the installable 0.1.4 VSIX with the supplied logo and privacy-clean documentation/artifact contents.

- [ ] **Step 1: Add failing manifest tests for release identity and icon**

Extend the manifest test type and assert:

```ts
expect(manifest.version).toBe('0.1.4');
expect(manifest.icon).toBe('images/icon.png');
const icon = readFileSync(resolve(process.cwd(), manifest.icon));
expect(icon.subarray(1, 4).toString('ascii')).toBe('PNG');
expect(icon.readUInt32BE(16)).toBe(256);
expect(icon.readUInt32BE(20)).toBe(256);
```

- [ ] **Step 2: Run the manifest test and verify the 0.1.3/missing-icon failure**

Run: `npx vitest run src/manifest.test.ts`

Expected: FAIL because the manifest is still 0.1.3 and has no `icon` field.

- [ ] **Step 3: Update release metadata and documentation**

Set top-level `version` to `0.1.4` and `icon` to `images/icon.png` in `package.json`; update the root package version in `package-lock.json`. Add a 0.1.4 changelog section and update README behavior to distinguish invocation navigation from declaration-site callers/references and document CodeLens labels. Keep `.vscodeignore` unchanged because it does not exclude `images/**`.

- [ ] **Step 4: Run the complete deterministic verification suite**

Run: `npm test`

Expected: PASS with no unexpected skips in unit suites.

Run: `npm run check`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Run privacy scans before packaging**

Run separate searches over tracked/staged source and docs for generic absolute Windows user-path patterns and, when provided, patterns from an external untracked file referenced by `CBM_PRIVACY_PATTERN_FILE`. Each must return no matches. Also inspect `git diff --cached --name-only` so only intended generic files are staged. Never print matched private source contents; report only file names and counts.

- [ ] **Step 6: Package and inspect the VSIX**

Run: `npm run package`

Expected: creates `cbm-vscode-navigator-0.1.4.vsix`.

Run: `npx vsce ls --no-dependencies`

Expected: includes `images/icon.png`, `dist/extension.js`, `dist/parserWorker.js`, `dist/tree-sitter-java.wasm`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `package.json`; excludes `src/**`, `test-fixtures/**`, `docs/superpowers/**`, `package-lock.json`, and prior VSIX files.

- [ ] **Step 7: Inspect the packed artifact for privacy and release identity**

Extract the VSIX into a task-specific temporary directory, scan text entries for the same private identifiers and absolute paths, and inspect `extension/package.json` for version `0.1.4` and icon `images/icon.png`. Delete only that verified temporary directory after inspection.

- [ ] **Step 8: Run optional live integration without installing or reloading VS Code**

Run `npm run test:integration` only with the explicitly supplied environment variables. Expected: generic activation tests pass; live navigation/CodeLens tests pass when their variables are supplied and skip otherwise. Do not install the VSIX or open/reload a VS Code test window without the user's separate approval.

- [ ] **Step 9: Commit Task 5**

```bash
git add package.json package-lock.json src/manifest.test.ts images/icon.png README.md CHANGELOG.md
git commit -m "Release CBM Navigator 0.1.4"
```

- [ ] **Step 10: Report artifact identity**

Report the final commit list, test results, VSIX path, SHA-256 digest, included logo path, and whether optional live integration was run or skipped. Do not claim the extension was installed or manually tested unless the user separately authorized and the action actually occurred.
