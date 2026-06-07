# Executive Summary

`fixMorphGuardGaps` closes two `morph_edit` safety defects found during scenario testing of the deployed plugin.

## What Changed

- `src/execute.ts`: the catastrophic-truncation guard now runs for both marker and no-marker edits, comparing the merged result against the correct baseline (original file for marker edits, the provided code_edit for no-marker full replacements). The marker-leakage guard no longer requires the input to carry markers; it fires whenever the merged output gains marker text the original lacked (keeping the `!originalHadMarker` guard against false positives).
- `index.ts`: `callMorphApply` now classifies an abort raised during response body parsing as `api_timeout` instead of `api_parse_error`.
- `index.test.ts`: 4 new regression tests (no-marker catastrophic shrink blocked, intentional no-marker replacement allowed, no-marker marker leakage blocked, body-parse abort -> api_timeout).

## Verification

- `bun run ci`: 124 pass, 0 fail, 234 expect calls; `tsc --noEmit` clean.
- Redeployed to `~/.config/opencode/node_modules/opencode-morph-fast-apply`; deployed-module probe reproduced the two originally-failing scenarios and confirmed they are now fixed, with controls confirming no false positives.
- Contract review matrix: 17/17 pass/respected/not-applicable.

## Remaining Concerns

None. The >10-line missing-marker refusal threshold was intentionally left unchanged (out of scope).