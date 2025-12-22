# opencode-morph-fast-apply

OpenCode plugin for [Morph Fast Apply](https://morphllm.com) - 10x faster code editing with lazy edit markers.

## Features

- **10,500+ tokens/sec** code editing via Morph's Fast Apply API
- **Lazy edit markers** (`// ... existing code ...`) - no exact string matching needed
- **Unified diff output** with context for easy review
- **Graceful fallback** - suggests native `edit` tool on API failure

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/JRedeker/opencode-morph-fast-apply.git ~/.config/opencode/plugin/morph-fast-apply
cd ~/.config/opencode/plugin/morph-fast-apply
npm install
```

### 2. Set your Morph API key

Get an API key at [morphllm.com/dashboard](https://morphllm.com/dashboard/api-keys), then add to your shell profile:

```bash
export MORPH_API_KEY="sk-your-key-here"
```

### 3. Link the plugin

```bash
ln -s ~/.config/opencode/plugin/morph-fast-apply/index.ts ~/.config/opencode/plugin/morph-fast-apply.ts
```

### 4. Add instructions (recommended)

Add the tool selection guide to your OpenCode config:

```json
{
  "instructions": [
    "~/.config/opencode/plugin/morph-fast-apply/MORPH_INSTRUCTIONS.md"
  ]
}
```

### 5. Restart OpenCode

The `morph_edit` tool will now be available.

## Usage

The LLM can use `morph_edit` for efficient partial file edits:

```
morph_edit({
  target_filepath: "src/auth.ts",
  instructions: "Add error handling for invalid tokens",
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
| `MORPH_MODEL` | `morph-v3-fast` | Model (`morph-v3-fast`, `morph-v3-large`, `auto`) |
| `MORPH_TIMEOUT` | `30000` | Request timeout in ms |

## How It Works

1. Reads the original file content
2. Sends `<instruction>`, `<code>`, and `<update>` to Morph API
3. Morph intelligently merges the lazy edit markers with original code
4. Writes the merged result back to the file
5. Returns a unified diff showing what changed

## Contributing

Contributions welcome! This plugin could potentially be integrated into OpenCode core.

## License

[MIT](LICENSE)
