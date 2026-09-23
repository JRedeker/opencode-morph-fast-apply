# Morph editing boundary

The `morph_edit` tool edits a file only inside the directory of the invoking
OpenCode session. An authorized ADV worktree capability can select its validated
worktree root instead. The plugin must not use the plugin-load directory or the
process working directory as a substitute for the invoking session's directory.

The tool blocks read-only agents unless the operator explicitly allows them.
Before writing a merged result, it refuses placeholder-marker leakage,
catastrophic truncation, and the loss of imported identifiers. A refused edit
does not write a file. These boundaries apply to both V1 and V2 registrations.

The tool returns a readable result for accepted edits and a specific reason for
refused edits. Its interface retains the `target_filepath`, `instructions`,
`code_edit`, `workdir`, and `taskId` arguments.
