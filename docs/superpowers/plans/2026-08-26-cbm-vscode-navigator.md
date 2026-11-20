# CBM Navigator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a packaged Java navigation extension for VS Code that uses a shared codebase-memory-mcp runtime for project semantics and local parsing for current-buffer context.

**Architecture:** Keep VS Code providers thin and place behavior behind language-neutral contracts. A root-scoped CBM manager owns long-lived MCP clients and index state; the navigation engine combines Java syntax context, normalized graph candidates, strict ranking, and safe location resolution.

**Tech Stack:** TypeScript 5, VS Code Extension API, Vitest, esbuild, web-tree-sitter, tree-sitter-java WASM, Model Context Protocol SDK.

**Spec:** `docs/superpowers/specs/2026-08-26-cbm-vscode-navigator-design.md`

## Global Constraints

- Minimum supported codebase-memory-mcp version: `0.10.8`.
- Initial language support is Java only, with no JDK/JRE/JVM launch or installation.
- No navigation request may implicitly install CBM, upgrade CBM, or start indexing.
- Every graph path must be canonicalized and contained by its authorized workspace root.
- A heuristic-only or unresolved result must never become a silent direct jump.
- Initial indexing defaults to CBM `fast` mode and requires explicit user confirmation.
- Multi-root workspaces use one long-lived root-scoped MCP frontend per authorized root.

---

### Task 1: Extension scaffold and public contracts

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.mjs`, `.vscodeignore`, `.gitignore`
- Create: `src/contracts.ts`, `src/extension.ts`
- Test: `src/contracts.test.ts`

**Interfaces:**
- Produces: `SymbolContext`, `NavigationCandidate`, `RankedCandidate`, `RootState`, `LanguageAdapter`, and extension activation entry points.

- [ ] **Step 1: Add a contract test** that imports the initial state factory and asserts an authorized trusted root begins in `Missing` without manufacturing a runtime.
- [ ] **Step 2: Run `npm test -- src/contracts.test.ts`** and confirm the import fails because the contract module does not exist.
- [ ] **Step 3: Add the TypeScript/Vitest/esbuild scaffold and minimal contracts**, including `createInitialRootState(root, trusted)` returning `Untrusted` or `Missing`.
- [ ] **Step 4: Run `npm test -- src/contracts.test.ts` and `npm run check`** and confirm both pass.

### Task 2: Runtime compatibility and executable discovery

**Files:**
- Create: `src/cbm/version.ts`, `src/cbm/runtimeDiscovery.ts`, `src/cbm/capabilities.ts`
- Test: `src/cbm/version.test.ts`, `src/cbm/runtimeDiscovery.test.ts`, `src/cbm/capabilities.test.ts`

**Interfaces:**
- Produces: `parseSemVer(text): SemVer | undefined`, `isSupportedVersion(version): boolean`, `discoverRuntime(options): Promise<RuntimeProbe>`, and `validateCapabilities(names): CapabilityResult`.

- [ ] **Step 1: Add failing table tests** for strict semantic-version parsing, the `0.10.8` floor, configured-path/PATH/default precedence, process timeouts, and the eight required MCP tools.
- [ ] **Step 2: Run `npm test -- src/cbm/version.test.ts src/cbm/runtimeDiscovery.test.ts src/cbm/capabilities.test.ts`** and confirm missing exports fail.
- [ ] **Step 3: Implement discovery with injected filesystem, environment, platform, and process runner dependencies**; launch executables with argument arrays only and reject malformed version output.
- [ ] **Step 4: Re-run the focused tests and `npm run check`**.

### Task 3: MCP transport, query safety, and root lifecycle

**Files:**
- Create: `src/cbm/mcpClient.ts`, `src/cbm/queryBuilder.ts`, `src/cbm/rootManager.ts`, `src/cbm/cache.ts`, `src/cbm/circuitBreaker.ts`
- Test: `src/cbm/queryBuilder.test.ts`, `src/cbm/rootManager.test.ts`, `src/cbm/cache.test.ts`, `src/cbm/circuitBreaker.test.ts`

**Interfaces:**
- Produces: `McpClient`, `McpClientFactory`, `RootManager`, `buildCandidateQuery(context)`, `SharedPromiseCache`, and `CircuitBreaker`.

- [ ] **Step 1: Add failing tests** proving Cypher literals escape backslashes/quotes, write clauses are impossible, `CBM_ALLOWED_ROOT` is set per session, indexing is never implicit, identical in-flight requests are shared, stale cursors restart once, and repeated failures open the breaker.
- [ ] **Step 2: Run the focused tests** and verify they fail on missing implementations.
- [ ] **Step 3: Implement a restricted query builder and root manager** over long-lived stdio JSON-RPC MCP sessions, with bounded request timeouts and cancellation.
- [ ] **Step 4: Re-run focused tests and `npm run check`**.

### Task 4: Candidate ranking and safe location resolution

**Files:**
- Create: `src/navigation/ranker.ts`, `src/navigation/locationResolver.ts`, `src/navigation/results.ts`
- Test: `src/navigation/ranker.test.ts`, `src/navigation/locationResolver.test.ts`, `src/navigation/results.test.ts`

**Interfaces:**
- Produces: `rankCandidates(context, candidates, policy): RankedCandidate[]`, `resolveCandidate(root, candidate): Promise<LocationTarget | undefined>`, and `normalizeLocations(targets)`.

- [ ] **Step 1: Add failing tests** for hard rejection, the `0.85` direct-jump floor, unique/direct vs multiple/Peek behavior, heuristic suppression, canonical containment, stale-line token recovery, sorting, and deduplication.
- [ ] **Step 2: Run the focused tests** and verify expected missing-module failures.
- [ ] **Step 3: Implement filtering before scoring**, canonical path checks using `realpath`, narrow token validation, exact qualified-name recovery, and deterministic result normalization.
- [ ] **Step 4: Re-run focused tests and `npm run check`**.

### Task 5: Java current-buffer syntax adapter

**Files:**
- Create: `src/languages/registry.ts`, `src/languages/java/adapter.ts`, `src/languages/java/parserWorker.ts`, `src/languages/java/parserProtocol.ts`
- Create: `src/languages/java/tree-sitter-java.wasm` (copied from the pinned package during build)
- Test: `src/languages/java/adapter.test.ts`, `examples/java/**`

**Interfaces:**
- Produces: `JavaSyntaxAdapter.getSymbolContext(document, position, token)` and `disposeDocument(uri)`.

- [ ] **Step 1: Add failing fixture tests** for declarations, parameters/locals, calls sharing a line, receiver and arity hints, records/enums/nested types, unsaved versions, incomplete syntax, and tree disposal.
- [ ] **Step 2: Run the adapter tests** and confirm the adapter module is missing.
- [ ] **Step 3: Implement Worker-based Tree-sitter parsing with document URI/version keys**, incremental edit messages, stale-response rejection, and tolerant error-subtree behavior.
- [ ] **Step 4: Re-run adapter tests, memory lifecycle tests, and `npm run check`**.

### Task 6: Navigation engine and VS Code providers

**Files:**
- Create: `src/navigation/engine.ts`, `src/providers.ts`, `src/commands.ts`, `src/status.ts`
- Modify: `src/extension.ts`, `package.json`
- Test: `src/navigation/engine.test.ts`, `src/providers.test.ts`, `src/commands.test.ts`

**Interfaces:**
- Produces: `NavigationEngine.definition`, `.declaration`, `.implementations`, `.references`; provider registrations; setup/index/refresh/status/log/retry/declaration/keymap commands.

- [ ] **Step 1: Add failing tests** for unsaved local resolution, unique implementation promotion, multi-target Peek results, declaration fallback, verified references only, cancellation, trust gating, and IDEA-keymap configuration updates.
- [ ] **Step 2: Run the focused tests** and confirm missing engine/provider exports fail.
- [ ] **Step 3: Implement thin providers and the orchestration engine**, propagating cancellation and returning no unsafe target.
- [ ] **Step 4: Add all commands, settings, menus, keybindings, activation events, and status states to `package.json`**, then run focused tests and `npm run check`.

### Task 7: Consent-based installer and index operations

**Files:**
- Create: `src/cbm/release.ts`, `src/cbm/installer.ts`, `src/cbm/indexLifecycle.ts`, `src/logging.ts`
- Test: `src/cbm/release.test.ts`, `src/cbm/installer.test.ts`, `src/cbm/indexLifecycle.test.ts`, `src/logging.test.ts`

**Interfaces:**
- Produces: release asset selection/checksum verification, dry-run/confirmation/install workflow, explicit fast indexing, debounced status refresh, and redacted diagnostics.

- [ ] **Step 1: Add failing tests** for OS/architecture asset matching, SHA-256 mismatch, redirect-origin rejection, cancellation before activation, dry-run before final confirmation, explicit `fast` indexing, and secret/path redaction.
- [ ] **Step 2: Run the focused tests** and confirm missing implementations fail.
- [ ] **Step 3: Implement injected download/process/confirmation boundaries** using owner-private temporary directories and the official installer command; never mutate PATH or execute remote shell text directly.
- [ ] **Step 4: Re-run focused tests and `npm run check`**.

### Task 8: Integration harness, packaging, and documentation

**Files:**
- Create: `examples/java/**`, `src/test/integration/**`, `README.md`, `CHANGELOG.md`, `LICENSE`
- Modify: `package.json`, `esbuild.mjs`, `.vscodeignore`

**Interfaces:**
- Produces: packaged `.vsix`, generic CBM fixture contract tests, and user-facing setup/privacy/troubleshooting documentation.

- [ ] **Step 1: Add an integration smoke test** that activates the extension in a trusted Java fixture workspace and verifies provider registration without a JDK.
- [ ] **Step 2: Run the integration test** and confirm it fails before the harness/bundle exists.
- [ ] **Step 3: Add the VS Code test harness, generic CBM fixture repository, packaging scripts, and documentation**; contract tests must skip with an explicit reason when a supported external CBM binary is unavailable.
- [ ] **Step 4: Run `npm test`, `npm run check`, `npm run build`, and `npm run package`**; inspect the VSIX contents to ensure source fixtures, secrets, and developer caches are absent.
