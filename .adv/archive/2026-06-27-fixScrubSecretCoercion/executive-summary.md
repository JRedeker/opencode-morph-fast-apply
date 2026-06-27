# Executive Summary: Fix scrubSecrets runtime coercion

## Outcome

`scrubSecrets()` now safely handles runtime values beyond strings before calling string methods. Error values, nullish values, numbers, and even unstringifiable objects no longer turn an error-scrubbing path into a plugin-load failure.

## What changed

- Widened `scrubSecrets` runtime boundary to accept `unknown` inputs.
- Normalized strings, `Error` instances, nullish values, and other values before redaction.
- Guarded explicit API-key redaction so only non-empty string keys are used for redaction.
- Preserved existing Bearer-token redaction and Morph API failure semantics.
- Clarified README Morph key setup: `MORPH_API_KEY` must be visible to the OpenCode/plugin process, and already-running sessions need restart after env changes.
- Updated `src/constants.ts` comment to match the OpenCode/plugin process environment model.

## Verification

- Targeted `scrubSecrets` tests: pass (8 tests after reviewer hardening).
- Targeted docs/instruction tests: pass (4 tests).
- Full `bun test`: pass (130 tests after reviewer hardening).
- `bun run typecheck`: pass.
- Independent acceptance review: READY, no blockers/issues.

## Risk posture

Low. The fix is local to the sanitizer boundary and docs/comment clarification. No new dependencies, config mechanism, or Morph API request/response changes were introduced.