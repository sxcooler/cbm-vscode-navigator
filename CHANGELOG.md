# Changelog

## 0.1.6

- Increase the default navigation graph request timeout from 2 to 5 seconds while preserving custom timeouts and editor cancellation.
- Read CBM's local `auto_index` setting before opening MCP sessions; require manual connection when enabled or unavailable.
- Allow up to 30 seconds for a slow configuration read so workspaces connect automatically when CBM returns `false`. Report a timeout in the extension log if the deadline expires.
- Add Connect and Connecting status actions, and warn that a manual connection may start automatic indexing.
- Recheck the setting after workspace trust and on manual reconnect, and prevent pending checks from connecting after disposal.

## 0.1.5

- Request JSON project discovery so CBM 0.11.0 indexes are recognized on startup and after indexing.
- Allow index requests to run for up to 30 minutes instead of the MCP SDK's default one-minute timeout.

## 0.1.4

- Navigate method and constructor declarations to verified callers across their interface/implementation family.
- Navigate type and field declarations to verified references while preserving invocation implementation promotion.
- Add lazy CodeLens links for declarations, implementations, callers, and references.
- Anchor declaration-family queries by source file and declaration line, then follow directed transitive CBM hierarchy edges without occurrence cross-products.
- Add the extension logo to the packaged manifest and Marketplace metadata.

## 0.1.3

- Resolve method invocations from their exact source call edge before falling back to global symbol search.
- Carry the selected declaration owner into implementation lookup so unique concrete implementations open directly and multiple implementations remain Peek candidates.
- Recover type references from verified source ranges when graph usage edges do not include occurrence lines.

## 0.1.2

- Preserve VS Code editor positions across the Java parser Worker boundary so navigation providers reach CBM queries.
- Route optional IDEA shortcuts through extension proxy commands so native VS Code menus keep their default key labels.
- Remove the duplicate editor-context declaration entry and add a live VS Code provider regression test for large indexed workspaces.

## 0.1.1

- Keep the optional IDEA shortcuts disabled when the VS Code keymap is selected.
- Anchor graph queries so navigation stays within the configured timeout on large repositories.
- Accept exact definitions without optional CBM scoring metadata and match simple Java receiver hints to qualified graph types.
- Normalize Windows authorized-root paths before starting CBM.

## 0.1.0

- Initial Java smart definition, declaration, implementation, and reference navigation.
- Root-scoped codebase-memory-mcp sessions with explicit fast indexing.
- Tree-sitter Java WASM Worker for unsaved current-buffer context.
- Strict candidate confidence and authorized-path validation.
- Consent-based, checksum-verified shared CBM setup and upgrade flow.
- Default VS Code and optional IDEA navigation keymaps.
