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

## Result contract

`executeMorphEdit` returns `{ status, code, truncated, text }`. Consumers branch
on `status` and `code`, not the human-readable `text`:

- `success`: a file was created or edited; `code` is `null`.
- `refused`: an input or safety guard blocked the edit; no write was attempted.
  Codes: `readonly_agent`, `path_refused`, `file_not_found`, `missing_markers`,
  `marker_leakage`, `catastrophic_truncation`, `dropped_imports`.
- `error`: configuration, file I/O, API, or adapter failure. Codes:
  `missing_api_key`, `read_failed`, `write_failed`, `api_timeout`,
  `api_http_error`, `api_parse_error`, `api_request_failed`, `api_empty_response`,
  `invalid_arguments`, `session_unavailable`. A write failure does not guarantee
  that the filesystem remains unchanged.

`truncated` is always a boolean. It is true only when the displayed diff exceeds
3,000 JavaScript string units and is shortened. The file receives the full merged
content. A refused destructive merge uses `code: "catastrophic_truncation"` and
`truncated: false`; that flag describes the response, not lost file content.

V1 returns the readable text as `output` with `status`, `code`, and `truncated`
in `metadata`. V2 returns the full result in its schema-declared `output`, the
readable text in `content`, and the same three metadata fields. Both after-hooks
preserve those fields while adding display metadata. Host argument-validation
errors that occur before the plugin executes remain host-owned errors.
