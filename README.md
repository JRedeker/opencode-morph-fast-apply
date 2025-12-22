# OpenCode Morph Fast Apply Plugin

Integrates [Morph's Fast Apply API](https://morphllm.com) for 10x faster code editing in OpenCode.

## Features

- **10,500+ tokens/sec** code editing speed
- **Lazy edit markers** - no need for exact string matching
- **Automatic fallback** to native `edit` tool on failure
- **Diff summary** after each edit

## Installation

### 1. Install Dependencies

```bash
cd ~/dev/oc-plugins/morph-fast-apply
bun install
```

### 2. Set Environment Variable

Add `MORPH_API_KEY` to your environment. Get one at [morphllm.com/dashboard](https://morphllm.com/dashboard/api-keys).

If using with Jarvis/MCPM, the key is already configured in the server config.

### 3. Link Plugin to OpenCode

**Option A: Global (recommended)**

Create a symlink in OpenCode's global plugin directory:

```bash
mkdir -p ~/.config/opencode/plugin
ln -s ~/dev/oc-plugins/morph-fast-apply/index.ts ~/.config/opencode/plugin/morph-fast-apply.ts
```

**Option B: Project-local**

Create a symlink in your project's `.opencode/plugin/` directory:

```bash
mkdir -p .opencode/plugin
ln -s ~/dev/oc-plugins/morph-fast-apply/index.ts .opencode/plugin/morph-fast-apply.ts
```

### 4. Copy Instructions (Optional)

Copy the tool selection guide to your project's AGENTS.md or global config:

```bash
cat ~/dev/oc-plugins/morph-fast-apply/MORPH_INSTRUCTIONS.md >> AGENTS.md
```

## Usage

Once installed, OpenCode will have access to the `morph_edit` tool. Use it like:

```
Use morph_edit to add error handling to the authentication function in src/auth.ts
```

The tool accepts:
- `target_filepath`: Path to the file
- `instructions`: Brief description of changes
- `code_edit`: Code with `// ... existing code ...` markers

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MORPH_API_KEY` | (required) | Your Morph API key |
| `MORPH_API_URL` | `https://api.morphllm.com` | API endpoint |
| `MORPH_MODEL` | `morph-v3-fast` | Model to use |
| `MORPH_TIMEOUT` | `30000` | Timeout in ms |

## How It Works

1. Reads the original file
2. Sends original code + lazy edit to Morph API
3. Morph merges the changes intelligently
4. Writes the result back to the file
5. Returns a diff summary

## Troubleshooting

### "MORPH_API_KEY not set"

Set the environment variable:
```bash
export MORPH_API_KEY=sk-xxx
```

Or add to your shell profile.

### "Morph API timeout"

Increase timeout:
```bash
export MORPH_TIMEOUT=60000
```

### Tool not appearing in OpenCode

1. Check the symlink exists: `ls -la ~/.config/opencode/plugin/`
2. Restart OpenCode
3. Check for TypeScript errors: `bun run typecheck`

## License

MIT
