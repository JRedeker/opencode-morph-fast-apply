# Research Pack: Repo Improvement Prep

Target: repo-wide scan (`/home/jon/dev/opencode-morph-fast-apply`)
Mode: broad
Created: 2026-06-06
Updated: 2026-06-06

## Purpose & Scope

Scope: OpenCode Morph Fast Apply plugin source, tests, README/instructions, package metadata, and GitHub Actions workflows.

Deliberate non-scope: no ADV state mutation, no code fixes, no dependency install, no release/tag action, no package publish validation beyond source/docs/workflow evidence.

Context notes:

- ADV project context: missing (`adv_project_context` returned no `project.md`).
- Active ADV changes: none.
- Pending agenda: none.
- Specs: none.
- Source roots/files detected by `lgrep_get_file_tree`: `index.ts`, `index.test.ts`, `instructions/morph-tools.md`, workflows, package files.
- Semantic search note: two `lgrep_search_semantic` hybrid attempts timed out after 8s; retried with `hybrid:false` and used file reads/text search as fallback.

## Current State

### Security

- Severity: HIGH
  - Category: Security
  - Evidence: `index.ts:530-533` resolves absolute `target_filepath` unchanged; `index.ts:553` and `index.ts:704` write resolved path with `Bun.write`.
  - Impact: `morph_edit` can write outside the OpenCode project when called with an absolute path, bypassing normal repo/worktree confinement expectations for an editing tool.
  - Recommendation: canonicalize `target_filepath` with `path.resolve`, reject paths outside `directory`/`context.worktree`, and add regression tests for absolute paths plus `../` traversal.
  - Follow-up: `/adv-proposal Add path confinement`

### Reliability

- Severity: HIGH
  - Category: Reliability
  - Evidence: `index.ts:303-307` treats an imported identifier as preserved if it appears anywhere in merged code; `index.test.ts:673-681` explicitly expects no flag when an import is removed but the identifier remains in use.
  - Impact: dropped required imports can escape the guard when the identifier is still referenced, producing broken code after write.
  - Recommendation: compare parsed import declarations before/after, not whole-file substring presence; for supported languages, preserve import source + local binding shape or require a successful typecheck/lint hook when available.
  - Follow-up: `/adv-proposal Harden import guard`

- Severity: MEDIUM
  - Category: Reliability
  - Evidence: `index.ts:355-381` clears timeout after response headers; `index.ts:388` then parses JSON outside the active timeout.
  - Impact: slow or stalled response-body reads are not bounded by `MORPH_TIMEOUT`.
  - Recommendation: keep timeout active through `response.text()`/`response.json()` completion, or wrap the whole request + body read in one abortable promise.
  - Follow-up: `/adv-task`

### Testing

- Severity: HIGH
  - Category: Testing
  - Evidence: `index.test.ts:5-12` states production internals are duplicated in tests; duplicated `findDroppedIdentifiers` appears at `index.test.ts:177-191` while production implementation appears at `index.ts:295-310`.
  - Impact: helper tests can pass while production helpers drift or remain untested.
  - Recommendation: export pure helpers from a local module and import them in tests; keep plugin wiring separate from guard/parsing logic.
  - Follow-up: `/adv-proposal Refactor testable helpers`

- Severity: MEDIUM
  - Category: Testing
  - Evidence: `index.test.ts` covers helper logic and README/instruction assertions, but no test exercises `morph_edit.execute` path from `index.ts:507-729` for path resolution, readonly blocking, API failure, or file-write refusal.
  - Impact: highest-risk behavior is verified indirectly or not at all.
  - Recommendation: extract `executeMorphEdit` with injectable filesystem/fetch/context and add tests for path confinement, missing API key, missing markers, guard failures, and success diff output.
  - Follow-up: `/adv-proposal Add execute tests`

### Observability

- Severity: LOW
  - Category: Observability
  - Evidence: structured logs use only `service`, `level`, `message` at `index.ts:424-435`; failures return strings at `index.ts:604-609`, `index.ts:629-639`, `index.ts:657-669`, `index.ts:686-699`.
  - Impact: failures are visible to users, but aggregation by reason/path/model/version is hard outside the TUI.
  - Recommendation: add structured metadata fields for failure kind, target path, model, timeout, and API duration while keeping secrets out.
  - Follow-up: `/adv-task`

### Developer Experience

- Severity: HIGH
  - Category: Developer Experience
  - Evidence: `.github/workflows/ci.yml:22` and `.github/workflows/release.yml:22` run `bun install --frozen-lockfile`; `lgrep_get_file_tree` found `package-lock.json` but no `bun.lock`; Bun docs say `bun install --frozen-lockfile`/`bun ci` require committed `bun.lock`.
  - Impact: CI/release reproducibility can fail or depend on lockfile behavior not represented in the repo.
  - Recommendation: commit `bun.lock` and prefer `bun ci`, or switch workflows to the package manager whose lockfile is committed.
  - Follow-up: `/adv-task`

- Severity: LOW
  - Category: Developer Experience
  - Evidence: README pin example uses `#v1.8.2` at `README.md:48`, while `package.json:3` and `CHANGELOG.md:10` show `1.9.0`.
  - Impact: install docs point users at an older release than the package version.
  - Recommendation: update pin example or describe it as an example historical pin.
  - Follow-up: `/adv-task`

### Code Quality

- Severity: MEDIUM
  - Category: Code Quality
  - Evidence: `index.ts` is 798 lines and contains API call, parsing, validation guards, file IO, tool registration, and TUI hook; `index.test.ts:5-12` duplicates internals instead of importing them.
  - Impact: locality is coarse; safety-critical helper behavior is harder to test directly and evolve without drift.
  - Recommendation: split pure helpers into nearby modules (`path.ts`, `imports.ts`, `guards.ts`, `morph-api.ts`) while preserving package entrypoint behavior.
  - Follow-up: `/adv-proposal Refactor plugin modules`

Verification signal:

- `bun run ci` executed locally: `bun test` passed 58 tests; `tsc --noEmit` failed with `TS2688: Cannot find type definition file for 'bun-types'`. Because dependencies were not installed and this command may require `bun install`, classify as environment/dependency-state evidence, not proof CI is broken.

## LBP / Reference Comparison

| Area | Current | Reference | Classification | Correction |
|---|---|---|---|---|
| OpenCode custom tool shape | `index.ts:462-505` defines `morph_edit` via `tool({ description, args, execute })`. | Context7 `/websites/opencode_ai_plugins`: custom tools define description, Zod args, async execute; execute receives args/context. | SOUND | Keep shape; add stronger validation inside execute. |
| File access confinement | `index.ts:530-533` accepts absolute paths; writes at `index.ts:553`, `index.ts:704`. | Context7 `/websites/opencode_ai_plugins`: plugin examples can intercept tool calls to restrict sensitive paths; custom tools receive `directory`/`worktree` context. | DRIFTED | Resolve against project/worktree and reject outside paths. Greenfield: make target path schema/path resolver a first-class boundary. |
| Bun reproducible CI install | Workflows use `bun install --frozen-lockfile`; repo tree has `package-lock.json`, no `bun.lock`. | Context7 `/oven-sh/bun`: `bun ci`/`bun install --frozen-lockfile` install exact versions from `bun.lock`; `bun.lock` should be committed. | ANTI-PATTERN | Commit `bun.lock` + use `bun ci`, or use npm commands with `package-lock.json`. Greenfield: choose one package manager and one lockfile. |
| TypeScript strictness | `tsconfig.json:7` has `strict: true`; `tsconfig.json:9` has declaration output. | Context7 `/microsoft/typescript`: `strict: true` enables stricter checks; `noEmit` typecheck is supported for validation. | SOUND | Keep strict; ensure dependency install path makes `bun-types` available before typecheck. |
| Morph Apply protocol | `index.ts:359-374` posts OpenAI-compatible chat completion with `<instruction>`, `<code>`, `<update>`. | Morph Apply API docs: OpenAI-compatible `/v1/chat/completions`, structured XML message with those tags; `morph-v3-fast`, `morph-v3-large`, and `auto` models. | SOUND | Consider defaulting `MORPH_MODEL=auto` only after product tradeoff review; current `morph-v3-fast` aligns with speed-focused README. |
| Edit result safety | Marker/truncation/import guards at `index.ts:614-700`. | Morph docs claim high accuracy, not perfect accuracy; external landscape shows structured diff/AST-aware approaches reduce misapply risk. | DRIFTED | Keep guards, but make correctness structural: parse imports and constrain paths. Greenfield: AST/range-aware merge or standardized patch validation. |

## Competitors & Alternatives

| Name | Summary | Difference | Maturity | Source | Relevance |
|---|---|---|---|---|---|
| OpenAI `apply_patch` | Structured patch tool for create/update/delete operations using V4A diffs. | Model emits explicit patch operations instead of full-file merge model output. | Official OpenAI API docs; active for GPT-5.1-era tooling. | https://developers.openai.com/api/docs/guides/tools-apply-patch | High: directly competes with model-merge editing for OpenCode agents. |
| FastEdit | AST-aware code editing that locates target symbols via tree-sitter and merges small chunks. | Uses symbol/range grounding before merge, reducing location ambiguity. | Public GitHub project published 2026. | https://github.com/parcadei/fastedit | Medium: validates AST-aware direction for safety-critical edits. |
| Aider / Cline / Cursor class tools | Broader AI coding tools with reviewable diffs, git-aware or IDE-native workflows. | Prioritize agent workflow, approvals, diffs, and context over a single fast-apply API. | Multiple 2026 comparison sources list them as established categories. | https://sureprompts.com/blog/best-ai-coding-assistants-2026 | Medium: shows user expectations around reviewable, auditable edits. |

## Emerging Patterns

| Pattern | Summary | Difference | Maturity | Source | Relevance |
|---|---|---|---|---|---|
| Standardized structured patch tools | Providers are standardizing patch schemas and server-side diff validation. | Moves correctness from fuzzy merge output toward typed operations. | OpenAI docs and OpenRouter 2026 coverage. | https://developers.openai.com/api/docs/guides/tools-apply-patch; https://headsupai.io/updates/openrouter-apply-patch-tool-standardizes-code-edits-across-hundreds-ai-models | High: suggests future `morph_edit` should interoperate with or benchmark against structured patch workflows. |
| Agentic engineering governance | 2026 coding tools emphasize orchestration, oversight, least privilege, auditability, and rollback. | Tool governance matters as much as edit speed. | Current trend reports and roadmaps. | https://codepick.dev/en/guides/ai-coding-agents-2026-roadmap/; https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf | High: path confinement, structured metadata, and tests map directly to this pattern. |

## Applicability to This Repo

High applicability:

- Path confinement: small surface, high safety value (`index.ts:530-704`).
- Structural import preservation: directly addresses product claim and issue #5 guard (`index.ts:295-310`, `CHANGELOG.md:14-21`).
- Lockfile/workflow alignment: low-effort CI reliability fix (`.github/workflows/*.yml:22`, missing `bun.lock`).

Medium applicability:

- Extract pure helpers: improves tests and maintainability, but requires module split in tiny package.
- Structured observability metadata: useful if users report failures, but less urgent than write-boundary safety.

Low/reject for now:

- Replacing Morph with another editing system: conflicts with package purpose; better as benchmark/reference, not immediate pivot.
- Adding heavyweight AST support for every language at once: desirable greenfield idea, but minimum viable step is structural import parsing for existing supported import syntaxes.

## Open Questions for Research

- Should `morph_edit` allow absolute paths inside the active worktree, or should all tool calls require project-relative paths?
- Does OpenCode plugin context expose `worktree` reliably across all install modes, and should confinement use `directory`, `context.worktree`, or both?
- Should default model remain `morph-v3-fast` for latency, or switch to Morph `auto` for accuracy when safety guards trigger?
- What minimal parser strategy covers import preservation without adding large dependencies?
- Should package manager standardize on Bun lockfile or npm lockfile for users who install via OpenCode plugin registry?

## Sources

- Local: `index.ts`, `index.test.ts`, `README.md`, `instructions/morph-tools.md`, `package.json`, `tsconfig.json`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `CHANGELOG.md`.
- ADV reads: `adv_project_context`, `adv_change_list`, `adv_agenda_list`, `adv_spec`.
- Context7: `/websites/opencode_ai_plugins` query on custom tools and file access hooks.
- Context7: `/oven-sh/bun` query on `bun install --frozen-lockfile`, `bun ci`, and `bun.lock`.
- Context7: `/microsoft/typescript` query on strict checking and no-emit validation.
- Morph docs: https://docs.morphllm.com/quickstart
- Morph Apply API docs: https://docs.morphllm.com/api-reference/endpoint/apply
- OpenAI apply_patch docs: https://developers.openai.com/api/docs/guides/tools-apply-patch
- AI coding comparison: https://sureprompts.com/blog/best-ai-coding-assistants-2026
- AI coding comparison: https://www.developersdigest.tech/blog/ai-coding-tools-comparison-matrix-2026
- Agentic coding trends: https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf
- Agentic coding roadmap: https://codepick.dev/en/guides/ai-coding-agents-2026-roadmap/
- OpenRouter apply_patch coverage: https://headsupai.io/updates/openrouter-apply-patch-tool-standardizes-code-edits-across-hundreds-ai-models
- FastEdit: https://github.com/parcadei/fastedit
