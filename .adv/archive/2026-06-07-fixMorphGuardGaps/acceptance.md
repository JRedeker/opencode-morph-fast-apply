# Acceptance

Reviewed at: 2026-06-07T00:43:53.849Z

## Contract Review Matrix

| ID | Kind | Requirement | Status | Evidence |
|---|---|---|---|---|
| SC1 | success_criterion | The catastrophic-truncation guard protects no-marker edits while still allowing intentional full-replacement where the merged result matches the provided code_edit. | pass | Truncation guard now baseline-aware; tests + deployed probe show catastrophic no-marker shrink blocked and intentional replacement still writes. |
| SC2 | success_criterion | The marker-leakage guard fires whenever the merged output contains marker text the original file lacked, regardless of whether the code_edit had markers. | pass | Marker-leakage guard fires regardless of input markers; deployed probe blocks no-marker leakage. |
| SC3 | success_criterion | A Morph API abort during response body parse is classified as `api_timeout`, not `api_parse_error`. | pass | JSON-parse abort classified api_timeout; new test + deployed probe pass; invalid-JSON control still api_parse_error. |
| SC4 | success_criterion | All existing tests continue to pass and new regression tests cover the fixed behavior. | pass | bun run ci: 124 pass, 0 fail, 234 expect calls; tsc --noEmit clean. 4 new regression tests. |
| AC1 | acceptance_criterion | Test: 10-line file, no markers, Morph returns a result ~90% smaller than the provided code_edit -> blocked, no write. | pass | Test 'blocks catastrophic shrink on no-marker edit' + deployed FIX1a probe: blocked, no write. |
| AC2 | acceptance_criterion | Test: no-marker edit where the merged result is close to the provided code_edit (intentional replacement) -> writes, no false positive. | pass | Test 'allows intentional no-marker replacement where merged ~= code_edit' + deployed control probe: writes. |
| AC3 | acceptance_criterion | Test: no-marker edit where merged output gains marker text the original lacked -> blocked, no write. | pass | Test 'blocks marker leakage on no-marker edit' + deployed FIX1b probe: blocked, no write. |
| AC4 | acceptance_criterion | Test: abort during `response.json()` -> result kind is `api_timeout`. | pass | Test 'returns api_timeout when abort fires during body parse' + deployed FIX2 probe. |
| AC5 | acceptance_criterion | `bun run ci` passes (bun test + tsc --noEmit) and the fix is redeployed locally. | pass | bun run ci green; redeployed to global node_modules; deployed-module probe passes. |
| C1 | constraint | Do not weaken existing guards (dropped-import, >10-line refusal, path confinement, secret scrubbing). | respected | Existing guards preserved: dropped-import, >10-line refusal, path confinement, secret scrubbing tests all still pass. |
| C2 | constraint | Do not block intentional full-replacement of small files. | respected | Intentional-replacement control test passes; no false positive introduced. |
| C3 | constraint | Do not expose secrets. | respected | No secret values added to logs/errors; scrubbing tests still pass. |
| C4 | constraint | No release/tag/publish. | respected | No release/tag/publish performed. |
| DONT1 | avoidance | Avoid changing the >10-line missing-marker refusal threshold. | respected | >10-line missing-marker refusal threshold unchanged. |
| DONT2 | avoidance | Avoid adding new tool surface or replacing Morph. | respected | No new tool surface; Morph integration unchanged. |
| OOS1 | out_of_scope | Broader rework of the marker threshold policy. | not_applicable | Marker threshold policy rework not attempted. |
| OOS2 | out_of_scope | Release automation. | not_applicable | No release automation work. |

