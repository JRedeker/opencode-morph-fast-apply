# Acceptance

Reviewed at: 2026-06-27T23:28:39.586Z

## Contract Review Matrix

| ID | Kind | Requirement | Status | Evidence |
|---|---|---|---|---|
| AC1 | acceptance_criterion | Non-string message inputs do not throw: | pass | `bun test index.test.ts -t scrubSecrets` passed 8 scrubSecrets tests per adv-reviewer; full `bun test` passed 130 tests. |
| AC2 | acceptance_criterion | `scrubSecrets(new Error("boom"))` returns `"boom"`. | pass | scrubSecrets test `coerces Error messages without throwing` passed; reviewer reran targeted suite. |
| AC3 | acceptance_criterion | `scrubSecrets(undefined)` returns `""`. | pass | scrubSecrets test `coerces nullish and numeric messages without throwing` passed. |
| AC4 | acceptance_criterion | `scrubSecrets(null)` returns `""`. | pass | scrubSecrets test `coerces nullish and numeric messages without throwing` passed. |
| AC5 | acceptance_criterion | `scrubSecrets(123)` returns `"123"`. | pass | scrubSecrets test `coerces nullish and numeric messages without throwing` passed. |
| AC6 | acceptance_criterion | Explicit API-key redaction remains correct: | pass | Existing test `removes explicit apiKey from message` passed in targeted and full suites. |
| AC7 | acceptance_criterion | Given message `"token sk-test-value"` and API key `"sk-test-value"`, returned string contains `"***REDACTED***"` and does not contain `"sk-test-value"`. | pass | Existing explicit-key test asserts returned string contains `***REDACTED***` and not the raw key; targeted scrubSecrets suite passed. |
| AC8 | acceptance_criterion | Bearer-token redaction remains correct: | pass | Existing test `removes Bearer token pattern` passed in targeted and full suites. |
| AC9 | acceptance_criterion | Given a string containing `Bearer abcdef1234567890abcdef`, returned string contains `Bearer ***REDACTED***` and does not contain the raw token. | pass | Existing Bearer test asserts `Bearer ***REDACTED***` and no raw token; targeted scrubSecrets suite passed. |
| AC10 | acceptance_criterion | Combined redaction works in one pass: | pass | New test `redacts explicit apiKey and Bearer token in one pass` passed. |
| AC11 | acceptance_criterion | Given a string containing both the explicit API key and a Bearer token, returned string redacts both secrets. | pass | New combined-redaction test passed in targeted and full suites. |
| AC12 | acceptance_criterion | Non-string `apiKey` input is safe: | pass | New test `does not coerce non-string apiKey into an accidental redaction token` passed. |
| AC13 | acceptance_criterion | Passing a non-string API key does not throw. | pass | New non-string apiKey test passed without throw. |
| AC14 | acceptance_criterion | Non-string API key is not coerced into an accidental redaction token. | pass | New collision test with numeric value 12345 in message and apiKey 12345 as number passed with original message unchanged. |
| AC15 | acceptance_criterion | Existing public behavior for unrelated strings is unchanged: | pass | Existing test `leaves unrelated text intact` passed. |
| AC16 | acceptance_criterion | `scrubSecrets("Morph API error (500): model not found")` returns the same string. | pass | Existing unrelated text test asserts exact same string; targeted scrubSecrets suite passed. |
| AC17 | acceptance_criterion | Morph API key configuration is source-backed: | pass | Reviewer verified `index.ts` sends `Authorization: Bearer ${apiKey}` and Context7 Morph docs confirm Bearer auth. |
| AC18 | acceptance_criterion | Code sends Morph API authentication as `Authorization: Bearer ${apiKey}`. | pass | Reviewer verified `src/constants.ts` reads `process.env.MORPH_API_KEY`; Context7 Morph docs use `MORPH_API_KEY`. |
| AC19 | acceptance_criterion | Code reads the default API key from `process.env.MORPH_API_KEY`, matching Morph docs examples that use `MORPH_API_KEY`. | pass | README updated and docs test `README documents Morph key process environment setup` passed. |
| AC20 | acceptance_criterion | README or packaged instructions state that `MORPH_API_KEY` must be visible to the OpenCode/plugin process. | pass | README updated and docs test asserts `already-running OpenCode sessions` plus restart guidance; targeted docs suite passed. |
| AC21 | acceptance_criterion | README or packaged instructions do not imply that setting `MORPH_API_KEY` in an unrelated shell is sufficient for already-running OpenCode sessions. | pass | Reviewer verified endpoint construction: `MORPH_API_URL=https://api.morphllm.com` + `/v1/chat/completions`, matching Morph docs. |
| AC22 | acceptance_criterion | Morph endpoint/model defaults are source-backed or corrected: | pass | Reviewer verified `MORPH_MODEL=morph-v3-fast`; Context7 Morph docs list `morph-v3-fast` as Fast Apply model. |
| AC23 | acceptance_criterion | `MORPH_API_URL` default remains compatible with `https://api.morphllm.com/v1/chat/completions` request construction, or is updated with tests/docs if incorrect. | pass | Targeted scrubSecrets tests passed before and after reviewer remediation; final reviewer suite reported 8 pass. |
| AC24 | acceptance_criterion | `MORPH_MODEL` default is one of the documented Fast Apply models. | pass | Targeted docs test `bun test index.test.ts -t "packaged tool-selection instructions"` passed 4 tests. |
| AC25 | acceptance_criterion | Verification passes: | pass | Full `bun test` passed: reviewer reported 130 tests pass after remediation. |
| AC26 | acceptance_criterion | Targeted `scrubSecrets` regression tests pass. | pass | `bun run typecheck` passed per orchestrator and reviewer verification. |
| AC27 | acceptance_criterion | Any docs/config drift tests touched by this change pass. | pass | Final verification task recorded targeted + full test/typecheck pass evidence in ADV task state. |
| AC28 | acceptance_criterion | Full repo test command passes. | pass | Final full suite and typecheck rerun after all code/docs/reviewer changes passed. |
| AC29 | acceptance_criterion | Typecheck passes. | pass | Acceptance reviewer verdict READY; no blockers/issues; verification commands passed. |
| C1 | constraint | Preserve existing Bearer-token regex behavior unless tests prove current behavior is defective. | respected | Bearer regex in `index.ts` preserved; tests passed. |
| C2 | constraint | Preserve existing failure-kind strings and Morph API request/response behavior. | respected | Failure-kind strings and API request/response flow unchanged; reviewer found no behavior drift. |
| C3 | constraint | Keep scrubbing deterministic and local to the boundary; do not rely on caller discipline alone. | respected | Scrubbing made deterministic/local in `scrubSecrets`; callers do not own normalization. |
| C4 | constraint | Do not add runtime dependencies for this fix. | respected | No new dependencies added; package files unchanged except dependency installation artifacts ignored. |
| C5 | constraint | Prefer correcting docs/instructions over adding a new plugin config mechanism unless current `process.env.MORPH_API_KEY` support is proven insufficient. | respected | Kept `process.env.MORPH_API_KEY`; only README/comment clarification, no new config mechanism. |
| OOS1 | out_of_scope | Broader plugin-load lifecycle changes. | not_applicable | No broader plugin-load lifecycle work performed. |
| OOS2 | out_of_scope | Path confinement, import preservation, or marker-leakage guard changes. | not_applicable | No path confinement, import preservation, or marker-leakage changes performed. |
| OOS3 | out_of_scope | Release automation or package publishing changes. | not_applicable | No release automation or package publishing changes performed. |
| OOS4 | out_of_scope | Secret storage or credential-manager integration. | not_applicable | No secret storage or credential-manager integration added. |

