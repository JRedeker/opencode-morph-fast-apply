# Contract Traceability

**Change ID:** addMorphWorktreeCapabilityRead
**Contract Version:** 1
**Rigor:** standard
**Reviewed:** 2026-07-25T00:24:52.900Z

## Contract Items

| ID | Kind | Status | Evidence Policy | Evidence |
| --- | --- | --- | --- | --- |
| AC1 | acceptance_criterion | pass | test | index.test.ts:1948 AC1 test uses real resolveTargetPath + mkdtempSync worktree; in-root target_filepath succeeds ('Created new file'), out-of-root /etc/passwd rejected ('outside allowed root'). Reviewer PASS. |
| AC2 | acceptance_criterion | pass | test | index.test.ts:1970 AC2: no capability symbol -> resolveTargetPath receives session directory '/project'; existing tests unmodified. |
| AC3 | acceptance_criterion | pass | test | index.test.ts:1992 + :1925: malformed capabilities (relative root, non-object, throwing accessor) fall back to session root, no expansion. readCapabilityRoot fail-closed try/catch (src/adv-capability.ts:16). |
| AC4 | acceptance_criterion | pass | test | index.test.ts:2034: plugin loads with workdir+taskId args present; tool.schema.string().optional() validated by bun run typecheck. impl.ts:296. |
| AC5 | acceptance_criterion | pass | test | index.test.ts:2090: Promise.all concurrent calls with /wt-a and /wt-b -> recording resolveTargetPath captures each root independently. Per-call, no shared state. |
| AC6 | acceptance_criterion | pass | test | index.test.ts:2102 Tier1: symbol survives real executeMorphEdit reference path (capturedRoots==['/x']); dropped by {...args} and Object.assign({},args). Tier2 upgrade checklist documented (test.skip :2108). |
| AC7 | acceptance_criterion | pass | test | Full bun run check green: 152 pass, 1 skip, 0 fail; typecheck+lint+format pass (adv_run_test tr_mrzm6x47_0f2ed1f1). No regressions. |
| C1 | constraint | respected | static_check | No 'advance' import anywhere (git grep confirmed empty). src/adv-capability.ts:4 redeclares Symbol.for('advance.morph-worktree-capability.v1'). |
| C2 | constraint | respected | static_check | src/path-confinement.ts untouched in diff; resolveTargetPath reused, only root arg differs (src/execute.ts:113). |
| C3 | constraint | respected | static_check | morph_edit is a host custom-tool plugin; no MCP/code-mode dispatch handling added. Symbol-survival scoped to custom-tool path. |
| C4 | constraint | respected | static_check | package.json dependencies unchanged; only node:path (stdlib) used in adv-capability.ts. |
| C5 | constraint | respected | static_check | execute.ts/adv-capability.ts never read workdir/taskId for root derivation; morph trusts only the validated symbol root (readCapabilityRoot). Lexical validation relies on ADV canonicalization (documented). |
| DONT1 | avoidance | respected | review | resolveTargetPath symlink/containment defenses unchanged; capability only swaps which root is passed. No weakened checks. |
| DONT2 | avoidance | respected | review | No cross-package import; symbol key redeclared as global string. |
| DONT3 | avoidance | respected | review | morph ignores model workdir/taskId values; they exist only for ADV before-hook validation. |
| DONT4 | avoidance | respected | review | No MCP/code-mode scope or hostile-plugin resistance added; trust boundary documented. |
| DONT5 | avoidance | respected | review | Capability read is structural confinement with deterministic fail-closed (shape-validation + try/catch), not a heuristic control. |

## Task References

| Task | Implements | Verifies | Respects | N/A Reason |
| --- | --- | --- | --- | --- |
| tk-cde864a6cfe8 |  | AC3 | C1, DONT2, DONT5 |  |
| tk-87d31cafb202 |  | AC1, AC2, AC3 | C2, DONT1 |  |
| tk-bc175731b67f |  | AC5, AC6 | DONT5 |  |
| tk-cd5e6076ba4a |  | AC4 | C5, DONT3 |  |
| tk-e98b9aaa1a66 |  | AC7 |  |  |
