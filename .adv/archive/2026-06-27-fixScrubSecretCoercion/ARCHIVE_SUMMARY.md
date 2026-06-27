# Archive: Fix scrub secret coercion

**Change ID:** fixScrubSecretCoercion
**Archived:** 2026-06-27T23:36:32.436Z
**Created:** 2026-06-27T22:52:51.983Z

## Tasks Completed

- ✅ Add failing regression coverage for scrubSecrets and key-config docs
  > Extended index.test.ts with README assertions for OpenCode process environment/restart guidance and scrubSecrets regressions for Error, nullish, number, non-string apiKey no-coercion, and combined explicit-key + Bearer redaction. Recorded RED evidence with bun test index.test.ts failing on new cases.
- ✅ Implement total scrubSecrets normalization and caller audit
  > Changed scrubSecrets signature to `(message: unknown, apiKey?: unknown): string`; normalizes strings, Error.message, null/undefined, and other values before string operations; redacts explicit API keys only when apiKey is a non-empty string; preserved Bearer token regex and callers. Targeted scrubSecrets tests pass.
- ✅ Clarify Morph API key setup documentation
  > Updated README to state MORPH_API_KEY must be present in the environment that starts OpenCode, that the plugin reads it from the OpenCode process environment at load time, and that already-running sessions need OpenCode restart after key changes. Targeted docs tests pass.
- ✅ Run full verification for scrubSecrets/config fix
  > Verified targeted scrubSecrets regressions, targeted README/instruction docs assertions, full Bun test suite, and TypeScript typecheck. Acceptance review added safe fallback for unstringifiable message values, a regression test, and constants comment clarification; reviewer reported scrubSecrets 8 tests pass, docs 4 tests pass, typecheck pass, and full bun test 130 pass. Remediation committed in checkpoint 18419c11e983c6625962cd1cbeb2c0735c8e6f6b.

## Specs Modified


## Wisdom Accumulated

- **[gotcha]** Fresh ADV worktrees may not have ignored dependencies installed; `bun test` can fail with missing package errors (e.g. `Cannot find package 'diff'`) until `bun install` runs in the worktree. Classify as environment setup before treating test output as product RED/GREEN evidence.
