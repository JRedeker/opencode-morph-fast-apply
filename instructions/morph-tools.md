# morph_edit Tool Selection Policy

This instruction is designed to be always loaded by OpenCode so agents reliably
choose `morph_edit` when it is the better editing tool.

This file is the canonical always-on routing policy for `morph_edit`. Keep it in
the `instructions` array, not in a skill, so agents do not need an extra load
step before choosing the right editing tool.

## Code Editing Tool Selection (Critical)

Use the right editing tool for the job. `morph_edit` is not the default for all
edits, but it SHOULD be preferred for edits where partial-snippet merging is
faster or more reliable than exact-string replacement.

### First-Action Policy

| Editing task | First tool | Why |
|---|---|---|
| Large file edits (300+ lines) | `morph_edit` | Avoids fragile exact-string matching |
| Multiple scattered changes in one file | `morph_edit` | Batch edits efficiently |
| Whitespace-sensitive edits | `morph_edit` | More forgiving with formatting/context |
| Complex refactors inside an existing file | `morph_edit` | Better partial-file merge behavior |
| Small exact replacement | `edit` | Faster, local, no API call |
| Single-line rename/fix | `edit` | Simpler exact replacement |
| New file creation | `write` | `morph_edit` only edits existing files |

### When NOT to Use morph_edit

- The change is a small exact `oldString` -> `newString` replacement
- You are creating a brand new file
- The current agent is readonly and cannot edit files
- `MORPH_API_KEY` is not configured; fall back to native `edit`

### Fallback Policy

- If `morph_edit` fails due to API error or timeout, use native `edit`
- If `morph_edit` is blocked in readonly agents, switch to a write-capable agent
- If the change requires replacing the entire file, use `write`

### Setup Notes

- Preferred instruction path: `~/.config/opencode/instructions/morph-tools.md`
- Packaged fallback path: `~/.config/opencode/node_modules/opencode-morph-fast-apply/instructions/morph-tools.md`
- The `morph_edit` tool description is self-contained, but loading this file as an always-on instruction makes tool choice more reliable

### Tool Exposure Requirement

Instruction policy is necessary but not sufficient. The active agent or
sub-agent must also expose `morph_edit` in its tool manifest.

- If an agent profile sets `morph_edit: false` or omits the tool, the model
  cannot choose Morph even when this instruction is loaded.
- Enable `morph_edit: true` for write-capable agents that should use Morph for
  large or scattered edits.
- Keep readonly agents blocked unless you explicitly want them to edit files.

### Anti-Patterns

- Do NOT use `edit` first for large, scattered, or whitespace-sensitive edits
- Do NOT use `morph_edit` for creating new files
- Do NOT force `morph_edit` from readonly agents unless explicitly configured
