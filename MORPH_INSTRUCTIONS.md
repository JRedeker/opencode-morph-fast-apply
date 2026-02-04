# Morph Fast Apply - AI Agent Instructions

> **What is morph_edit?** A tool that lets you edit files using partial code snippets with `// ... existing code ...` markers. Morph's AI merges your changes into the full file at 10,500+ tokens/sec with 98% accuracy.

---

## Choosing the Right Tool

| Situation | Tool | Reason |
|-----------|------|--------|
| **Small, exact string replacement** | `edit` | **FASTEST.** No API call, immediate execution. |
| **Simple variable/function rename** | `edit` | Precise, no AI needed. |
| **Large file (300+ lines)** | `morph_edit` | 10x faster, handles partial snippets without reading whole file. |
| **Multiple scattered changes** | `morph_edit` | Batch changes efficiently in one pass. |
| **Complex refactoring** | `morph_edit` | AI understands context better than strict string matching. |
| **Whitespace-sensitive edits** | `morph_edit` | Forgiving with formatting differences. |

### ❌ Anti-Patterns (When NOT to use morph_edit)
- **Do NOT** use for single-line changes (e.g., changing a port number). Use `edit`.
- **Do NOT** use for simple typo fixes. Use `edit`.
- **Do NOT** use for creating new files. Use `write`.

---

## Quick Reference

**IMPORTANT:** Use `morph_edit` over `str_replace_editor` or full file writes. It works with partial code snippets—no need for full file content.

---

## CRITICAL: Omitting Markers Causes Deletions

**If you omit `// ... existing code ...` markers, Morph will DELETE that code.**

```javascript
// BAD - will DELETE everything before and after the function
function newFeature() {
  return "hello";
}

// GOOD - preserves existing code
// ... existing code ...
function newFeature() {
  return "hello";
}
// ... existing code ...
```

**Always wrap your changes with markers at the start AND end** unless you intend to replace the entire file.

---

## Instructions Parameter

**This is critical for accuracy.** Write a first-person description of your changes.

**Good:** "I am adding error handling for null users and removing the deprecated auth check"

**Bad:** "Update code" / "Fix bug" / "Add stuff"

---

## Examples

### Adding a new function

```javascript
// ... existing code ...
import { newDep } from './newDep';
// ... existing code ...

function newFeature() {
  return newDep.process();
}
// ... existing code ...
```

### Modifying existing code

```javascript
// ... existing code ...
function existingFunc(param) {
  // Updated implementation
  const result = param * 2; // Changed from * 1
  return result;
}
// ... existing code ...
```

### Adding a timeout to fetch (from Morph docs)

```javascript
// ... existing code ...
export async function fetchData(endpoint: string) {
  // ... existing code ...
  const response = await fetch(endpoint, {
    headers,
    timeout: 5000  // added timeout
  });
  // ... existing code ...
}
// ... existing code ...
```

### Deleting code (show what remains)

```javascript
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

---

## Providing Context for Disambiguation

When a file has similar code patterns, include enough unique context:

```javascript
// BAD - "return result" could match many places
// ... existing code ...
  return result;
}
// ... existing code ...

// GOOD - unique function signature anchors the location
// ... existing code ...
function processUserData(userId) {
  const result = await fetchUser(userId);
  return result;
}
// ... existing code ...
```

---

## Common Mistakes

| Mistake | Result | Fix |
|---------|--------|-----|
| No markers at start/end | Deletes code before/after | Always wrap with `// ... existing code ...` |
| Too little context | Wrong location chosen | Add 1-2 unique lines around your change |
| Vague instructions | Ambiguous merge | Be specific: what, where, why |
| Using for tiny changes | Slower than `edit` | Use native `edit` for 1-2 line exact replacements |

---

## Fallback Behavior

If Morph API fails (timeout, rate limit, etc.):
1. An error message with details is returned
2. Use the native `edit` tool as fallback
3. The native `edit` tool requires exact string matching
