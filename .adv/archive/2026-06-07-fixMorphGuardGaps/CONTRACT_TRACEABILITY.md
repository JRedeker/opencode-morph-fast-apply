# Contract Traceability

**Change ID:** fixMorphGuardGaps
**Contract Version:** 1
**Rigor:** standard
**Reviewed:** 2026-06-07T00:43:53.849Z

## Contract Items

| ID | Kind | Status | Evidence Policy | Evidence |
| --- | --- | --- | --- | --- |
| SC1 | success_criterion | pass | review | Truncation guard now baseline-aware; tests + deployed probe show catastrophic no-marker shrink blocked and intentional replacement still writes. |
| SC2 | success_criterion | pass | review | Marker-leakage guard fires regardless of input markers; deployed probe blocks no-marker leakage. |
| SC3 | success_criterion | pass | review | JSON-parse abort classified api_timeout; new test + deployed probe pass; invalid-JSON control still api_parse_error. |
| SC4 | success_criterion | pass | review | bun run ci: 124 pass, 0 fail, 234 expect calls; tsc --noEmit clean. 4 new regression tests. |
| AC1 | acceptance_criterion | pass | test | Test 'blocks catastrophic shrink on no-marker edit' + deployed FIX1a probe: blocked, no write. |
| AC2 | acceptance_criterion | pass | test | Test 'allows intentional no-marker replacement where merged ~= code_edit' + deployed control probe: writes. |
| AC3 | acceptance_criterion | pass | test | Test 'blocks marker leakage on no-marker edit' + deployed FIX1b probe: blocked, no write. |
| AC4 | acceptance_criterion | pass | test | Test 'returns api_timeout when abort fires during body parse' + deployed FIX2 probe. |
| AC5 | acceptance_criterion | pass | test | bun run ci green; redeployed to global node_modules; deployed-module probe passes. |
| C1 | constraint | respected | static_check | Existing guards preserved: dropped-import, >10-line refusal, path confinement, secret scrubbing tests all still pass. |
| C2 | constraint | respected | static_check | Intentional-replacement control test passes; no false positive introduced. |
| C3 | constraint | respected | static_check | No secret values added to logs/errors; scrubbing tests still pass. |
| C4 | constraint | respected | static_check | No release/tag/publish performed. |
| DONT1 | avoidance | respected | review | >10-line missing-marker refusal threshold unchanged. |
| DONT2 | avoidance | respected | review | No new tool surface; Morph integration unchanged. |
| OOS1 | out_of_scope | not_applicable | not_applicable | Marker threshold policy rework not attempted. |
| OOS2 | out_of_scope | not_applicable | not_applicable | No release automation work. |

## Task References

| Task | Implements | Verifies | Respects | N/A Reason |
| --- | --- | --- | --- | --- |
| tk-c3466c6971a2 | SC1, SC2 | AC1, AC2, AC3 | C1, C2, C3, DONT1, DONT2 |  |
| tk-23c8863fda42 | SC3 | AC4 | C1, C3, DONT2 |  |
| tk-c7a3b81cae58 | SC4 | AC5 | C4, DONT1, OOS2 |  |
