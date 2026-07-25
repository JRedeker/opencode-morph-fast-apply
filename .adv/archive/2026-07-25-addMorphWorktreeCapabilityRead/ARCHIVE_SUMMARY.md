# Archive: Add morph worktree capability read

**Change ID:** addMorphWorktreeCapabilityRead
**Archived:** 2026-07-25T00:30:21.534Z
**Created:** 2026-07-24T21:42:09.009Z

## Tasks Completed

- ✅ Create `src/adv-capability.ts` — the ADV worktree capability symbol constant + reader.
  > Task checkpoint completed
- ✅ Wire the capability reader into `executeMorphEdit` so a valid ADV capability root overrides session-root confinement; absence/malformed falls back unchanged.
  > Task checkpoint completed
- ✅ Add the concurrency test (AC5) and the two-tier runtime integration guard (AC6).
  > Task checkpoint completed
- ✅ Expose optional model-visible `workdir`/`taskId` in the morph_edit schema and wire the real `readCapabilityRoot` into the runtime injection.
  > Task checkpoint completed
- ✅ Run the full existing test suite + typecheck/lint and confirm zero regressions after all capability changes land.
  > Task checkpoint completed

## Specs Modified

