# opencode-morph-fast-apply

OpenCode plugin for [Morph Fast Apply](https://morphllm.com) - 10x faster code editing with lazy edit markers.

## Features

- **10,500+ tokens/sec** code editing via Morph's Fast Apply API
- **Lazy edit markers** (`// ... existing code ...`) - no exact string matching needed
- **98% accuracy** with intelligent code merging
- **Pre-flight validation** - prevents accidental file deletions when markers are missing
- **Unified diff output** with context for easy review
- **Custom TUI display** - branded titles like `Morph: src/file.ts +15/-3 (450ms)`
- **Graceful fallback** - suggests native `edit` tool on API failure

> **Note:** This is an OpenCode plugin that wraps Morph's Fast Apply API. For the official Morph MCP server (which includes WarpGrep search), see [@morphllm/morphmcp](https://www.npmjs.com/package/@morphllm/morphmcp). This plugin uses `morph_edit` as the tool name to avoid conflicts if you have both installed.

## Installation

### 1. Add the plugin to your OpenCode config

Add to your global config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": [
    "github:JRedeker/opencode-morph-fast-apply"
  ],
  "instructions": [
    "~/.config/opencode/node_modules/opencode-morph-fast-apply/MORPH_INSTRUCTIONS.md"
  ]
}
```

Or pin to a specific version:

```json
{
  "plugin": [
    "github:JRedeker/opencode-morph-fast-apply#v1.5.0"
  ]
}
```

For project-local config (`.opencode/opencode.json`):

```json
{
  "plugin": [
    "github:JRedeker/opencode-morph-fast-apply"
  ],
  "instructions": [
    ".opencode/node_modules/opencode-morph-fast-apply/MORPH_INSTRUCTIONS.md"
  ]
}
```

### 2. Set your Morph API key

Get an API key at [morphllm.com/dashboard](https://morphllm.com/dashboard/api-keys), then add to your shell profile:

```bash
export MORPH_API_KEY="sk-your-key-here"
```

### 3. Restart OpenCode

The `morph_edit` tool will now be available.

## Usage

The LLM uses `morph_edit` for efficient partial file edits:

```
morph_edit({
  target_filepath: "src/auth.ts",
  instructions: "I am adding error handling for invalid tokens",
  code_edit: `// ... existing code ...
function validateToken(token) {
  if (!token) {
    throw new Error("Token is required");
  }
  // ... existing code ...
}
// ... existing code ...`
})
```

> **Important:** See [MORPH_INSTRUCTIONS.md](./MORPH_INSTRUCTIONS.md) for detailed AI agent guidelines.

### When to use `morph_edit` vs `edit`

| Situation | Tool | Reason |
|-----------|------|--------|
| Small, exact replacement | `edit` | Fast, no API call |
| Large file (500+ lines) | `morph_edit` | Handles partial snippets |
| Multiple scattered changes | `morph_edit` | Batch efficiently |
| Whitespace-sensitive | `morph_edit` | Forgiving with formatting |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MORPH_API_KEY` | (required) | Your Morph API key |
| `MORPH_API_URL` | `https://api.morphllm.com` | API endpoint |
| `MORPH_MODEL` | `morph-v3-fast` | Model to use (see below) |
| `MORPH_TIMEOUT` | `30000` | Request timeout in ms |

### Available Models

| Model | Speed | Accuracy | Best For |
|-------|-------|----------|----------|
| `morph-v3-fast` | 10,500+ tok/sec | 96% | Real-time applications, quick edits |
| `morph-v3-large` | 5,000+ tok/sec | 98% | Complex changes, highest accuracy |
| `auto` | 5,000-10,500 tok/sec | ~98% | Recommended - automatically selects optimal model |

## How It Works

1. Reads the original file content
2. Sends to Morph API:
   - `<instruction>` - Your intent description
   - `<code>` - The complete original file  
   - `<update>` - Your partial edit with markers
3. Morph intelligently merges the lazy edit markers with original code
4. Writes the merged result back to the file
5. Returns a unified diff showing what changed

## Troubleshooting

### "MORPH_API_KEY not configured"

Ensure the environment variable is set and exported:
```bash
echo $MORPH_API_KEY  # Should show your key
```

### Timeout errors

Increase the timeout for large files:
```bash
export MORPH_TIMEOUT=60000  # 60 seconds
```

### Unexpected deletions

If code is being deleted unexpectedly, ensure your `code_edit` includes `// ... existing code ...` markers at the start and end. Omitting these markers tells Morph to replace the entire file.

### Wrong edit location

If edits are applied to the wrong location, add more unique context around your changes and make your `instructions` more specific about which function/section you're modifying.

### Tool blocked in plan/explore mode

The `morph_edit` tool is disabled in readonly agent modes (`plan`, `explore`). Switch to a build/code mode to make edits.

## Changelog

### v1.5.0

- **Custom TUI display** - Tool output shows branded titles like `Morph: src/file.ts +15/-3 (450ms)`
- **API timing** - Response time tracked and displayed in tool title
- **Structured metadata** - Provider, version, model info included for future TUI enhancements

### v1.4.0

- **Fixed stdout pollution** - Replaced `console.log`/`console.warn` with `client.app.log()` SDK method
- **Readonly agent protection** - Blocks `morph_edit` in `plan` and `explore` modes to prevent accidental edits
- **Stderr fallback** - Graceful logging if SDK method unavailable

### v1.3.0

- **Pre-flight validation prevents accidental deletions** - Tool now returns an error if `code_edit` is missing markers for files >10 lines, preventing catastrophic code loss
- **Improved code_edit parameter description** - Changed from "Only the changed lines" to "The code changes wrapped with markers" to emphasize wrapping
- **Added explicit wrapping rule** - Tool description now includes "ALWAYS wrap your changes with markers at the start AND end"
- **Restored comprehensive examples** - `MORPH_INSTRUCTIONS.md` now includes all key examples (adding functions, modifying code, deletions)
- **Added Quick Reference** - Aligned with Morph's official agent instructions format
- **Added fetch timeout example** - From official Morph documentation

### v1.2.0

- **Tool schema aligned with Morph official spec** - Tool description now matches [Morph's recommended format](https://docs.morphllm.com/quickstart)
- **Concise AI agent instructions** - `MORPH_INSTRUCTIONS.md` reduced by 72% (237→67 lines) while keeping critical guidance
- **Added marker validation warning** - Server logs warn when `code_edit` is missing markers (helps debug unexpected deletions)
- **Documentation improvements** - Added troubleshooting section, model comparison table, updated config paths

### v1.1.0

- Initial public release
- Morph Fast Apply integration with lazy edit markers
- Unified diff output
- Graceful fallback suggestions

## Contributing

Contributions welcome! This plugin could potentially be integrated into OpenCode core.

## License

[MIT](LICENSE)
