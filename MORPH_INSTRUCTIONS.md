# Morph Fast Apply - AI Agent Instructions

> **What is morph_edit?** A tool that lets you edit files using partial code snippets with `// ... existing code ...` markers. Morph's AI merges your changes into the full file at 10,500+ tokens/sec with 98% accuracy.

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

Always wrap your changes with markers at the start and end unless you intend to replace the entire file.

---

## Instructions Parameter

**This is critical for accuracy.** Write a first-person description of your changes.

**Good:** "I am adding error handling for null users and removing the deprecated auth check"

**Bad:** "Update code" / "Fix bug" / "Add stuff"

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
