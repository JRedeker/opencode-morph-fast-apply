# Archive: Fix improvement findings

**Change ID:** fixImprovementFindings
**Archived:** 2026-06-07T00:16:48.361Z
**Created:** 2026-06-06T22:34:21.175Z

## Tasks Completed

- ✅ Extract production helper modules and migrate helper tests
  > Extracted production helper modules under src/: constants, diff, imports, normalize. Updated index.ts to import helpers, package.json to include src/, tsconfig to include src/**/*.ts, and index.test.ts to import production helpers instead of duplicated helper bodies. Preserved plugin registration/runtime behavior for this task scope.
- ✅ Implement path confinement resolver and path safety tests
  > Added src/path-confinement.ts resolver using per-call context.worktree/context.directory root selection, path.resolve canonicalization, separator-boundary containment, existing target realpath checks, and nearest existing parent realpath checks for new files. Routed index.ts file access through resolver before reads/writes and added path safety tests for out-of-root absolute paths, traversal, sibling-prefix, allowed in-root absolute paths, and symlink escapes.
- ✅ Replace import preservation heuristic with declaration comparison
  > Added ImportEntry/extractImportEntries declaration parsing in src/imports.ts and rewrote findDroppedIdentifiers to compare original and merged import declarations instead of whole-file identifier substrings. Updated tests to assert dropped imports are detected even when identifiers remain used elsewhere and expanded representative import syntax coverage.
- ✅ Extract executeMorphEdit and add no-network execution tests
  > Added src/execute.ts with production executeMorphEdit and injected runtime dependencies for fs/api/log/time/context/config. Updated index.ts tool wrapper to delegate to executeMorphEdit while preserving plugin/TUI behavior. Added no-network tests for missing API key, readonly block, allowed build agent, missing markers, marker leakage, truncation, dropped imports, write failure, mocked success, and new-file creation.
- ✅ Add Morph API timeout coverage and non-secret failure classification
  > Added FailureKind classification and scrubSecrets to Morph API error paths, exported/tested callMorphApply with injected test options, kept timeout active through response body read/JSON parse, added parse/timeout/secret-scrub tests, updated execute API failure path to scrub returned errors, and fixed src/imports.ts type predicate issues so typecheck passes.
- ✅ Align repository with Bun lockfile policy
  > Removed bun.lock from .gitignore, generated committed bun.lock, switched CI and release workflows from bun install --frozen-lockfile to bun ci, and removed package-lock.json to leave Bun as the single authoritative lockfile policy.
- ✅ Update README, packaged instructions, and changelog
  > Updated README stale release pin to v1.9.0, documented safety guards including path confinement, dropped import guard, and secret scrubbing, added Bun lockfile policy note, added changelog entry, and updated tests to assert current docs expectations. instructions/morph-tools.md required no changes because guidance remained current.
- ✅ Run final verification and contract coverage review
  > Ran final dependency/lockfile verification and full repo CI, then incorporated acceptance reviewer hardening in .gitignore, CHANGELOG.md, index.test.ts, and src/imports.ts. Re-ran CI, lockfile check, whitespace check, and secret scan after hardening. Confirmed contract coverage for SC1-SC8 and AC1-AC8 remains satisfied.

## Specs Modified


## Wisdom Accumulated

- **[gotcha]** When extracting TypeScript helper modules in this ESM/Bun plugin, relative imports between `.ts` source files needed `.js` specifiers for `tsc`/bundler resolution while still passing `bun test`.
- **[pattern]** For write confinement in this OpenCode plugin, resolve against per-call `context.worktree ?? context.directory`, use `path.resolve`, enforce `resolved === root || resolved.startsWith(root + path.sep)`, and realpath existing targets / nearest existing parent for new targets before any Bun file access.
- **[pattern]** Import-preservation guards should compare parsed import declaration entries between original and merged code, not search for binding names in whole-file text; usage of a dropped binding can otherwise mask the missing import.
- **[success]** Extracting `executeMorphEdit(args, runtime)` with injected fs/api/log/time/context/config dependencies enabled full no-network coverage of tool execution while keeping the OpenCode plugin wrapper thin and stable.
- **[gotcha]** With strict TypeScript, `.filter((s) => s && s.length > 0)` can infer `string | boolean` rather than boolean; use explicit boolean predicates such as `!!s && s.length > 0` to keep helper modules typecheck-clean.
- **[success]** Docs freshness can be guarded with tests: asserting stale version pins are absent and current pins/safety sections are present catches README drift during behavior changes.
- **[success]** After switching to Bun lockfile policy, final verification should include both `bun ci` (lockfile/install invariant) and `bun run ci` (test + typecheck) to prove dependency and code correctness separately.
