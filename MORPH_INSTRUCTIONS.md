# Morph Fast Apply - Tool Selection Guide

When editing code files, choose the appropriate tool based on the situation:

## Tool Selection Matrix

| Situation | Tool | Reason |
|-----------|------|--------|
| Small, exact string replacement | `edit` | Fast, precise, no API call |
| Large file (500+ lines) | `morph_edit` | 10x faster, handles partial snippets |
| Multiple scattered changes | `morph_edit` | Batch changes efficiently |
| Complex refactoring | `morph_edit` | Better accuracy with context |
| Whitespace-sensitive edits | `morph_edit` | Forgiving with formatting |
| New file creation | `write` | Standard file creation |

## Using morph_edit

The `morph_edit` tool uses **lazy edit markers** to represent unchanged code:

```javascript
// ... existing code ...
function updatedFunction() {
  // New implementation
  return "modified";
}
// ... existing code ...
```

### Parameters

- `target_filepath`: Path to the file (relative to project root)
- `instructions`: Brief description of changes (helps AI disambiguate)
- `code_edit`: Code with `// ... existing code ...` markers

### Rules

1. **ALWAYS** use `// ... existing code ...` for unchanged sections
2. Include **minimal context** around edits for precise location
3. Preserve **exact indentation** in your code snippets
4. For **deletions**: show context before/after, omit the deleted lines
5. **Batch** multiple edits to the same file in one call

### Examples

**Adding a function:**
```
// ... existing code ...
import { newDep } from './newDep';
// ... existing code ...

function newFeature() {
  return newDep.process();
}
// ... existing code ...
```

**Modifying existing code:**
```
// ... existing code ...
function existingFunc(param) {
  // Updated implementation
  const result = param * 2; // Changed from * 1
  return result;
}
// ... existing code ...
```

**Deleting code (show what remains):**
```
// ... existing code ...
function keepThis() {
  return "stays";
}

// The function between these two was removed

function alsoKeepThis() {
  return "also stays";
}
// ... existing code ...
```

## Fallback Behavior

If Morph API fails (timeout, rate limit, etc.), the tool will:
1. Return an error message with details
2. Suggest using the native `edit` tool as fallback
3. The native `edit` tool requires exact string matching

## When NOT to Use morph_edit

- Simple one-line changes (use `edit`)
- New file creation (use `write`)
- When you have the exact text to match (use `edit` for speed)
- When Morph API is unavailable (fall back to `edit`)
