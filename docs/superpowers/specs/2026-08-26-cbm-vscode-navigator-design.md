# CBM Navigator for VS Code — Design Specification

- Date: 2026-08-26
- Status: Approved for implementation planning
- Working product name: CBM Navigator
- Initial language support: Java
- Minimum supported codebase-memory-mcp version: 0.10.8

## 1. Summary

CBM Navigator is a lightweight VS Code navigation extension designed for developers who use code agents and primarily need to review code quickly. It uses codebase-memory-mcp (CBM) as the cross-file semantic graph and a small in-process Java syntax adapter for precise cursor interpretation.

The extension focuses on high-confidence navigation rather than full IDE functionality. Its primary interaction is smart `Ctrl+Click`/`F12`: a unique concrete implementation opens directly, multiple implementations open in Peek, and a symbol with no implementation falls back to its declaration.

The extension is project-agnostic. It contains no repository names, module names, or hard-coded project paths. Index discovery and navigation respect the files and directories excluded by CBM, Git, the project, and the user.

## 2. Goals

The first release shall:

1. Make project-source navigation convenient during code review.
2. Provide smart definition, declaration, implementation, and reference navigation for Java.
3. Avoid starting a JVM solely for navigation.
4. Share the installed CBM runtime and graph with code agents.
5. Detect, install, upgrade, validate, and connect to CBM with explicit user consent for system changes.
6. Work without a JDK or JRE while allowing future features to add runtime dependencies if justified.
7. Prefer no result or an explicit candidate list over an incorrect silent jump.
8. Keep the navigation core language-independent so later language adapters do not require a redesign.

## 3. Non-goals

The first release will not provide:

- completion;
- compilation diagnostics;
- refactoring;
- formatting;
- debugging or test execution;
- Maven or Gradle dependency-source navigation;
- JDK source navigation;
- a temporary global graph spanning multiple unsaved files;
- language adapters other than Java;
- JDK/JRE discovery, installation, or version management;
- an independent language server or LSP facade.

## 4. Product principles

### 4.1 Review-first behavior

Navigation latency, predictability, and the ability to return to the prior location matter more than completeness. The extension must never turn a low-confidence short-name match into an unannounced direct jump.

### 4.2 Local syntax, shared semantics

The Java syntax adapter interprets the current editor buffer. CBM owns cross-file symbol relationships and the persisted knowledge graph. The extension will not duplicate CBM's repository indexing or maintain another project database.

### 4.3 Explicit system changes

Installation, upgrade, initial indexing, and any operation that modifies shared configuration require user confirmation. Background status checks may update UI state but may not install or upgrade software.

### 4.4 Generic project handling

The extension relies on CBM's built-in exclusions, `.gitignore`, nested `.gitignore`, `.cbmignore`, global Git exclusions, and existing CBM configuration. It does not contain project-specific exclusion logic.

## 5. User experience

### 5.1 Default navigation

| Interaction | Behavior |
|---|---|
| `Ctrl+Click` or `F12` | Smart navigation |
| `Ctrl+F12` | Show implementations |
| `Shift+F12` | Show references |
| `Alt+Left` | Use VS Code's native navigation history |
| Force declaration | Context menu and Command Palette |

Smart navigation behaves as follows:

1. A local declaration in the current document is resolved from the current editor buffer.
2. On a method or constructor invocation, one reliable concrete implementation opens directly, multiple reliable implementations open in Peek, and no implementation falls back to the declaration.
3. On a method or constructor declaration, including an interface/base declaration or a concrete implementation, navigation finds callers of the complete logical member family and displays them in Peek.
4. On a type or field declaration, navigation finds verified references and displays them in Peek.
5. Interface/base declarations and their implementations are normalized to the same logical family before callers are collected; declarations and overrides are excluded from caller results.
6. A non-invocation reference opens the highest-confidence project definition, subject to the implementation-promotion rule in item 2 when applicable.
7. Ambiguous or heuristic-only results appear as candidates instead of being selected silently.
8. No result is returned when the extension cannot establish a safe target.

Declaration CodeLens augments smart navigation without changing the default keymap. Method and constructor declarations show caller counts; type and field declarations show reference counts; implementations and overrides show an upward declaration link; and interface/base declarations show a downward implementation link. CodeLens actions use direct navigation only for a unique declaration or implementation target. Multiple targets and all caller/reference results open in Peek. Empty, timed-out, or unavailable relationships produce no CodeLens rather than a notification.

### 5.2 Optional IDEA keymap

The default keymap follows VS Code. The extension contributes an optional IDEA-style keymap enabled by a command and a configuration value. It does not rewrite `keybindings.json`.

When IDEA mode is enabled for Java editors:

| Interaction | Behavior |
|---|---|
| `Ctrl+Click` or `Ctrl+B` | Smart navigation |
| `Ctrl+Alt+B` | Show implementations |
| `Alt+F7` | Show references |

Commands enable and disable IDEA mode. Disabling it restores the original VS Code bindings because the contributed bindings are guarded by a configuration-based `when` clause.

### 5.3 Status UI

The status bar exposes a single compact CBM state:

| State | Primary action |
|---|---|
| `CBM: Install` | Open installation confirmation |
| `CBM: Upgrade` | Open upgrade explanation |
| `CBM: Index` | Confirm initial indexing |
| `CBM: Indexing…` | Show progress and logs |
| `CBM: Ready` | Show runtime and project status |
| `CBM: Stale` | Refresh the current workspace index |
| `CBM: Error` | Open diagnostics and recovery actions |

Ordinary navigation failures do not generate pop-up notifications. Notifications are reserved for first-time setup, unsupported versions, user-initiated indexing, and operations requiring permission.

## 6. Architecture

```text
VS Code
├── Navigation Providers
│   ├── Smart Definition
│   ├── Declaration
│   ├── Implementation
│   └── References
│
├── Navigation Engine
│   ├── Symbol Context
│   ├── Graph Query Adapter
│   ├── Candidate Ranker
│   └── Location Resolver
│
├── Language Adapter Registry
│   └── JavaSyntaxAdapter
│       └── Tree-sitter Java WASM Worker
│
└── CBM Manager
    ├── Discovery and Compatibility
    ├── Installer and Upgrader
    ├── Root-scoped MCP Sessions
    ├── Index Lifecycle
    └── Status and Diagnostics
             │
             ▼
      CBM shared daemon and graphs
             ▲
             │
         Code agents
```

### 6.1 Component responsibilities

#### Navigation Providers

Thin adapters over VS Code's `DefinitionProvider`, `DeclarationProvider`, `ImplementationProvider`, and `ReferenceProvider`. Providers forward cancellation tokens and do not contain Java or CBM query rules.

#### Navigation Engine

Language-independent orchestration. It accepts a normalized symbol context, requests graph candidates, applies confidence policy, and returns zero, one, or multiple navigation targets.

#### Language Adapter Registry

Selects an adapter for the current VS Code language identifier. Only `java` is registered in the first release. New languages add adapters without modifying the Navigation Engine.

#### JavaSyntaxAdapter

Parses the current document with Tree-sitter Java compiled to WASM. It identifies the selected token, syntactic role, receiver expression, enclosing type and callable, imports, argument count, local declarations, and source range. It does not perform repository indexing or invoke a JDK.

#### Graph Query Adapter

Encapsulates all CBM tool calls and query construction. It prefers structured tools and contains the only implementation allowed to construct read-only Cypher queries.

#### Candidate Ranker

Applies hard validity filters and confidence tiers. It never converts heuristic-only candidates into direct navigation targets.

#### Location Resolver

Converts repository-relative CBM paths and line ranges to VS Code `Location` or `LocationLink` values. Because CBM graph locations are line-based, it validates the target file and locates the symbol token within the target range.

#### CBM Manager

Owns runtime discovery, version and capability validation, installation and upgrade flows, root-scoped MCP frontends, indexing, status, and diagnostics. One manager may own several MCP stdio sessions in a multi-root workspace; those sessions share CBM's account daemon and cache.

## 7. Core data contracts

The language adapter produces a normalized symbol context equivalent to:

```ts
interface SymbolContext {
  documentUri: string;
  documentVersion: number;
  languageId: string;
  position: { line: number; character: number };
  tokenRange: Range;
  name: string;
  kind: "type" | "method" | "constructor" | "field" | "local" | "parameter" | "unknown";
  role: "declaration" | "reference" | "invocation" | "typeReference";
  receiverText?: string;
  receiverTypeHint?: string;
  argumentCount?: number;
  signatureHint?: string;
  enclosingType?: string;
  enclosingCallable?: string;
  packageName?: string;
  imports: ImportHint[];
}
```

Graph results are normalized before ranking:

```ts
interface NavigationCandidate {
  kind: string;
  qualifiedName: string;
  relationship: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature?: string;
  receiverType?: string;
  confidence?: number;
  strategy?: "lsp" | "language_rule" | "heuristic" | "unresolved";
  sourceScope?: string;
  evidence: string[];
}
```

CBM-specific shapes do not escape the Graph Query Adapter. This prevents future CBM response changes from affecting the rest of the extension.

## 8. CBM integration

### 8.1 Required capabilities

The minimum supported CBM version is 0.10.8. Before enabling navigation, the extension performs both a semantic-version check and MCP capability discovery.

The first release requires these tools:

- `index_repository`;
- `list_projects`;
- `index_status`;
- `check_index_coverage`;
- `search_graph`;
- `query_graph`;
- `trace_path`;
- `get_graph_schema`.

A future version greater than 0.10.8 is accepted when the required capabilities and response fields are compatible. There is no arbitrary maximum version. Missing required capabilities produce an unsupported-runtime state rather than runtime query failures.

### 8.2 Runtime discovery

The executable search order is:

1. `cbmNavigator.executablePath`;
2. the process `PATH`;
3. official default installation locations for the current platform.

The extension does not scan arbitrary drives or home directories. It invokes `--version` with a short timeout and parses a strict semantic version.

CBM below 0.10.8 disables navigation. The user receives actions to upgrade, select another executable, or postpone. Postponement suppresses repeated notifications but leaves the `CBM: Upgrade` status visible.

### 8.3 Shared installation and upgrade

Installation and upgrade use official CBM release assets and the shared native installation model so VS Code and code agents use the same runtime and graph cache.

The flow is:

1. Retrieve stable release metadata from the configured official release source.
2. Select the archive for the current OS and architecture.
3. Download the archive and official checksum manifest to an owner-private temporary directory.
4. Verify SHA-256 before extraction or execution.
5. Run the candidate's `install --dry-run` and present the affected executable, PATH, and detected agent/editor configurations.
6. Obtain final user confirmation.
7. Invoke the official shared installer.
8. Verify the installed version, complete an MCP handshake, and validate required capabilities.
9. Reconnect extension-owned MCP sessions.

The extension never pipes a remote script directly into a shell, permanently changes PowerShell execution policy, or silently upgrades CBM.

Before an upgrade, the UI states that CBM will coordinate and temporarily disconnect active sessions and that other code-agent sessions may require a restart. The extension closes and reconnects its own frontend but does not kill or restart other agents.

Installation output is written to a dedicated Output Channel with sensitive values removed. Official staging and activation semantics provide rollback safety; the extension does not overwrite the active binary itself.

### 8.4 MCP session model

For a single-root workspace, the manager starts one stdio MCP frontend. For a multi-root workspace, it starts one root-scoped frontend per authorized root. All frontends use the same supported CBM build and cache root and therefore share the account daemon.

Each session sets `CBM_ALLOWED_ROOT` to its canonical workspace root. Index requests and returned target paths are validated against the same root. Session processes are long-lived; a navigation action never starts a new CBM process.

### 8.5 Initial indexing

The extension does not enable global `auto_index`. When an authorized workspace root lacks an index, it presents the canonical root, default `fast` mode, exclusion behavior, and explicit Start/Not Now actions.

After confirmation, it calls `index_repository` for that root. `fast` is the default because every CBM indexing mode performs type-aware resolution, while similarity and semantic-search edges are not required for source navigation.

Project identity is matched by canonical root path rather than folder name alone. Multi-root projects are authorized and indexed independently.

### 8.6 Exclusions and coverage

The extension delegates file discovery to CBM and respects:

- CBM's non-negotiable safety exclusions;
- built-in discovery exclusions;
- repository and nested `.gitignore` files;
- `.cbmignore`;
- Git global exclusions;
- existing user CBM configuration.

It does not duplicate these rules in Java code or add repository-specific exceptions. `check_index_coverage` is used when a navigation target's coverage is uncertain.

### 8.7 Incremental updates

After initial indexing, the extension respects the existing `auto_watch` setting. If enabled, the shared daemon maintains saved filesystem changes. If disabled, the status UI exposes a manual refresh command.

Unsaved content is visible only to the current-document Java adapter. The extension does not write unsaved buffers to disk or CBM. Saving a document does not trigger a competing full index operation; the extension waits for the watcher and refreshes status with debouncing.

## 9. Java syntax adapter

### 9.1 Runtime

The adapter uses TypeScript and a bundled Tree-sitter Java WASM grammar executed in a Worker. It does not require or launch a JDK, JRE, `javac`, Maven, or Gradle.

The design permits a future `RuntimeDependencyManager` if a later, separately approved feature truly requires Java. No JDK/JRE installation code is included in the first release.

### 9.2 Responsibilities

For the current document, the adapter extracts:

- the token and exact character range at the cursor;
- declaration versus reference versus invocation role;
- local variables, parameters, and local declarations;
- class, interface, enum, record, method, constructor, and field declarations;
- package and import hints;
- enclosing type and callable;
- receiver expression and simple receiver-type hints;
- argument count and syntactic signature hints;
- complete call-expression ranges, including multiple calls on one line.

The parser must tolerate incomplete code and syntax errors. A damaged subtree may produce no context, but it must not block the Extension Host or reuse a context from an older document version.

### 9.3 Caching

Parse trees are cached by document URI and VS Code document version. Edits are applied incrementally in the Worker. Closing a document releases its tree. Memory tests verify that repeatedly opening and closing documents does not retain parse trees.

## 10. Navigation algorithms

### 10.1 Smart navigation

1. Obtain a current `SymbolContext` from the language adapter.
2. Resolve local and parameter declarations entirely within the current buffer.
3. Identify the canonical workspace root and ready CBM project.
4. When the selected token is a method or constructor declaration, normalize its interface/base declaration and compatible implementations into one logical family, collect verified callers across that family, exclude declaration/override locations, and return the callers for Peek presentation.
5. When the selected token is a type or field declaration, collect and return verified references for Peek presentation.
6. Otherwise query exact project candidates using package, import, enclosing callable, receiver, name, arity, and signature evidence.
7. For a concrete reference, rank and return the safe target.
8. For an invocation resolved through an interface or abstract declaration, find concrete subtype relationships and match member signatures.
9. Return a unique tier-one implementation directly, multiple tier-one/tier-two implementations as Peek targets, or the declaration when no implementation exists.
10. Return no target when only unsafe candidates remain.

### 10.2 Method invocation

The adapter identifies the exact invocation selected by the cursor. The graph query uses the enclosing callable, CBM call-edge line, callee name, receiver hint, arity, and signature. This disambiguates multiple calls on the same line when CBM exposes only a line number.

If two candidates remain indistinguishable, both are shown. The extension never resolves such a tie by result ordering.

### 10.3 Implementations

The Implementation Provider returns all verified concrete implementations. Type implementations use `IMPLEMENTS` and `INHERITS` relationships as exposed by the schema. Method implementations combine the owning-type relationship with exact or compatible member signatures; a same-named method alone is insufficient.

### 10.4 References

References combine verified occurrences derived from:

- `CALLS`;
- `CALL_REFERENCE`;
- `USAGE` when the usage can be validated;
- `IMPLEMENTS` and `INHERITS` for type relationships.

An occurrence with an explicit line is converted directly after source validation. When an edge lacks occurrence-level location, the extension parses the containing source range and emits only tokens whose syntactic role matches the requested symbol. Unverifiable approximate references are omitted because VS Code reference results cannot communicate uncertainty clearly.

Results are normalized, sorted by URI and range, and deduplicated.

### 10.5 Force declaration

The Declaration Provider bypasses implementation promotion and returns only the exact declaration candidates. It is exposed through the context menu and Command Palette in the default keymap.

### 10.6 Location resolution

Every CBM result passes these checks:

1. Canonicalize the path without trusting textual path prefixes.
2. Verify that it belongs to the authorized workspace root.
3. Verify that the file exists and is readable.
4. Clamp and validate the reported line range.
5. Parse or scan the narrow target range for the declared symbol token.
6. Return a `LocationLink` with a precise selection range when possible.

If the reported line is stale, the resolver may search the declared node range or current target file for the exact qualified declaration. It may not broaden that recovery into an unqualified workspace-wide text jump.

## 11. Candidate policy

Hard filters run before ranking:

- authorized workspace root;
- existing target file;
- indexed and non-excluded target;
- compatible symbol kind;
- compatible name and callable arity;
- non-conflicting package, import, receiver, and signature evidence;
- concrete target when implementation navigation is requested.

Remaining candidates are placed into confidence tiers:

### Tier 1 — direct semantic match

Exact receiver or owning type, compatible signature, direct semantic relationship, and confidence at or above `cbmNavigator.minimumDirectJumpConfidence` (default `0.85`). A unique tier-one result may open directly.

### Tier 2 — valid structural alternative

A compatible inheritance/member relationship or several equally valid implementations without enough evidence for a unique target. Tier-two results open in Peek.

### Tier 3 — heuristic candidate

Name or structural evidence exists, but receiver, signature, or strategy remains uncertain. These results may appear in an explicitly marked candidate UI but never open directly.

### Rejected

Unresolved edges, inaccessible paths, incompatible scopes, missing files, and candidates excluded by project indexing rules are not returned.

Source-scope metadata such as test status may influence ordering, but no directory spelling is hard-coded and it does not override stronger semantic evidence.

## 12. Concurrency, freshness, and cancellation

- All provider operations accept and propagate VS Code cancellation tokens.
- Local parsing runs in a Worker and is keyed to the current document version.
- Graph requests carry a bounded timeout.
- Results are cached only against document version, workspace root, query identity, and known index revision/status.
- A reindex invalidates graph-query caches and pagination cursors.
- A stale cursor causes the original query to restart once.
- Save notifications and index-status checks are debounced.
- Concurrent identical navigation queries share one in-flight promise.
- No navigation request starts an index implicitly.

## 13. State machine and recovery

The root-level runtime state is one of:

```text
Untrusted
Missing
Unsupported
ReadyWithoutIndex
Indexing
Ready
Stale
Degraded
Error
```

Transitions are driven by workspace trust, executable discovery, version and capability probes, user-approved installation, project discovery, index status, watcher state, and MCP health.

Recovery policy:

| Failure | Behavior |
|---|---|
| Navigation timeout | Cancel this action without blocking VS Code |
| MCP frontend disconnect | Reconnect once, then enter Degraded/Error |
| Shared daemon unavailable | Expose Retry; do not create a restart loop |
| Index in progress | Wait a short grace interval, then ask the user to retry |
| Stale pagination cursor | Restart the original query once |
| Deleted or moved target | Drop it and refresh project status |
| Stale line range | Attempt exact qualified declaration recovery in the target file |
| Multiple equal targets | Show Peek |
| Heuristic-only target | Show an uncertain candidate or no result |
| Unsupported CBM | Disable navigation and offer upgrade |

Repeated failures open a short circuit breaker so repeated clicks do not spawn processes or notifications. Recovery restarts only extension-owned frontends, never unrelated code agents.

## 14. Security and privacy

### 14.1 Workspace trust

In an untrusted workspace, the extension does not:

- start CBM;
- download or execute installers;
- index files;
- query source graphs;
- navigate to graph paths.

The status bar explains that workspace trust is required.

### 14.2 Process safety

Processes are launched with an executable path and argument array, never a concatenated shell command. Executable paths, downloaded archives, temporary directories, and returned source paths are canonicalized and validated.

### 14.3 Query safety

Structured MCP tools are preferred. `query_graph` is accessed only through a tested Query Builder that escapes all external strings and emits a restricted read-only subset. The extension never accesses CBM SQLite files directly or accepts graph paths as command invocations.

### 14.4 Installation trust

The default release source is the official CBM GitHub repository. Release assets are checksum-verified before execution. Redirects and final origins are validated. User cancellation at any stage before activation leaves the shared installation unchanged.

### 14.5 Privacy

Source, symbols, graph data, and navigation queries remain local. Default network access is limited to user-approved downloads and low-frequency version metadata checks. Metadata checks can be disabled. Logs remove secrets, authentication material, environment values, and unrelated filesystem paths.

## 15. Commands and configuration

Initial commands:

- `CBM Navigator: Set Up CBM`
- `CBM Navigator: Upgrade CBM`
- `CBM Navigator: Select CBM Executable`
- `CBM Navigator: Index Current Workspace`
- `CBM Navigator: Refresh Current Workspace Index`
- `CBM Navigator: Show Status`
- `CBM Navigator: Show Logs`
- `CBM Navigator: Retry Connection`
- `CBM Navigator: Go to Declaration`
- `CBM Navigator: Enable IDEA Keymap`
- `CBM Navigator: Disable IDEA Keymap`

Initial settings:

| Setting | Default | Meaning |
|---|---:|---|
| `cbmNavigator.executablePath` | empty | Explicit CBM executable path |
| `cbmNavigator.minimumDirectJumpConfidence` | `0.85` | Minimum confidence for silent direct navigation |
| `cbmNavigator.queryTimeoutMs` | `2000` | Graph request timeout |
| `cbmNavigator.updateCheck.enabled` | `true` | Enable low-frequency release metadata checks |
| `cbmNavigator.keymap` | `vscode` | `vscode` or `idea` |

The minimum supported CBM version is an extension compatibility constant, not a user setting. Users cannot bypass it in the first release.

## 16. Testing strategy

### 16.1 Unit tests

- semantic-version parsing and minimum-version enforcement;
- runtime/capability state transitions;
- candidate hard filters and tiers;
- path normalization and root containment;
- query escaping;
- release asset and checksum selection;
- keymap configuration;
- cache invalidation and circuit breaker behavior.

### 16.2 Java adapter tests

Fixtures cover:

- types, interfaces, fields, methods, and constructors;
- overloads, generics, inheritance, and static imports;
- lambdas, method references, anonymous and nested classes;
- records and enums;
- chained calls and multiple calls on one line;
- different receiver types with the same member name;
- unsaved additions, removals, renames, and incomplete syntax.

### 16.3 CBM contract tests

Tests use a real supported CBM binary and isolated, generic fixture repositories. They validate:

- definition, implementation, call, reference, and usage relationships;
- qualified names, signatures, lines, strategies, and confidence fields;
- index status and coverage;
- watcher updates;
- queries during reindexing;
- stale cursor behavior;
- required-tool capability negotiation.

### 16.4 VS Code integration tests

VS Code Extension Test covers:

- smart click/F12 navigation;
- direct unique implementation;
- Peek for multiple implementations;
- declaration-site callers and type/field references in Peek;
- CodeLens declaration, implementation, caller, and reference actions;
- declaration, implementation, references, and return navigation;
- multi-root workspaces;
- untrusted workspaces;
- cancellation and editor disposal;
- default and optional IDEA keymaps.

### 16.5 Installer tests

Automated tests use isolated install roots and mocked release endpoints. They cover missing, old, supported, corrupt, and protocol-incompatible runtimes; OS and architecture asset selection; checksum failures; dry-run display; cancellation; failed activation; and post-upgrade validation.

Real shared installation is limited to release smoke tests and must not modify a developer's normal PATH or agent configuration during ordinary test runs.

## 17. Performance targets

For an already indexed workspace:

- activation does not wait for network access or indexing;
- current-document parsing runs off the Extension Host thread;
- warm navigation P95 is below 250 ms;
- first navigation after a cold extension start is below 1.5 seconds, excluding initial indexing;
- extension-side work stops within 100 ms of cancellation;
- navigation never spawns a per-click CBM process;
- a 30-minute repeated-navigation test shows no sustained memory growth;
- combined idle incremental memory for the extension and CBM targets at most 120 MB;
- indexing peak memory is recorded separately from idle memory.

Performance targets may not be met by lowering semantic confidence or enabling unsafe direct jumps.

## 18. Acceptance criteria

The first release is acceptable when:

1. Core deterministic fixtures contain zero incorrect silent direct jumps.
2. Unique implementation, normal method call, type definition, field definition, declaration, and reference scenarios pass.
3. Ambiguous results reliably open Peek or return no result.
4. Files excluded by project/CBM discovery rules never appear as navigation targets.
5. Current-document local navigation reflects unsaved content.
6. Every returned path belongs to an authorized workspace root.
7. CBM below 0.10.8 disables navigation and offers an upgrade path.
8. Missing CBM offers a consent-based verified shared installation.
9. The extension operates without a JDK/JRE and never launches a JVM.
10. Default and IDEA-style navigation interactions work without permanently rewriting user keybindings.
11. Contract, integration, security, and performance test gates pass on supported platforms.

Reference results may be incomplete where CBM lacks semantic coverage, but uncertain occurrences must not be represented as verified references.

## 19. First-release deliverables

- VS Code extension scaffold and packaging;
- CBM discovery, compatibility, installation, upgrade, and diagnostics;
- root-scoped MCP client management;
- explicit initial indexing and watcher integration;
- Tree-sitter Java WASM Worker and Java syntax adapter;
- smart definition, declaration, implementation, and reference providers;
- candidate ranking, Peek behavior, and precise location resolution;
- default VS Code and optional IDEA keymaps;
- unit, CBM contract, VS Code integration, installer, security, and performance tests;
- user documentation for setup, navigation, privacy, troubleshooting, and known limitations.

## 20. Future evolution

Future work may add other language adapters, upstream a position-aware CBM tool, support dependency-source indexes, or introduce optional runtime-managed features. Each addition requires a separate design decision and must preserve the rule that uncertain semantic results are not silently promoted to direct navigation.
