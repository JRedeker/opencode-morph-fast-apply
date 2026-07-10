# Acceptance

Reviewed at: 2026-07-10T20:43:00.000Z

## Contract Review Matrix

| ID | Kind | Requirement | Status | Evidence |
|---|---|---|---|---|
| SC1 | success_criterion | `index.ts`, `instructions/morph-tools.md`, and `README.md` state the bounded native-edit recovery policy. | pass | Reviewer READY: three owned recovery surfaces intact. |
| SC2 | success_criterion | `write` remains limited to new-file or intentional full-file replacement work; the existing Morph API-error/timeout → native-edit fallback remains documented. | pass | Reviewer verified write boundary and API fallback retained. |
| SC3 | success_criterion | Tests fail if any owned policy surface omits required recovery anchors; `bun run ci` exits 0. | pass | Cross-surface policy tests present; final CI pass evidence. |
| SC4 | success_criterion | Source package version, README pinned-version example, version assertions, and release metadata all identify `1.10.2` / `v1.10.2` consistently. | pass | Reviewer verified package, README, runtime constant, and metadata consistently identify 1.10.2. |
| SC5 | success_criterion | `CHANGELOG.md` has a non-empty `## [1.10.2]` section so the tag-release workflow can create release notes. | pass | Reviewer verified non-empty workflow-compatible CHANGELOG 1.10.2 section. |
| AC1 | acceptance_criterion | Given native `edit` reports unmatched or ambiguous target, all three owned policy surfaces tell the agent to re-read and not repeat unchanged input. | pass | Policy anchor tests pass; reviewer confirmed recovery wording. |
| AC2 | acceptance_criterion | Given re-read content leaves a small exact edit, all three surfaces permit at most one corrected native edit; otherwise they direct Morph for multi-line, scattered, whitespace-sensitive, or broader-anchoring repair. | pass | Policy tests pass; reviewer confirmed bounded native retry/Morph handoff. |
| AC3 | acceptance_criterion | Existing Morph API-error/timeout fallback and `write` boundary remain present and tested. | pass | Focused tests and review confirm API fallback and write boundary. |
| AC4 | acceptance_criterion | Automated source tests verify policy anchors plus version/changelog consistency; `bun run ci` exits 0. | pass | Final bun run ci: 137 pass, 0 fail, clean typecheck; reviewer focused suite 7 pass. |
| C1 | constraint | Do not claim automatic native-edit interception or retry. | respected | Diff has no native edit interception/retry runtime code. |
| C2 | constraint | Do not route every small edit through Morph. | respected | Existing routing retains native exact-edit path. |
| C3 | constraint | Keep Morph safety guards, path confinement, secret scrubbing, readonly protections, API request contract, and runtime behavior unchanged. | respected | Reviewer found no runtime, safety, API, or workflow behavior changes. |
| C4 | constraint | Do not create an npm release, alter unrelated OpenCode settings, or hand-edit deployed plugin files. | respected | No npm release, global config, or deployed-file modification in source diff. |
| C5 | constraint | Do not create/push `v1.10.2` until Phase 9 proves the release commit reached the default branch. | respected | No tag created; tag reserved for post-Phase-9 merge proof. |
| C6 | constraint | Before changing `~/.config/opencode/package.json` or lock state, preserve non-secret current state in the configured dotfiles backup location and retain unrelated dependencies. | respected | No local config/package manifest change performed before archive. |
| DONT1 | avoidance | Blind repetition of unchanged native edit input. | respected | Recovery wording forbids unchanged retry. |
| DONT2 | avoidance | New plugin tool surface or runtime retry loop. | respected | No new tool or runtime retry in diff. |
| DONT3 | avoidance | Weakening Morph API fallback or safety protections. | respected | Reviewer confirms fallback and safety unchanged. |
| DONT4 | avoidance | Creating a tag or GitHub release from an unmerged feature branch. | respected | No feature-branch tag/release created. |
| DONT5 | avoidance | Updating only the installed package while leaving the configured stable instruction stale. | respected | Local deployed package/instruction intentionally untouched pending post-archive release. |

