import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXISTING_CODE_MARKER } from "./src/constants.js";
import {
  extractImportedIdentifiers,
  findDroppedIdentifiers,
} from "./src/imports.js";
import { normalizeCodeEditInput } from "./src/normalize.js";

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
    expect(content).toContain("Tool Exposure Requirement");
    expect(content).toContain("morph_edit: true");
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
    expect(content).toContain("tool manifest");
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

describe("extractImportedIdentifiers", () => {
  test("extracts Python from-import identifiers", () => {
    const code = "from asyncpg import PostgresError\nfrom services.ops import DataOps";
    const ids = extractImportedIdentifiers(code, "svc.py");
    expect(ids).toContain("PostgresError");
    expect(ids).toContain("DataOps");
  });

  test("extracts Python bare import identifiers", () => {
    const code = "import os\nimport sys";
    const ids = extractImportedIdentifiers(code, "svc.py");
    expect(ids).toContain("os");
    expect(ids).toContain("sys");
  });

  test("extracts Python from-import with as alias (uses original name)", () => {
    const code = "from typing import List as TList";
    const ids = extractImportedIdentifiers(code, "svc.py");
    expect(ids).toContain("TList");
  });

  test("ignores Python star imports", () => {
    const code = "from os import *";
    const ids = extractImportedIdentifiers(code, "svc.py");
    expect(ids).toEqual([]);
  });

  test("extracts TypeScript named imports", () => {
    const code = 'import { Router, Request } from "express";';
    const ids = extractImportedIdentifiers(code, "app.ts");
    expect(ids).toContain("Router");
    expect(ids).toContain("Request");
  });

  test("extracts TypeScript default import", () => {
    const code = 'import React from "react";';
    const ids = extractImportedIdentifiers(code, "app.tsx");
    expect(ids).toContain("React");
  });

  test("extracts TypeScript namespace import", () => {
    const code = 'import * as fs from "fs";';
    const ids = extractImportedIdentifiers(code, "app.ts");
    expect(ids).toContain("fs");
  });

  test("extracts TypeScript require destructure", () => {
    const code = 'const { parse } = require("path");';
    const ids = extractImportedIdentifiers(code, "app.js");
    expect(ids).toContain("parse");
  });

  test("extracts TypeScript require assignment", () => {
    const code = 'const express = require("express");';
    const ids = extractImportedIdentifiers(code, "app.cjs");
    expect(ids).toContain("express");
  });

  test("extracts Go import with alias", () => {
    const code = 'import http "net/http"';
    const ids = extractImportedIdentifiers(code, "main.go");
    expect(ids).toContain("http");
  });

  test("extracts Go import without alias (last path segment)", () => {
    const code = 'import "fmt"';
    const ids = extractImportedIdentifiers(code, "main.go");
    expect(ids).toContain("fmt");
  });

  test("extracts Rust use statement", () => {
    const code = "use std::collections::HashMap;\nuse tokio::io::{AsyncRead, AsyncWrite};";
    const ids = extractImportedIdentifiers(code, "main.rs");
    expect(ids).toContain("HashMap");
    expect(ids).toContain("AsyncRead");
    expect(ids).toContain("AsyncWrite");
  });

  test("extracts Java import", () => {
    const code = "import java.util.ArrayList;\nimport static org.junit.Assert.*;";
    const ids = extractImportedIdentifiers(code, "App.java");
    expect(ids).toContain("ArrayList");
  });

  test("extracts C include", () => {
    const code = '#include <stdio.h>\n#include "myheader.h"';
    const ids = extractImportedIdentifiers(code, "main.c");
    expect(ids).toContain("stdio");
    expect(ids).toContain("myheader");
  });

  test("extracts C# using statement", () => {
    const code = "using System.Collections.Generic;\nusing static System.Math;";
    const ids = extractImportedIdentifiers(code, "Program.cs");
    expect(ids).toContain("Generic");
  });

  test("returns empty for unrecognized extension", () => {
    const code = "some random text";
    const ids = extractImportedIdentifiers(code, "readme.txt");
    expect(ids).toEqual([]);
  });

  test("deduplicates identifiers", () => {
    const code = 'import { Router } from "express";\nimport { Router } from "express";';
    const ids = extractImportedIdentifiers(code, "app.ts");
    expect(ids.filter((id) => id === "Router")).toHaveLength(1);
  });

  test("skips comment lines", () => {
    const code = '// import { Fake } from "nowhere";\nimport { Real } from "somewhere";';
    const ids = extractImportedIdentifiers(code, "app.ts");
    expect(ids).toContain("Real");
    expect(ids).not.toContain("Fake");
  });
});

describe("findDroppedIdentifiers", () => {
  test("detects dropped Python imports", () => {
    const original = [
      "from asyncpg import PostgresError",
      "from services.ops import DataOps, QueryBuilder",
      "",
      "async def main():",
      "    pass",
    ].join("\n");

    // Simulate Morph dropping imports — identifiers not present anywhere
    const merged = [
      "async def main():",
      "    pass",
    ].join("\n");

    const dropped = findDroppedIdentifiers(original, merged, "svc.py");
    expect(dropped).toContain("PostgresError");
    expect(dropped).toContain("DataOps");
  });

  test("returns empty when all imports preserved", () => {
    const original = [
      "from asyncpg import PostgresError",
      "from services.ops import DataOps",
      "",
      "async def main():",
      "    pass",
    ].join("\n");

    const merged = original + "\n    # added line\n";

    const dropped = findDroppedIdentifiers(original, merged, "svc.py");
    expect(dropped).toEqual([]);
  });

  test("does not flag identifiers that are used but not imported", () => {
    // If an identifier appears in the merged code (even if import was dropped
    // but the identifier is used inline), it should NOT be flagged
    const original = 'import { Router } from "express";\nconst app = Router();';
    const merged = "// import dropped\nconst app = Router();";

    const dropped = findDroppedIdentifiers(original, merged, "app.ts");
    // Router still appears in merged code (in the usage)
    expect(dropped).toEqual([]);
  });

  test("flags identifier dropped from import and not used elsewhere", () => {
    const original = 'import { Router, Request, Response } from "express";\nconst app = Router();';
    const merged = 'import { Router } from "express";\nconst app = Router();';
    // Request and Response are in original but not in merged
    const dropped = findDroppedIdentifiers(original, merged, "app.ts");
    expect(dropped).toContain("Request");
    expect(dropped).toContain("Response");
  });

  test("returns empty for files with no imports", () => {
    const original = "function foo() { return 1; }";
    const merged = "function foo() { return 2; }";
    const dropped = findDroppedIdentifiers(original, merged, "app.ts");
    expect(dropped).toEqual([]);
  });

  test("handles the exact scenario from issue #5", () => {
    // Simulated 1370-line Python file with top-level imports
    const originalImports = [
      "from asyncpg import PostgresError",
      "from services.ops.data_operations_service import (",
      "    DataOperationsService,",
      "    QueryBuilder,",
      "    ResultMapper,",
      ")",
    ].join("\n");
    const originalBody = Array.from({ length: 1360 }, (_, i) => `# line ${i + 30}`).join("\n");
    const original = originalImports + "\n" + originalBody;

    // Morph drops the import block silently
    const merged = Array.from({ length: 1360 }, (_, i) => `# line ${i + 30}`).join("\n");

    const dropped = findDroppedIdentifiers(original, merged, "service.py");
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped).toContain("PostgresError");
    expect(dropped).toContain("DataOperationsService");
    expect(dropped).toContain("QueryBuilder");
    expect(dropped).toContain("ResultMapper");
  });
});

import { resolveTargetPath } from "./src/path-confinement.js";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, rmSync } from "node:fs";

describe("resolveTargetPath", () => {
  let tmpDir: string;
  let root: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "morph-pc-test-"));
    root = join(tmpDir, "root");
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("allows relative path inside root", () => {
    const result = resolveTargetPath("src/foo.ts", root);
    expect("path" in result).toBe(true);
    if ("path" in result) {
      expect(result.path).toBe(join(root, "src", "foo.ts"));
    }
  });

  test("rejects absolute path outside root", () => {
    const result = resolveTargetPath("/etc/passwd", root);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("outside");
    }
  });

  test("rejects relative path with ../ escape", () => {
    const result = resolveTargetPath("../escape.txt", root);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("outside");
    }
  });

  test("rejects sibling-prefix /root vs /rootEvil", () => {
    // Create /rootEvil sibling
    const evilRoot = join(tmpDir, "rootEvil");
    mkdirSync(evilRoot, { recursive: true });
    // If root is /tmp/.../root, a path like ../rootEvil/file should NOT be allowed
    const result = resolveTargetPath("../rootEvil/file.txt", root);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("outside");
    }
  });

  test("allows absolute path inside root", () => {
    const innerPath = join(root, "deep", "file.ts");
    const result = resolveTargetPath(innerPath, root);
    expect("path" in result).toBe(true);
    if ("path" in result) {
      expect(result.path).toBe(innerPath);
    }
  });

  test("rejects absolute path that is sibling prefix", () => {
    // root = /tmp/.../root
    // /tmp/.../rootEvil/file should be rejected
    const evilPath = join(tmpDir, "rootEvil", "file.txt");
    const result = resolveTargetPath(evilPath, root);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("outside");
    }
  });

  test("existing target follows symlinks and rejects if outside root", () => {
    const evilDir = join(tmpDir, "evil");
    mkdirSync(evilDir, { recursive: true });
    writeFileSync(join(evilDir, "secret.txt"), "secret");
    // Create symlink inside root pointing outside
    symlinkSync(evilDir, join(root, "link-out"));
    const result = resolveTargetPath(join(root, "link-out", "secret.txt"), root, {
      targetExists: true,
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("outside");
    }
  });

  test("existing target allows symlink inside root", () => {
    const realDir = join(root, "real-dir");
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, "file.txt"), "hello");
    symlinkSync(realDir, join(root, "link-in"));
    const result = resolveTargetPath(join(root, "link-in", "file.txt"), root, {
      targetExists: true,
    });
    expect("path" in result).toBe(true);
    if ("path" in result) {
      expect(result.path).toBe(join(realDir, "file.txt"));
    }
  });

  test("new target rejects when nearest existing parent is symlink outside root", () => {
    const evilDir = join(tmpDir, "evil");
    mkdirSync(evilDir, { recursive: true });
    symlinkSync(evilDir, join(root, "link-out"));
    const result = resolveTargetPath(join(root, "link-out", "new-file.txt"), root, {
      targetExists: false,
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("outside");
    }
  });

  test("new target allows when nearest existing parent is real directory inside root", () => {
    const subDir = join(root, "sub");
    mkdirSync(subDir, { recursive: true });
    const result = resolveTargetPath(join(root, "sub", "new", "file.txt"), root, {
      targetExists: false,
    });
    expect("path" in result).toBe(true);
    if ("path" in result) {
      expect(result.path).toBe(join(root, "sub", "new", "file.txt"));
    }
  });

  test("allows root itself as target path", () => {
    const result = resolveTargetPath(root, root);
    expect("path" in result).toBe(true);
    if ("path" in result) {
      expect(result.path).toBe(root);
    }
  });

  test("rejects path with double-dot mid-segment", () => {
    const result = resolveTargetPath("foo/../../escape.txt", root);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("outside");
    }
  });
});
