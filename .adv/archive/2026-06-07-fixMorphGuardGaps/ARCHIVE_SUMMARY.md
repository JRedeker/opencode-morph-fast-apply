# Archive: Fix morph guard gaps

**Change ID:** fixMorphGuardGaps
**Archived:** 2026-06-07T00:44:20.262Z
**Created:** 2026-06-07T00:37:36.559Z

## Tasks Completed

- ✅ Fix truncation + marker-leakage guard gating in src/execute.ts
  > src/execute.ts: marker-leakage guard fires whenever merged gains marker text original lacked; truncation guard uses baseline = hasMarkers ? originalCode : normalizedCodeEdit and fires regardless of markers, with mode-aware message. Added no-marker guard coverage tests (catastrophic shrink blocked, intentional replacement allowed, marker leakage blocked).
- ✅ Classify body-parse abort as api_timeout in index.ts callMorphApply
  > index.ts: JSON-parse catch returns api_timeout when parseErr.name === 'AbortError' || controller.signal.aborted, else api_parse_error. Added test that aborts during response.json() and asserts kind api_timeout.
- ✅ Verify and redeploy locally
  > Deployed worktree package files to global node_modules and probed the deployed module reproducing the two originally-failing scenarios plus controls. All pass.

## Specs Modified

