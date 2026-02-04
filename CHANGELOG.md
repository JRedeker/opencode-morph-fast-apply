# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
