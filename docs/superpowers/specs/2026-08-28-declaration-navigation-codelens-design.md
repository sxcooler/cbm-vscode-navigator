# Declaration Navigation and CodeLens Design

- Date: 2026-08-28
- Status: Approved for written-spec review
- Target release: 0.1.4
- Parent design: `docs/superpowers/specs/2026-08-26-cbm-vscode-navigator-design.md`

## 1. Purpose

CBM Navigator 0.1.4 will make declaration-site navigation match code-review intent. `Ctrl+Click`/`F12` on a method or constructor declaration will find callers, regardless of whether the selected declaration is an interface/base member or an implementation. Type and field declarations will find references. Invocation-site behavior remains implementation-oriented: one reliable concrete implementation opens directly, multiple implementations open in Peek, and no implementation falls back to the declaration.

The release also adds CodeLens links above Java declarations so definition/implementation relationships and usage counts remain visible and directly actionable. The feature remains project-agnostic and must not contain names, paths, symbols, or fixture data from private workspaces.

## 2. Interaction model

### 2.1 Smart `Ctrl+Click` and `F12`

| Cursor context | Result |
|---|---|
| Local variable or parameter reference | Resolve from the current editor document with Tree-sitter |
| Method/constructor invocation with one reliable concrete implementation | Open the implementation directly |
| Method/constructor invocation with multiple reliable implementations | Open implementations in Peek |
| Method/constructor invocation with no implementation | Open the declaration |
| Method/constructor declaration or implementation | Open callers of the logical member family in Peek |
| Type or field declaration | Open verified references in Peek |
| Other type, method, constructor, or field reference | Open the highest-confidence definition |
| Unsafe or heuristic-only match | Show explicit candidates or return no result; never jump silently |

An interface/base method and every compatible override belong to one logical member family. Caller collection unions verified calls to all family members, deduplicates locations, and excludes the family declarations and override declarations themselves. Caller and reference navigation always uses Peek, including a single result, because the user's intent is to inspect usage rather than replace the current editor location.

### 2.2 CodeLens

The Java CodeLens provider exposes only relationships with a non-empty verified result:

| Declaration kind | CodeLens |
|---|---|
| Concrete implementation or override | `↑ declaration` |
| Interface/base type or member with implementations | `↓ N implementations` |
| Method or constructor | `N callers` |
| Type or field | `N references` |

`↑ declaration` opens a unique declaration directly and uses Peek when more than one safe declaration remains. `↓ N implementations` opens a unique implementation directly and uses Peek for multiple implementations. Caller and reference lenses always use Peek. No additional extension setting is added; users control visibility with VS Code's standard `editor.codeLens` setting.

The extension does not add clickable gutter icons. VS Code gutter decorations do not provide a command binding, while CodeLens provides a native command surface and count text.

## 3. Architecture

### 3.1 Declaration enumeration

`JavaSyntaxAdapter` gains a document-declaration enumeration API. The Tree-sitter worker returns compact declaration descriptors containing:

- symbol name and kind;
- exact token range and declaration range;
- owning type and enclosing callable;
- parameter arity and available signature hints;
- declaration modifiers and syntactic evidence needed to distinguish interface/base members, abstract members, concrete implementations, and overrides.

The worker remains the sole owner of Tree-sitter state. Enumeration is keyed by document URI and document version, tolerates incomplete syntax, and never returns data parsed from an older document version.

### 3.2 Logical relation bundle

`GraphNavigator` adds one declaration-relation operation that returns a normalized bundle:

```ts
interface DeclarationRelationBundle {
  selected: DeclarationDescriptor;
  family: NavigationCandidate[];
  declarations: NavigationCandidate[];
  implementations: NavigationCandidate[];
  callers: NavigationCandidate[];
  references: NavigationCandidate[];
}
```

The graph adapter first resolves the selected declaration to exact graph nodes using root, package, owner, name, kind, signature, and arity evidence. It then expands compatible inheritance/implementation relationships to form the logical family. Callers are collected across that family using verified `CALLS` and `CALL_REFERENCE` occurrences. References use the existing verified `USAGE`, `IMPLEMENTS`, and `INHERITS` handling where appropriate. Same-name members with incompatible owners, arity, or signatures are rejected.

CBM response shapes remain contained inside the graph adapter. The navigation engine consumes only normalized candidates and relation bundles.

### 3.3 Navigation engine branch

Before the existing definition algorithm promotes implementations, the engine checks the syntax role:

1. Resolve locals and parameters in the current document.
2. If the role is a method/constructor declaration, request the logical relation bundle and return callers as Peek targets.
3. If the role is a type/field declaration, return verified references as Peek targets.
4. Otherwise continue through the existing invocation/reference definition algorithm.

This ordering prevents a declaration click from being treated as an invocation and accidentally returning definitions or implementations.

### 3.4 CodeLens provider and commands

The provider's initial pass is local and cheap: it enumerates declarations and returns unresolved CodeLens entries. `resolveCodeLens` computes relationships only for lenses VS Code asks to resolve. A declaration's relation computation is shared by every lens on that declaration, so `↑ declaration`, `↓ N implementations`, and usage counts do not issue duplicate graph queries.

Resolved lenses call extension commands with the document URI, exact declaration token range, document version, relation kind, and already-normalized targets. Commands reject stale document versions, re-anchor to the exact token when safe, and reuse the existing direct-open and Peek presentation paths.

## 4. Caching and invalidation

Relation bundles are cached by canonical workspace root, document URI, document version, declaration token range, and known CBM index state/revision. Concurrent identical requests share one in-flight promise.

The cache is invalidated when:

- the document changes or closes;
- the owning workspace root is reindexed or changes status;
- the MCP session reconnects with a different project/index identity;
- the extension is disposed.

Cancellation and the configured graph-query timeout propagate through CodeLens resolution. Timeout, cancellation, an unready index, or an unsupported runtime yields an unresolved/omitted lens and no popup notification.

## 5. Error and confidence policy

- Every target must remain inside the authorized canonical workspace root.
- A result must have compatible symbol kind, owner, signature/arity evidence, and a verified source location.
- Unique direct declaration/implementation jumps must meet the existing direct-jump confidence threshold.
- Multiple safe declaration/implementation results use Peek.
- Caller/reference actions always use Peek.
- Declarations, overrides, duplicates, and syntactically invalid occurrences are removed from caller results.
- Heuristic-only occurrences are never labeled as verified callers or references.
- No relationship produces no CodeLens and no ordinary navigation notification.

## 6. Testing and privacy

All automated fixtures use generic package, class, method, and directory names. Private workspace names, paths, symbols, screenshots, and copied source snippets are forbidden in source, tests, snapshots, docs, build metadata, and VSIX contents. Optional local end-to-end tests receive external workspace paths through environment variables and do not persist those values.

Tests cover:

- invocation with zero, one, and multiple implementations;
- interface/base and implementation declarations mapping to the same caller set;
- overloaded members and same-name members on unrelated types;
- exclusion of declarations and overrides from caller results;
- type and field declaration references;
- CodeLens labels, counts, omission on empty results, and direct-versus-Peek commands;
- document edit/close and index-state cache invalidation;
- cancellation, timeout, unready index, and stale document versions;
- generic fixture privacy scans across tracked files, staged changes, committed history relevant to the release, and the unpacked VSIX.

Unit and integration tests must assert both the returned locations and the presentation mode (`direct` or `peek`). The final package is inspected to confirm that no private test material is included.

## 7. Packaging and release identity

The release version remains `0.1.4`; this feature does not use `0.2.0`.

The extension logo is stored at `images/icon.png` and referenced by the top-level package manifest field:

```json
"icon": "images/icon.png"
```

The supplied asset is a square 256×256 PNG. Packaging verification must confirm that the image is not excluded by `.vscodeignore`, is present in the generated VSIX, and is the manifest icon. The logo and all feature changes ship together in 0.1.4.

## 8. Acceptance criteria

1. `Ctrl+Click`/`F12` on any method or constructor declaration opens verified callers in Peek.
2. Interface/base declarations and compatible implementations return the same logical caller set.
3. Invocation sites retain unique-direct, multiple-Peek, and no-implementation-declaration behavior.
4. Type and field declarations open verified references in Peek.
5. CodeLens shows accurate non-zero declaration, implementation, caller, and reference relationships and omits unavailable relationships.
6. CodeLens and navigation honor cancellation, timeouts, document freshness, workspace trust, root containment, and index state.
7. No new keybinding or extension-specific CodeLens setting is introduced.
8. The version is exactly `0.1.4`, and the generated VSIX contains and uses `images/icon.png`.
9. Source, tests, history introduced by this work, and packaged artifacts contain no private-workspace identifiers or content.
