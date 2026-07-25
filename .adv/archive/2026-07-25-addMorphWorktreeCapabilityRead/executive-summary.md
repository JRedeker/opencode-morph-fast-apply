# Executive Summary — Add morph worktree capability read (Part B)

## Outcome
`morph_edit` (opencode-morph-fast-apply) is now ADV-worktree-capable. It reads the capability symbol ADV attaches to its args after validating `workdir`+`taskId`, and confines edits to `capability.root` when present+valid. Absent or malformed capabilities fall back unchanged to session-root confinement (fail-closed). Delivered in commits `02d0e23` + `589e8e3` on `change/addMorphWorktreeCapabilityRead`.

## Why it matters
Before Part B, `morph_edit` rejected every ADV per-change worktree path ("Path is outside allowed root") because it confined to the session repo and never read the capability. ADV agents had to fall back to `edit`/`write` for worktree edits (Part A corrected the directives accordingly). Part B makes `morph_edit` itself worktree-capable, restoring the fast-apply path inside ADV worktrees — the original reason the plugin exists.

## What was built
- **`src/adv-capability.ts`** (new): `ADV_MORPH_WORKTREE_CAPABILITY` (= `Symbol.for("advance.morph-worktree-capability.v1")`, redeclared — no ADV import) + `readCapabilityRoot(args): string | null` — shape-validates the attached `{root}` (non-null object, root a non-empty absolute string), fail-closed on any malformed value including a throwing accessor/Proxy (try/catch). Lexical validation; relies on ADV attaching an already-canonical root.
- **`src/execute.ts`**: `readCapabilityRoot` injected into the runtime; root precedence `readCapabilityRoot(args) ?? context.worktree ?? context.directory ?? directory`; `resolveTargetPath` reused unchanged.
- **`impl.ts`**: optional model-visible `workdir`/`taskId` zod args (so ADV's before-hook can read+validate them); `readCapabilityRoot` wired into the production runtime. morph never reads `workdir`/`taskId` for confinement.
- **Tests**: readCapabilityRoot unit (incl. throwing-accessor fail-closed); executeMorphEdit capability (AC1 real `resolveTargetPath` in-root/out-of-root, AC2 no-cap, AC3 malformed→session-root); schema load (AC4); true-concurrent independent roots (AC5, `Promise.all`); AC6 Tier1 characterization (symbol survives the real execute reference path, dropped by spread/`Object.assign`) + Tier2 documented upgrade checklist.

## Verification
- **Tests**: `bun run check` green — 152 pass, 1 intentional skip, 0 fail; typecheck + lint + format:check pass. Durable `adv_run_test` green recorded per task + full-suite.
- **Review**: independent `adv-reviewer` acceptance review — **PASS**; remediated a throwing-accessor fail-closed gap and strengthened AC5/AC6 tests (committed `589e8e3`). No scope drift.
- **Feasibility**: symbol-survival through OpenCode's dispatcher sourced-confirmed from `sst/opencode` v1.18.5 (custom-tool path forwards the same args reference; Effect `Schema.declare` returns the original input, not a clone; zod `safeParse` is a boolean gate only). v1.18.4→1.18.5 no dispatcher drift.

## Risks / follow-ups
- **Undocumented impl dependency**: symbol-survival relies on OpenCode forwarding the same args reference (not cloning). Guarded by AC6 Tier1 (deterministic characterization test) + Tier2 (documented manual upgrade check against the installed `opencode` binary). Re-verify on OpenCode upgrades.
- **Custom-tool dispatch path only**: the guarantee is specific to host custom-tool dispatch; MCP/code-mode paths are out of scope (morph_edit is a host custom-tool).
- **End-to-end with ADV**: not exercised in isolation here; ADV Part A (`advance/fixMorphWorktreeAuthorization`, shipped) owns the validator + honest directive that consumes this capability.
- **Trust boundary**: `Symbol.for` is global/non-secret; model JSON cannot forge symbols; ADV throws before attaching on `workdir`/`taskId` mismatch. Only a forged in-process plugin symbol could abuse it — trusts ADV/plugin-runtime, not mutually-hostile plugins (documented).

## Release readiness
Self-contained plugin change; no migration, no data impact, no ops dependency. Backward-compatible (optional args; absence = unchanged behavior). Safe to release pending cross-project integration validation with ADV Part A on upgrade.