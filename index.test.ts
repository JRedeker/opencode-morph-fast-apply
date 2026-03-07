import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// These are internal to the plugin but duplicated here for testing.
// Keep in sync with index.ts.
const EXISTING_CODE_MARKER = "// ... existing code ...";

function normalizeCodeEditInput(codeEdit: string): string {
  const trimmed = codeEdit.trim();
  const lines = trimmed.split("\n");
  if (lines.length < 3) return codeEdit;
  const firstLine = lines[0];
  const lastLine = lines[lines.length - 1];
  if (/^```[\w-]*$/.test(firstLine!) && /^```$/.test(lastLine!)) {
    return lines.slice(1, -1).join("\n");
  }
  return codeEdit;
}

describe("EXISTING_CODE_MARKER", () => {
  test("is the canonical marker string", () => {
    expect(EXISTING_CODE_MARKER).toBe("// ... existing code ...");
  });
});

describe("packaged tool-selection instructions", () => {
  test("instruction file exists and routes large edits to morph_edit", () => {
    const content = readFileSync(
      join(import.meta.dir, "instructions", "morph-tools.md"),
      "utf-8",
    );

    expect(content).toContain("morph_edit Tool Selection Policy");
    expect(content).toContain("canonical always-on routing policy");
    expect(content).toContain("~/.config/opencode/instructions/morph-tools.md");
    expect(content).toContain("Large file edits (300+ lines)");
    expect(content).toContain("`morph_edit`");
    expect(content).toContain("Small exact replacement");
    expect(content).toContain("`edit`");
    expect(content).toContain("New file creation");
    expect(content).toContain("`write`");
  });

  test("README documents packaged instruction path", () => {
    const content = readFileSync(join(import.meta.dir, "README.md"), "utf-8");

    expect(content).toContain(
      "~/.config/opencode/instructions/morph-tools.md",
    );
    expect(content).toContain(
      "~/.config/opencode/node_modules/opencode-morph-fast-apply/instructions/morph-tools.md",
    );
    expect(content).toContain("always-on instruction file");
  });
});

describe("normalizeCodeEditInput", () => {
  test("returns plain code unchanged", () => {
    const input = `${EXISTING_CODE_MARKER}\nfunction foo() { return 1 }\n${EXISTING_CODE_MARKER}`;
    expect(normalizeCodeEditInput(input)).toBe(input);
  });

  test("strips standard markdown fence with language", () => {
    const input = "```typescript\nfunction foo() { return 1 }\n```";
    expect(normalizeCodeEditInput(input)).toBe("function foo() { return 1 }");
  });

  test("strips markdown fence without language", () => {
    const input = "```\nfunction foo() { return 1 }\n```";
    expect(normalizeCodeEditInput(input)).toBe("function foo() { return 1 }");
  });

  test("preserves multi-line content inside fences", () => {
    const inner = `${EXISTING_CODE_MARKER}\nfunction foo() {\n  return 1\n}\n${EXISTING_CODE_MARKER}`;
    const input = `\`\`\`typescript\n${inner}\n\`\`\``;
    expect(normalizeCodeEditInput(input)).toBe(inner);
  });

  test("does not strip incomplete fences (missing closing)", () => {
    const input = "```typescript\nfunction foo() { return 1 }";
    expect(normalizeCodeEditInput(input)).toBe(input);
  });

  test("does not strip incomplete fences (missing opening)", () => {
    const input = "function foo() { return 1 }\n```";
    expect(normalizeCodeEditInput(input)).toBe(input);
  });

  test("returns short input unchanged (< 3 lines)", () => {
    expect(normalizeCodeEditInput("hello")).toBe("hello");
    expect(normalizeCodeEditInput("line1\nline2")).toBe("line1\nline2");
  });

  test("handles fence with hyphenated language", () => {
    const input = "```c-sharp\nConsole.WriteLine();\n```";
    expect(normalizeCodeEditInput(input)).toBe("Console.WriteLine();");
  });

  test("does not strip fences with text after closing", () => {
    const input = "```typescript\nfoo()\n``` extra text";
    expect(normalizeCodeEditInput(input)).toBe(input);
  });

  test("trims whitespace before checking fences", () => {
    const input = "  \n```typescript\nfunction foo() {}\n```\n  ";
    expect(normalizeCodeEditInput(input)).toBe("function foo() {}");
  });

  test("returns empty string unchanged", () => {
    expect(normalizeCodeEditInput("")).toBe("");
  });

  test("handles fence with only whitespace content", () => {
    const input = "```\n  \n```";
    expect(normalizeCodeEditInput(input)).toBe("  ");
  });

  test("handles javascript language tag", () => {
    const input = "```javascript\nconst x = 1;\n```";
    expect(normalizeCodeEditInput(input)).toBe("const x = 1;");
  });

  test("handles python language tag", () => {
    const input = "```python\ndef foo():\n    pass\n```";
    expect(normalizeCodeEditInput(input)).toBe("def foo():\n    pass");
  });

  test("does not strip if closing fence has language", () => {
    // Invalid markdown: closing fence should not have a language
    const input = "```typescript\nfoo()\n```typescript";
    expect(normalizeCodeEditInput(input)).toBe(input);
  });

  test("preserves content with backticks inside fences", () => {
    const input = "```typescript\nconst x = `hello ${world}`;\n```";
    expect(normalizeCodeEditInput(input)).toBe("const x = `hello ${world}`;");
  });
});

describe("marker leakage detection logic", () => {
  test("detected when original lacks marker", () => {
    const originalCode = "function foo() { return 1 }";
    const mergedCode = `function foo() { return 1 }\n${EXISTING_CODE_MARKER}\nfunction bar() {}`;
    const hasMarkers = true;
    const originalHadMarker = originalCode.includes(EXISTING_CODE_MARKER);

    const wouldTrigger =
      hasMarkers &&
      !originalHadMarker &&
      mergedCode.includes(EXISTING_CODE_MARKER);
    expect(wouldTrigger).toBe(true);
  });

  test("skipped when original already contains marker", () => {
    const originalCode = `// Use "${EXISTING_CODE_MARKER}" to represent unchanged code`;
    const mergedCode = `// Use "${EXISTING_CODE_MARKER}" to represent unchanged code\n// Added line`;
    const hasMarkers = true;
    const originalHadMarker = originalCode.includes(EXISTING_CODE_MARKER);

    const wouldTrigger =
      hasMarkers &&
      !originalHadMarker &&
      mergedCode.includes(EXISTING_CODE_MARKER);
    expect(wouldTrigger).toBe(false);
  });

  test("not triggered when no markers in input", () => {
    const originalCode = "function foo() { return 1 }";
    const mergedCode = `function foo() { return 1 }\n${EXISTING_CODE_MARKER}`;
    const hasMarkers = false;

    const wouldTrigger =
      hasMarkers && mergedCode.includes(EXISTING_CODE_MARKER);
    expect(wouldTrigger).toBe(false);
  });

  test("detected when marker appears at start of merged output", () => {
    const originalCode = "const x = 1;\nconst y = 2;";
    const mergedCode = `${EXISTING_CODE_MARKER}\nconst x = 1;\nconst y = 2;`;
    const hasMarkers = true;
    const originalHadMarker = originalCode.includes(EXISTING_CODE_MARKER);

    const wouldTrigger =
      hasMarkers &&
      !originalHadMarker &&
      mergedCode.includes(EXISTING_CODE_MARKER);
    expect(wouldTrigger).toBe(true);
  });

  test("detected when marker appears at end of merged output", () => {
    const originalCode = "const x = 1;\nconst y = 2;";
    const mergedCode = `const x = 1;\nconst y = 2;\n${EXISTING_CODE_MARKER}`;
    const hasMarkers = true;
    const originalHadMarker = originalCode.includes(EXISTING_CODE_MARKER);

    const wouldTrigger =
      hasMarkers &&
      !originalHadMarker &&
      mergedCode.includes(EXISTING_CODE_MARKER);
    expect(wouldTrigger).toBe(true);
  });

  test("not triggered on clean merge (no markers in output)", () => {
    const originalCode = "function foo() { return 1 }";
    const mergedCode = "function foo() { return 2 }";
    const hasMarkers = true;
    const originalHadMarker = originalCode.includes(EXISTING_CODE_MARKER);

    const wouldTrigger =
      hasMarkers &&
      !originalHadMarker &&
      mergedCode.includes(EXISTING_CODE_MARKER);
    expect(wouldTrigger).toBe(false);
  });
});

describe("truncation detection logic", () => {
  // Helper to simulate the guard condition
  function wouldTriggerTruncation(
    originalCode: string,
    mergedCode: string,
    hasMarkers: boolean,
  ): { triggered: boolean; charLoss: number; lineLoss: number } {
    const originalLineCount = originalCode.split("\n").length;
    const mergedLineCount = mergedCode.split("\n").length;
    const charLoss =
      (originalCode.length - mergedCode.length) / originalCode.length;
    const lineLoss = (originalLineCount - mergedLineCount) / originalLineCount;
    return {
      triggered: hasMarkers && charLoss > 0.6 && lineLoss > 0.5,
      charLoss,
      lineLoss,
    };
  }

  test("triggers when both char and line loss exceed thresholds", () => {
    const originalCode = "x".repeat(1000) + "\n".repeat(100);
    const mergedCode = "x".repeat(300) + "\n".repeat(40);

    const result = wouldTriggerTruncation(originalCode, mergedCode, true);
    expect(result.triggered).toBe(true);
  });

  test("does not trigger when only char loss exceeds threshold", () => {
    // Lots of char loss but lines stay similar (whitespace removal)
    const originalCode = "x    ".repeat(200) + "\n".repeat(50);
    const mergedCode = "x".repeat(200) + "\n".repeat(50);

    const result = wouldTriggerTruncation(originalCode, mergedCode, true);
    expect(result.triggered).toBe(false);
    expect(result.lineLoss).toBeLessThanOrEqual(0.5);
  });

  test("does not trigger when only line loss exceeds threshold", () => {
    // Lines shrunk but chars stayed similar (joined multi-line to single-line)
    const lines = Array.from({ length: 100 }, () => "ab").join("\n");
    const joined = Array.from({ length: 40 }, () => "ab".repeat(3)).join("\n");

    const result = wouldTriggerTruncation(lines, joined, true);
    expect(result.triggered).toBe(false);
    expect(result.charLoss).toBeLessThanOrEqual(0.6);
  });

  test("does not trigger when no markers in input", () => {
    const originalCode = "x".repeat(1000) + "\n".repeat(100);
    const mergedCode = "x".repeat(100);

    const result = wouldTriggerTruncation(originalCode, mergedCode, false);
    expect(result.triggered).toBe(false);
  });

  test("does not trigger when file grows (negative loss)", () => {
    const originalCode = "short\nfile\n";
    const mergedCode = "short\nfile\nwith\nmany\nnew\nlines\nadded\nhere\n";

    const result = wouldTriggerTruncation(originalCode, mergedCode, true);
    expect(result.triggered).toBe(false);
    expect(result.charLoss).toBeLessThan(0);
    expect(result.lineLoss).toBeLessThan(0);
  });

  test("does not trigger on empty original file", () => {
    const originalCode = "";
    const mergedCode = "new content";

    // Edge: division by zero for charLoss/lineLoss produces NaN/Infinity
    const originalLineCount = originalCode.split("\n").length;
    const mergedLineCount = mergedCode.split("\n").length;
    const charLoss =
      (originalCode.length - mergedCode.length) / originalCode.length;
    const lineLoss = (originalLineCount - mergedLineCount) / originalLineCount;

    // NaN > 0.6 is false, so this should NOT trigger
    const triggered = true && charLoss > 0.6 && lineLoss > 0.5;
    expect(triggered).toBe(false);
  });

  test("triggers just above both thresholds", () => {
    // original: 1000 chars, merged: 390 chars → charLoss = 0.61
    // original: 100 lines, merged: 49 lines → lineLoss = 0.51
    const originalCode = "x".repeat(900) + "\n".repeat(100);
    const mergedCode = "x".repeat(341) + "\n".repeat(49);

    const result = wouldTriggerTruncation(originalCode, mergedCode, true);
    expect(result.charLoss).toBeGreaterThan(0.6);
    expect(result.lineLoss).toBeGreaterThan(0.5);
    expect(result.triggered).toBe(true);
  });

  test("does not trigger when just below char threshold", () => {
    // original: 1000 chars, merged: 401 chars → charLoss = 0.599
    // original: 100 lines, merged: 10 lines → lineLoss = 0.90
    const originalCode = "x".repeat(900) + "\n".repeat(100);
    const mergedCode = "x".repeat(391) + "\n".repeat(10);

    const result = wouldTriggerTruncation(originalCode, mergedCode, true);
    expect(result.charLoss).toBeLessThanOrEqual(0.6);
    expect(result.triggered).toBe(false);
  });

  test("handles single-line file correctly", () => {
    const originalCode = "x".repeat(100);
    const mergedCode = "x".repeat(10);

    const result = wouldTriggerTruncation(originalCode, mergedCode, true);
    // lineLoss = (1-1)/1 = 0, which is below 0.5
    expect(result.lineLoss).toBe(0);
    expect(result.triggered).toBe(false);
  });
});
