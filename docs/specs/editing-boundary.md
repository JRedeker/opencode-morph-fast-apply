# Morph editing boundary

The `morph_edit` tool confines edits to the invoking session's allowed root.
V1 uses the invocation context's worktree root, then its directory, then the
plugin-provided directory when neither context field exists. V2 resolves the
invoking session's directory on every call and fails closed if it is unavailable.
V2 must not substitute the plugin-load directory or process working directory.
Arguments and attached symbols cannot select another root.

The tool blocks read-only agents unless the operator explicitly allows them.
Before writing a merged result, it refuses placeholder-marker leakage,
catastrophic truncation, and the loss of imported identifiers. A refused edit
does not write a file. These boundaries apply to both V1 and V2 registrations.

## Arguments and root refusal

The tool exposes only `target_filepath`, `instructions`, and `code_edit`.
Both adapters reject received `workdir` or `taskId` properties before file I/O
or API calls, including properties whose value is undefined. No capability
symbol can redirect an edit. The ADV capability and optional-argument route is
retired, together with its capability validation and propagation obligations.

Relative targets resolve inside the allowed root. Absolute targets, traversal
and symlinks outside that root stay refused, including sibling worktrees of
the same repository. A session rooted in an ad-hoc worktree can edit inside
that root; starting in the main checkout does not admit its sibling worktrees.

The tool returns a readable result for accepted edits and a specific reason for
refused edits. A root refusal states the allowed root, confirms no write, and
names native `edit` or `apply_patch` with the absolute path as recovery only
when the named tool is exposed and permitted for that target. It warns against
retrying a refused absolute target as a relative path, which can name another file.

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
