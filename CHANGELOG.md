# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.8.1] - 2026-03-07

### Changed

- **Stable instruction path guidance** — installation docs now prefer `~/.config/opencode/instructions/morph-tools.md` as the primary OpenCode instruction path, with the packaged `node_modules/...` path documented as a fallback for direct installs.
- **Canonical routing policy wording** — `instructions/morph-tools.md` now explicitly documents that `morph_edit` guidance belongs in always-on instructions, not a skill.
- **Documentation alignment** — tests now verify the preferred stable instruction path and the canonical always-on policy language so README/instruction guidance does not drift.

## [1.8.0] - 2026-03-06

### Added

- **Packaged always-on instruction** — `instructions/morph-tools.md` now ships with the plugin so OpenCode can load reliable `morph_edit` tool-selection guidance through the `instructions` array.
- **Packaging coverage** — package metadata now includes the `instructions/` directory and tests verify the shipped instruction path is documented.

### Changed

- **Installation docs** now recommend adding the packaged always-on instruction to global OpenCode config for more reliable `morph_edit` selection.

## [1.7.0] - 2026-03-05

### Changed

- **Self-contained tool description**: All agent guidance (decision table, marker rules, disambiguation, fallback) is now embedded directly in the `morph_edit` tool description. No external skill or instructions file needed.

### Removed

- **Skill pattern**: Deleted `skills/morph/SKILL.md` — the skill added a round-trip and split-brain problem where guidance lived in multiple places
- **Legacy instructions**: Deleted `MORPH_INSTRUCTIONS.md` — redundant with the tool description; the README serves as human-readable docs
- **`MORPH_SKILL_LOAD_HINT` export**: Agents no longer need to load a skill before using `morph_edit`
- **Skill hint test**: Removed the regression test for the now-deleted skill hint

## [1.6.0] - 2026-02-22

### Added

- **Input normalization**: `normalizeCodeEditInput()` strips markdown fences from LLM-wrapped `code_edit` to prevent Morph API confusion
- **Marker leakage guard**: Post-merge validation detects when Morph treats `// ... existing code ...` markers as literal text instead of expanding them — aborts file write and returns actionable error
- **Catastrophic truncation guard**: Dual-metric validation (>60% char loss AND >50% line loss) prevents silent data loss from failed merges
- **Structured error recovery**: Guard failures include specific metrics, explanations, and 3 actionable recovery options
- **TUI titles for guard failures**: `tool.execute.after` hook now shows branded titles like `Morph: blocked (marker leakage)` and `Morph: blocked (truncation)`
- **Test suite**: 32 tests covering normalization, marker leakage logic, and truncation detection edge cases

### Changed

- **`EXISTING_CODE_MARKER` constant**: Extracted to module-level export for consistency and testability
- **Guard logging**: Both post-merge guards emit diagnostic `warn`-level logs before returning errors
- **Hardcoded marker strings**: All references to `"// ... existing code ..."` now use the `EXISTING_CODE_MARKER` constant

## [1.5.0] - 2026-02-04

### Added

- **Custom TUI display**: Uses `tool.execute.after` hook to show branded titles like `Morph: src/file.ts +15/-3 (450ms)`
- **API timing**: Tracks and displays Morph API response time in output
- **Structured metadata**: Adds provider, version, and model info to tool metadata for future TUI enhancements

### Changed

- **Output format**: Now includes API timing in milliseconds for performance visibility

## [1.4.0] - 2026-02-04

### Added

- **Readonly agent protection**: Blocks `morph_edit` in `plan` and `explore` agents to prevent accidental file modifications in read-only modes
- **Environment override**: `MORPH_ALLOW_READONLY_AGENTS=true` to bypass readonly protection when needed
- **Usage guidelines in tool description**: Helps AI choose between `morph_edit` and native `edit` tool

### Changed

- **Structured logging**: Replaced `console.log`/`console.warn` with `client.app.log()` SDK method
- **Stderr fallback**: Falls back to `process.stderr.write()` if SDK logging fails
- **Improved documentation**: Reorganized MORPH_INSTRUCTIONS.md with clearer tool selection guidance

### Fixed

- **JSON output pollution**: Plugin no longer writes to stdout during initialization, fixing compatibility with `opencode export` and other tools that parse JSON output (e.g., tokenscope)

## [1.3.0] - 2025-01-15

### Added

- Pre-flight marker validation to prevent accidental file corruption
- Warning for files >10 lines edited without `// ... existing code ...` markers

### Fixed

- Console warning that leaked into user input area

## [1.2.0] - 2025-01-10

### Changed

- Aligned tool schema with Morph official spec
- Reduced instruction size by 72%

## [1.1.0] - 2025-01-05

### Added

- MIT license
- Improved README for GitHub publication

### Changed

- Updated installation docs to use plugin array config

## [1.0.0] - 2025-01-01

### Added

- Initial release
- Morph Fast Apply API integration
- `morph_edit` tool for efficient partial file edits
- Unified diff output with change statistics
