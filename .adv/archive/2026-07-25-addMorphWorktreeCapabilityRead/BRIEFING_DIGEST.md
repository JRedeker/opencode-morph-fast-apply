# Archive Briefing Digest

**Change ID:** addMorphWorktreeCapabilityRead
**Title:** Add morph worktree capability read
**Status:** archived
**Generated:** 2026-07-25T00:30:21.544Z

## Identity Anchors

- CHANGE
- STATUS
- TERMINAL_GATE_SUMMARY

## Archive Digest

**Status:** archived

| Gate | Status |
| --- | --- |
| proposal | done |
| discovery | done |
| design | done |
| planning | done |
| execution | done |
| acceptance | done |
| release | pending |

## Epic Context

No Epic membership

## Durable Facts

Showing 39 of 39 durable facts.

- **[archive_only_evidence]** decisions: Used tool.schema.string().optional() for workdir/taskId args — tool.schema is typeof z (Zod v4) and .optional() is the canonical Zod optional string API; verified by bun run typecheck
- **[archive_only_evidence]** decisions: Avoided importing from any advance package — Constraint in spec; redeclared Symbol.for key and kept all ADV logic in capability symbol shape-validation only
- **[archive_only_evidence]** decisions: Used smoke test + typecheck instead of direct zod safeParse in T3 — zod v4 exposes safeParse as standalone helper and the inferred $ZodType base lacks the method; schema validity is sufficiently covered by typecheck and plugin-load test
- **[archive_only_evidence]** decisions: Did not weaken resolveTargetPath and did not read workdir/taskId inside morph for confinement — Spec requirement: confinement uses only the validated capability symbol root via resolveTargetPath; workdir/taskId are opaque schema fields for ADV dispatch metadata only
- **[archive_only_evidence]** verification: bun test index.test.ts (1) — T1 RED: 1 error (module ./src/adv-capability.js not found) before creating implementation
- **[archive_only_evidence]** verification: bun test index.test.ts (0) — T1 GREEN: 145 pass after creating src/adv-capability.ts
- **[archive_only_evidence]** verification: bun test index.test.ts (1) — T2 RED: capability root not used; in-root target rejected because root fell back to /some-other-project
- **[archive_only_evidence]** verification: bun test index.test.ts (0) — T2 GREEN: 148 pass after wiring readCapabilityRoot into executeMorphEdit
- **[archive_only_evidence]** verification: bun test index.test.ts (1) — T3 RED: morph_edit tool args missing workdir/taskId keys
- **[archive_only_evidence]** verification: bun test index.test.ts (0) — T3 GREEN: 149 pass after adding optional workdir/taskId args to impl.ts
- **[archive_only_evidence]** verification: bun test index.test.ts (1) — T4 RED: readCapabilityRoot stubbed to return null; capability and concurrency tests fail
- **[archive_only_evidence]** verification: bun test index.test.ts (0) — T4 GREEN: 151 pass, 1 skip after restoring readCapabilityRoot
- **[archive_only_evidence]** verification: bun run check (0) — Full check green: typecheck + lint + format:check + test (151 pass, 1 skip, 321 expect calls)
- **[unresolved_action]** consumer_warnings: verification_missing: No durable adv_run_test evidence found for run_id: bash-t1-red
- **[unresolved_action]** consumer_warnings: verification_missing: No durable adv_run_test evidence found for run_id: bash-t1-green
- **[unresolved_action]** consumer_warnings: verification_missing: No durable adv_run_test evidence found for run_id: bash-t2-red
- **[unresolved_action]** consumer_warnings: verification_missing: No durable adv_run_test evidence found for run_id: bash-t2-green
- **[unresolved_action]** consumer_warnings: verification_missing: No durable adv_run_test evidence found for run_id: bash-t3-red
- **[unresolved_action]** consumer_warnings: verification_missing: No durable adv_run_test evidence found for run_id: bash-t3-green
- **[unresolved_action]** consumer_warnings: verification_missing: No durable adv_run_test evidence found for run_id: bash-t4-red
- **[unresolved_action]** consumer_warnings: verification_missing: No durable adv_run_test evidence found for run_id: bash-t4-green
- **[unresolved_action]** consumer_warnings: verification_missing: No durable adv_run_test evidence found for run_id: bash-full-check
- **[report_follow_up]** follow_ups: Packet SCOPE KEY was discovery — OpenCode tool dispatcher "symbol-survival" feasibility; persisted report uses schema-required researcher:opencode-symbol-survival alias.
- **[report_follow_up]** follow_ups: Risk: conclusion limited to standard registered custom tools through SessionTools.resolve. MCP/code-mode paths and future dispatcher refactors may not retain identity. Revalidate after any OpenCode upgrade.
- **[research_citation]** sources: OpenCode v1.18.5 dispatch path: Runs tool.execute.before with { args } then calls item.execute(args, ctx), using the same lexical args binding. (https://github.com/anomalyco/opencode/blob/e5cc278dec9294a627a7b05f47ce6a564408c1a2/packages/opencode/src/session/tools.ts#L98-L119)
- **[research_citation]** sources: OpenCode v1.18.5 custom-tool bridge: Builds z.object(args), validates via zodParams.safeParse(u).success inside Schema.declare, then calls plugin def.execute(args as any, pluginCtx). (https://github.com/anomalyco/opencode/blob/e5cc278dec9294a627a7b05f47ce6a564408c1a2/packages/opencode/src/tool/registry.ts#L121-L157)
- **[research_citation]** sources: Effect Schema.declare implementation: On a passing predicate, Schema.declare returns Effect.succeed(input), preserving the input reference. (https://github.com/Effect-TS/effect/blob/44e85129915dccaa7421ac22d334f6c6be8e073e/packages/effect/src/Schema.ts#L547-L559)
- **[research_citation]** sources.omitted: 3 additional sources omitted (bounded to first 3)
- **[archive_only_evidence]** architecture_assessment: CONFIRMED for OpenCode v1.18.5 custom plugin tools. The dispatcher passes one args reference into the before-hook wrapper and into Tool.Def execution. The custom-tool registry uses Zod safeParse only as a predicate inside Effect Schema.declare; Effect's declaration implementation succeeds with input itself. Therefore a non-enumerable symbol on args survives. This is in-process execution, not serialized between hook and plugin execute.
- **[report_follow_up]** follow_ups: Prompt SCOPE KEY fails report schema; report transport normalized to researcher:design-validation.
- **[report_follow_up]** follow_ups: Episode recall was unrelated and unused.
- **[research_citation]** sources: Approved agreement and design: AC1–AC7, constraints, avoidances, proposed two-tier AC6 reviewed through ADV artifacts. (adv://change/addMorphWorktreeCapabilityRead)
- **[research_citation]** sources: Current path confinement implementation: Existing resolver performs lexical containment and symlink checks. (file:///home/jon/dev/opencode-morph-fast-apply/src/path-confinement.ts)
- **[research_citation]** sources: Current execute implementation: Root is selected per execute call and passed to resolver; no mutable root state. (file:///home/jon/dev/opencode-morph-fast-apply/src/execute.ts)
- **[research_citation]** sources.omitted: 2 additional sources omitted (bounded to first 3)
- **[archive_only_evidence]** architecture_assessment: Core architecture is sound but AC6 is not met: characterization plus a manual checklist cannot prove the installed OpenCode dispatcher transmits capability metadata into plugin execute().
- **[unresolved_action]** validation.blockers: Approved AC6 requires a re-runnable integration test proving a non-enumerable Symbol.for property attached by a tool.execute.before-style hook reaches plugin execute(args) on installed OpenCode. The design explicitly replaces that integration proof with an in-process characterization and a manual upgrade checklist.
- **[unresolved_action]** required_main_agent_actions: Reissue the acceptance-review Context Packet with PHASE: review (scope key review:acceptance, attempt 1).
- **[archive_only_evidence]** verification: tests_run= results=n/a — No repository analysis started: invalid phase identity anchor.

## Contract / AC Coverage

| ID | Kind | Status |
| --- | --- | --- |
| AC1 | acceptance_criterion | pass |
| AC2 | acceptance_criterion | pass |
| AC3 | acceptance_criterion | pass |
| AC4 | acceptance_criterion | pass |
| AC5 | acceptance_criterion | pass |
| AC6 | acceptance_criterion | pass |
| AC7 | acceptance_criterion | pass |
| C1 | constraint | respected |
| C2 | constraint | respected |
| C3 | constraint | respected |
| C4 | constraint | respected |
| C5 | constraint | respected |
| DONT1 | avoidance | respected |
| DONT2 | avoidance | respected |
| DONT3 | avoidance | respected |
| DONT4 | avoidance | respected |
| DONT5 | avoidance | respected |

## Unresolved Actions

- verification_missing: No durable adv_run_test evidence found for run_id: bash-t1-red
- verification_missing: No durable adv_run_test evidence found for run_id: bash-t1-green
- verification_missing: No durable adv_run_test evidence found for run_id: bash-t2-red
- verification_missing: No durable adv_run_test evidence found for run_id: bash-t2-green
- verification_missing: No durable adv_run_test evidence found for run_id: bash-t3-red
- verification_missing: No durable adv_run_test evidence found for run_id: bash-t3-green
- verification_missing: No durable adv_run_test evidence found for run_id: bash-t4-red
- verification_missing: No durable adv_run_test evidence found for run_id: bash-t4-green
- verification_missing: No durable adv_run_test evidence found for run_id: bash-full-check
- Approved AC6 requires a re-runnable integration test proving a non-enumerable Symbol.for property attached by a tool.execute.before-style hook reaches plugin execute(args) on installed OpenCode. The design explicitly replaces that integration proof with an in-process characterization and a manual upgrade checklist.
- Reissue the acceptance-review Context Packet with PHASE: review (scope key review:acceptance, attempt 1).
