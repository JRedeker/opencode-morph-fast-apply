# opencode-morph-fast-apply

OpenCode plugin for [Morph Fast Apply](https://morphllm.com) - 10x faster code editing with lazy edit markers.

## Features

- **10,500+ tokens/sec** code editing via Morph's Fast Apply API
- **Lazy edit markers** (`// ... existing code ...`) - no exact string matching needed
- **98% accuracy** with intelligent code merging
- **Unified diff output** with context for easy review
- **Graceful fallback** - suggests native `edit` tool on API failure

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/JRedeker/opencode-morph-fast-apply.git ~/dev/oc-plugins/morph-fast-apply
cd ~/dev/oc-plugins/morph-fast-apply
npm install
```

### 2. Set your Morph API key

Get an API key at [morphllm.com/dashboard](https://morphllm.com/dashboard/api-keys), then add to your shell profile:

```bash
export MORPH_API_KEY="sk-your-key-here"
```

### 3. Add the plugin to your Claude Code config

Add to your global config (`~/.config/Claude/Claude.json`):

```json
{
  "plugin": [
    "/path/to/morph-fast-apply"
  ],
  "instructions": [
    "/path/to/morph-fast-apply/MORPH_INSTRUCTIONS.md"
  ]
}
```

Or in a project-local `.claude/config.json`:

```json
{
  "plugin": [
    "~/dev/oc-plugins/morph-fast-apply"
  ],
  "instructions": [
    "~/dev/oc-plugins/morph-fast-apply/MORPH_INSTRUCTIONS.md"
  ]
}
```

### 4. Restart Claude Code

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

## Changelog

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
