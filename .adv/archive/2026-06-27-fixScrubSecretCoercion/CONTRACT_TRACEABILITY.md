# Contract Traceability

**Change ID:** fixScrubSecretCoercion
**Contract Version:** 1
**Rigor:** standard
**Reviewed:** 2026-06-27T23:28:39.586Z

## Contract Items

| ID | Kind | Status | Evidence Policy | Evidence |
| --- | --- | --- | --- | --- |
| AC1 | acceptance_criterion | pass | test | `bun test index.test.ts -t scrubSecrets` passed 8 scrubSecrets tests per adv-reviewer; full `bun test` passed 130 tests. |
| AC2 | acceptance_criterion | pass | test | scrubSecrets test `coerces Error messages without throwing` passed; reviewer reran targeted suite. |
| AC3 | acceptance_criterion | pass | test | scrubSecrets test `coerces nullish and numeric messages without throwing` passed. |
| AC4 | acceptance_criterion | pass | test | scrubSecrets test `coerces nullish and numeric messages without throwing` passed. |
| AC5 | acceptance_criterion | pass | test | scrubSecrets test `coerces nullish and numeric messages without throwing` passed. |
| AC6 | acceptance_criterion | pass | test | Existing test `removes explicit apiKey from message` passed in targeted and full suites. |
| AC7 | acceptance_criterion | pass | test | Existing explicit-key test asserts returned string contains `***REDACTED***` and not the raw key; targeted scrubSecrets suite passed. |
| AC8 | acceptance_criterion | pass | test | Existing test `removes Bearer token pattern` passed in targeted and full suites. |
| AC9 | acceptance_criterion | pass | test | Existing Bearer test asserts `Bearer ***REDACTED***` and no raw token; targeted scrubSecrets suite passed. |
| AC10 | acceptance_criterion | pass | test | New test `redacts explicit apiKey and Bearer token in one pass` passed. |
| AC11 | acceptance_criterion | pass | test | New combined-redaction test passed in targeted and full suites. |
| AC12 | acceptance_criterion | pass | test | New test `does not coerce non-string apiKey into an accidental redaction token` passed. |
| AC13 | acceptance_criterion | pass | test | New non-string apiKey test passed without throw. |
| AC14 | acceptance_criterion | pass | test | New collision test with numeric value 12345 in message and apiKey 12345 as number passed with original message unchanged. |
| AC15 | acceptance_criterion | pass | test | Existing test `leaves unrelated text intact` passed. |
| AC16 | acceptance_criterion | pass | test | Existing unrelated text test asserts exact same string; targeted scrubSecrets suite passed. |
| AC17 | acceptance_criterion | pass | test | Reviewer verified `index.ts` sends `Authorization: Bearer ${apiKey}` and Context7 Morph docs confirm Bearer auth. |
| AC18 | acceptance_criterion | pass | test | Reviewer verified `src/constants.ts` reads `process.env.MORPH_API_KEY`; Context7 Morph docs use `MORPH_API_KEY`. |
| AC19 | acceptance_criterion | pass | test | README updated and docs test `README documents Morph key process environment setup` passed. |
| AC20 | acceptance_criterion | pass | test | README updated and docs test asserts `already-running OpenCode sessions` plus restart guidance; targeted docs suite passed. |
| AC21 | acceptance_criterion | pass | test | Reviewer verified endpoint construction: `MORPH_API_URL=https://api.morphllm.com` + `/v1/chat/completions`, matching Morph docs. |
| AC22 | acceptance_criterion | pass | test | Reviewer verified `MORPH_MODEL=morph-v3-fast`; Context7 Morph docs list `morph-v3-fast` as Fast Apply model. |
| AC23 | acceptance_criterion | pass | test | Targeted scrubSecrets tests passed before and after reviewer remediation; final reviewer suite reported 8 pass. |
| AC24 | acceptance_criterion | pass | test | Targeted docs test `bun test index.test.ts -t "packaged tool-selection instructions"` passed 4 tests. |
| AC25 | acceptance_criterion | pass | test | Full `bun test` passed: reviewer reported 130 tests pass after remediation. |
| AC26 | acceptance_criterion | pass | test | `bun run typecheck` passed per orchestrator and reviewer verification. |
| AC27 | acceptance_criterion | pass | test | Final verification task recorded targeted + full test/typecheck pass evidence in ADV task state. |
| AC28 | acceptance_criterion | pass | test | Final full suite and typecheck rerun after all code/docs/reviewer changes passed. |
| AC29 | acceptance_criterion | pass | test | Acceptance reviewer verdict READY; no blockers/issues; verification commands passed. |
| C1 | constraint | respected | static_check | Bearer regex in `index.ts` preserved; tests passed. |
| C2 | constraint | respected | static_check | Failure-kind strings and API request/response flow unchanged; reviewer found no behavior drift. |
| C3 | constraint | respected | static_check | Scrubbing made deterministic/local in `scrubSecrets`; callers do not own normalization. |
| C4 | constraint | respected | static_check | No new dependencies added; package files unchanged except dependency installation artifacts ignored. |
| C5 | constraint | respected | static_check | Kept `process.env.MORPH_API_KEY`; only README/comment clarification, no new config mechanism. |
| OOS1 | out_of_scope | not_applicable | not_applicable | No broader plugin-load lifecycle work performed. |
| OOS2 | out_of_scope | not_applicable | not_applicable | No path confinement, import preservation, or marker-leakage changes performed. |
| OOS3 | out_of_scope | not_applicable | not_applicable | No release automation or package publishing changes performed. |
| OOS4 | out_of_scope | not_applicable | not_applicable | No secret storage or credential-manager integration added. |

## Task References

| Task | Implements | Verifies | Respects | N/A Reason |
| --- | --- | --- | --- | --- |
| tk-81646c464654 | AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC11, AC12, AC13, AC14, AC15, AC16, AC17, AC18, AC19, AC20, AC21, AC22, AC23, AC24 | AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC11, AC12, AC13, AC14, AC15, AC16, AC17, AC18, AC19, AC20, AC21, AC22, AC23, AC24 | C1, C2, C3, C4, C5 |  |
| tk-6771b40f4243 | AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC11, AC12, AC13, AC14, AC15, AC16, C1, C2, C3, C4, C5 | AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC11, AC12, AC13, AC14, AC15, AC16 | C1, C2, C3, C4, C5, OOS1, OOS2, OOS3, OOS4 |  |
| tk-69ea289aeab6 | AC17, AC18, AC19, AC20, AC21, AC22, AC23, AC24 | AC17, AC18, AC19, AC20, AC21, AC22, AC23, AC24 | C1, C2, C3, C4, C5, OOS1, OOS2, OOS3, OOS4 |  |
| tk-3613996b3ef9 |  | AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC11, AC12, AC13, AC14, AC15, AC16, AC17, AC18, AC19, AC20, AC21, AC22, AC23, AC24, AC25, AC26, AC27, AC28, AC29 | C1, C2, C3, C4, C5, OOS1, OOS2, OOS3, OOS4 |  |
