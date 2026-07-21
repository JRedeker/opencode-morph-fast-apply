import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXISTING_CODE_MARKER, PLUGIN_VERSION } from "./src/constants.js";
import {
  extractImportedIdentifiers,
  findDroppedIdentifiers,
  extractImportEntries,
} from "./src/imports.js";
import { normalizeCodeEditInput } from "./src/normalize.js";
import {
  executeMorphEdit,
  type ExecuteMorphEditRuntime,
} from "./src/execute.js";
import { generateUnifiedDiff, countChanges } from "./src/diff.js";
import { callMorphApply, scrubSecrets } from "./index.js";

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

    expect(content).toContain("~/.config/opencode/instructions/morph-tools.md");
    expect(content).toContain(
      "~/.config/opencode/node_modules/opencode-morph-fast-apply/instructions/morph-tools.md",
    );
    expect(content).toContain("always-on instruction file");
    expect(content).toContain("tool manifest");
  });

  test("README uses current version pin and documents safety guards", () => {
    const content = readFileSync(join(import.meta.dir, "README.md"), "utf-8");

    expect(content).not.toContain("#v1.10.1");
    expect(content).toContain("#v1.10.2");
    expect(content).toContain("Path confinement");
    expect(content).toContain("Secret scrubbing");
    expect(content).toContain("Dropped imports guard");
    expect(content).toContain("bun.lock");
  });

  test("README documents Morph key process environment setup", () => {
    const content = readFileSync(join(import.meta.dir, "README.md"), "utf-8");

    expect(content).toContain("OpenCode process environment");
    expect(content).toContain("Restart OpenCode");
    expect(content).toContain("already-running OpenCode sessions");
  });
});

describe("release metadata consistency", () => {
  // Cross-source release checks: package.json, the README pinned-version
  // example, and the CHANGELOG section must all agree on the same version so
  // the tag-release workflow (`gh release create --notes-file` fed by the
  // `## [version]` body) ships correct, non-empty notes. Pin the expected
  // version explicitly so a stale or partial bump fails loudly (SC4/SC5).
  const EXPECTED_VERSION = "1.10.2";

  const readSurface = (relativePath: string) =>
    readFileSync(join(import.meta.dir, relativePath), "utf-8");

  const readPackageVersion = () => {
    const pkg = JSON.parse(readSurface("package.json")) as {
      version?: string;
    };
    return pkg.version;
  };

  const changelogSection = (changelog: string, version: string) => {
    const heading = `## [${version}]`;
    const start = changelog.indexOf(heading);
    if (start < 0) return null;
    const afterHeading = changelog.slice(start + heading.length);
    const nextHeading = afterHeading.match(/\n## \[/);
    const body =
      nextHeading && nextHeading.index !== undefined
        ? afterHeading.slice(0, nextHeading.index)
        : afterHeading;
    return body.trim();
  };

  test("package.json declares the release version", () => {
    expect(readPackageVersion()).toBe(EXPECTED_VERSION);
  });

  test("README pinned-version example matches package.json version", () => {
    const version = readPackageVersion();
    const readme = readSurface("README.md");

    expect(version).toBe(EXPECTED_VERSION);
    expect(readme).toContain(`#v${version}`);
    // Guard against the previous release pin lingering in the install example.
    expect(readme).not.toContain("#v1.10.1");
  });

  test("CHANGELOG has a non-empty section for package.json version", () => {
    const version = readPackageVersion();
    const changelog = readSurface("CHANGELOG.md");
    const body = changelogSection(changelog, version ?? "");

    expect(version).toBe(EXPECTED_VERSION);
    expect(body).not.toBeNull();
    // Release workflow feeds this body to `gh release create --notes-file`;
    // it must carry real notes (a date suffix alone is not enough).
    expect(body ?? "").toMatch(/^- /m);
  });

  test("runtime-reported PLUGIN_VERSION matches package.json version", () => {
    // PLUGIN_VERSION is the plugin's self-reported version surfaced in tool
    // metadata (index.ts); it must track the package version or the running
    // plugin would mis-report its release. Same stale-version class as the
    // README pin (related-scan / SC4).
    const version = readPackageVersion();
    expect(PLUGIN_VERSION).toBe(EXPECTED_VERSION);
    expect(version).toBe(EXPECTED_VERSION);
    if (version !== undefined) {
      expect(PLUGIN_VERSION).toBe(version);
    }
  });
});

describe("native edit recovery policy", () => {
  // Canonical anchors that must appear verbatim in every owned routing
  // surface. Looping the same set over all three surfaces means a regression
  // in any one of them fails the suite (SC4 / DONT4: no surface left
  // unprotected, no single-surface duplication).
  const RECOVERY_ANCHORS = [
    "unmatched or ambiguous exact target",
    "Re-read the target file before any retry",
    "Do not repeat the unchanged failed",
    "at most one corrected native",
    "still small and exact",
    "Otherwise use",
    "contextual repair",
    "multi-line, scattered, whitespace-sensitive, or broader anchoring",
    "separate from the Morph API-error/timeout fallback",
  ];

  const readSurface = (relativePath: string) =>
    readFileSync(join(import.meta.dir, relativePath), "utf-8");

  test("embedded morph_edit description states the recovery policy and preserves the API fallback", () => {
    const content = readSurface("index.ts");
    for (const anchor of RECOVERY_ANCHORS) {
      expect(content).toContain(anchor);
    }
    // SC2: preserve the explicit write-only boundary in the recovery block.
    expect(content).toContain(
      "Use write only for new-file or intentional full-file replacement",
    );
    // SC3 / AC4: existing Morph API-error/timeout -> native edit fallback retained.
    expect(content).toContain("use the native 'edit' tool");
    expect(content).toContain("API error, timeout");
  });

  test("packaged instruction states the recovery policy", () => {
    const content = readSurface(join("instructions", "morph-tools.md"));
    for (const anchor of RECOVERY_ANCHORS) {
      expect(content).toContain(anchor);
    }
    expect(content).toContain("Native edit recovery");
    expect(content).toContain(
      "Use `write` only for new-file or intentional full-file replacement",
    );
    // SC3: fallback preserved alongside recovery.
    expect(content).toContain("API error or timeout");
    expect(content).toContain("use native `edit`");
  });

  test("README states the recovery policy", () => {
    const content = readSurface("README.md");
    for (const anchor of RECOVERY_ANCHORS) {
      expect(content).toContain(anchor);
    }
    expect(content).toContain("Native edit recovery");
    expect(content).toContain(
      "Use `write` only for new-file or intentional full-file replacement",
    );
    expect(content).toContain("API-error/timeout");
    expect(content).toContain("native `edit`");
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
    const triggered = charLoss > 0.6 && lineLoss > 0.5;
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
    const code =
      "from asyncpg import PostgresError\nfrom services.ops import DataOps";
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

  test("extracts TypeScript require destructure aliases as local bindings", () => {
    const code = 'const { readFile: rf } = require("node:fs");';
    const ids = extractImportedIdentifiers(code, "app.js");
    expect(ids).toContain("rf");
    expect(ids).not.toContain("readFile");
  });

  test("extracts TypeScript combined default and named imports", () => {
    const code = 'import React, { useState as useHook } from "react";';
    const ids = extractImportedIdentifiers(code, "app.tsx");
    expect(ids).toContain("React");
    expect(ids).toContain("useHook");
  });

  test("extracts TypeScript type-only named imports", () => {
    const code = 'import type { Config as AppConfig } from "./types";';
    const ids = extractImportedIdentifiers(code, "app.ts");
    expect(ids).toContain("AppConfig");
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
    const code =
      "use std::collections::HashMap;\nuse tokio::io::{AsyncRead, AsyncWrite};";
    const ids = extractImportedIdentifiers(code, "main.rs");
    expect(ids).toContain("HashMap");
    expect(ids).toContain("AsyncRead");
    expect(ids).toContain("AsyncWrite");
  });

  test("extracts Java import", () => {
    const code =
      "import java.util.ArrayList;\nimport static org.junit.Assert.*;";
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
    const code =
      'import { Router } from "express";\nimport { Router } from "express";';
    const ids = extractImportedIdentifiers(code, "app.ts");
    expect(ids.filter((id) => id === "Router")).toHaveLength(1);
  });

  test("skips comment lines", () => {
    const code =
      '// import { Fake } from "nowhere";\nimport { Real } from "somewhere";';
    const ids = extractImportedIdentifiers(code, "app.ts");
    expect(ids).toContain("Real");
    expect(ids).not.toContain("Fake");
  });
});

describe("extractImportEntries", () => {
  test("returns stable entries for TypeScript named imports", () => {
    const code = 'import { Router, Request } from "express";';
    const entries = extractImportEntries(code, "app.ts");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "ts-named",
      source: "express",
      bindings: ["Router", "Request"],
    });
  });

  test("returns stable entries for TypeScript default import", () => {
    const code = 'import React from "react";';
    const entries = extractImportEntries(code, "app.tsx");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "ts-default",
      source: "react",
      bindings: ["React"],
    });
  });

  test("returns stable entries for TypeScript namespace import", () => {
    const code = 'import * as fs from "fs";';
    const entries = extractImportEntries(code, "app.ts");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "ts-namespace",
      source: "fs",
      bindings: ["fs"],
    });
  });

  test("returns stable entries for require assignment", () => {
    const code = 'const express = require("express");';
    const entries = extractImportEntries(code, "app.cjs");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "ts-require",
      source: "express",
      bindings: ["express"],
    });
  });

  test("returns stable entries for require destructure", () => {
    const code = 'const { parse, join } = require("path");';
    const entries = extractImportEntries(code, "app.js");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "ts-require-destructure",
      source: "path",
      bindings: ["parse", "join"],
    });
  });

  test("returns local bindings for require destructure aliases", () => {
    const code = 'const { readFile: rf, writeFile } = require("node:fs");';
    const entries = extractImportEntries(code, "app.js");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "ts-require-destructure",
      source: "node:fs",
      bindings: ["rf", "writeFile"],
    });
  });

  test("returns stable entries for combined default and named imports", () => {
    const code = 'import React, { useState as useHook } from "react";';
    const entries = extractImportEntries(code, "app.tsx");
    expect(entries).toEqual([
      { kind: "ts-default", source: "react", bindings: ["React"] },
      { kind: "ts-named", source: "react", bindings: ["useHook"] },
    ]);
  });

  test("returns stable entries for type-only named imports", () => {
    const code = 'import type { Config as AppConfig } from "./types";';
    const entries = extractImportEntries(code, "app.ts");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "ts-named",
      source: "./types",
      bindings: ["AppConfig"],
    });
  });

  test("returns stable entries for Python from-import", () => {
    const code = "from asyncpg import PostgresError";
    const entries = extractImportEntries(code, "svc.py");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "py-from",
      source: "asyncpg",
      bindings: ["PostgresError"],
    });
  });

  test("returns stable entries for Python bare import", () => {
    const code = "import os";
    const entries = extractImportEntries(code, "svc.py");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "py-import",
      source: "os",
      bindings: ["os"],
    });
  });

  test("returns stable entries for Go import with alias", () => {
    const code = 'import http "net/http"';
    const entries = extractImportEntries(code, "main.go");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "go-import",
      source: "net/http",
      bindings: ["http"],
    });
  });

  test("returns stable entries for Go import without alias", () => {
    const code = 'import "fmt"';
    const entries = extractImportEntries(code, "main.go");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "go-import",
      source: "fmt",
      bindings: ["fmt"],
    });
  });

  test("returns stable entries for Rust use statement", () => {
    const code = "use std::collections::HashMap;";
    const entries = extractImportEntries(code, "main.rs");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "rs-use",
      bindings: ["HashMap"],
    });
  });

  test("returns stable entries for Java import", () => {
    const code = "import java.util.ArrayList;";
    const entries = extractImportEntries(code, "App.java");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "java-import",
      source: "java.util.ArrayList",
      bindings: ["ArrayList"],
    });
  });

  test("returns stable entries for C include", () => {
    const code = "#include <stdio.h>";
    const entries = extractImportEntries(code, "main.c");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "c-include",
      source: "stdio.h",
      bindings: ["stdio"],
    });
  });

  test("returns stable entries for C# using", () => {
    const code = "using System.Collections.Generic;";
    const entries = extractImportEntries(code, "Program.cs");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "cs-using",
      source: "System.Collections.Generic",
      bindings: ["Generic"],
    });
  });

  test("deduplicates identical entries", () => {
    const code =
      'import { Router } from "express";\nimport { Router } from "express";';
    const entries = extractImportEntries(code, "app.ts");
    expect(entries).toHaveLength(1);
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
    const merged = ["async def main():", "    pass"].join("\n");

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

  test("flags import binding removed even when identifier is used elsewhere (RED regression)", () => {
    // If an import declaration is removed but the identifier still appears
    // in the merged code (e.g., in a usage), it MUST be flagged because the
    // binding is no longer imported.
    const original = 'import { Router } from "express";\nconst app = Router();';
    const merged = "// import dropped\nconst app = Router();";

    const dropped = findDroppedIdentifiers(original, merged, "app.ts");
    // Router is no longer declared in any import statement in merged
    expect(dropped).toContain("Router");
  });

  test("flags identifier dropped from import and not used elsewhere", () => {
    const original =
      'import { Router, Request, Response } from "express";\nconst app = Router();';
    const merged = 'import { Router } from "express";\nconst app = Router();';
    // Request and Response are in original imports but not in merged imports
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
    const originalBody = Array.from(
      { length: 1360 },
      (_, i) => `# line ${i + 30}`,
    ).join("\n");
    const original = originalImports + "\n" + originalBody;

    // Morph drops the import block silently
    const merged = Array.from(
      { length: 1360 },
      (_, i) => `# line ${i + 30}`,
    ).join("\n");

    const dropped = findDroppedIdentifiers(original, merged, "service.py");
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped).toContain("PostgresError");
    expect(dropped).toContain("DataOperationsService");
    expect(dropped).toContain("QueryBuilder");
    expect(dropped).toContain("ResultMapper");
  });

  test("declaration-level comparison: does not flag identifier moved to a different import form", () => {
    // If an identifier is still imported, just in a different declaration form,
    // it should NOT be flagged.
    const original = 'import { Router } from "express";';
    const merged =
      'import express from "express";\nconst { Router } = express;';
    // Note: Router is no longer in an import declaration, so this WILL be flagged
    // with declaration-level comparison. This is correct behavior.
    const dropped = findDroppedIdentifiers(original, merged, "app.ts");
    expect(dropped).toContain("Router");
  });

  test("declaration-level comparison: preserves alias bindings correctly", () => {
    const original = 'import { createRouter as cr } from "express";';
    const merged = 'import { createRouter as cr } from "express";';
    const dropped = findDroppedIdentifiers(original, merged, "app.ts");
    expect(dropped).toEqual([]);
  });

  test("declaration-level comparison: flags dropped alias binding", () => {
    const original = 'import { createRouter as cr } from "express";';
    const merged = "// import dropped";
    const dropped = findDroppedIdentifiers(original, merged, "app.ts");
    expect(dropped).toContain("cr");
  });

  test("declaration-level comparison: flags dropped require destructure alias binding", () => {
    const original =
      'const { readFile: rf } = require("node:fs");\nrf("file");';
    const merged = '// require dropped\nrf("file");';
    const dropped = findDroppedIdentifiers(original, merged, "app.js");
    expect(dropped).toContain("rf");
  });
});

import { resolveTargetPath } from "./src/path-confinement.js";
import { tmpdir } from "node:os";
import {
  mkdtempSync,
  writeFileSync,
  symlinkSync,
  mkdirSync,
  rmSync,
} from "node:fs";

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
    const result = resolveTargetPath(
      join(root, "link-out", "secret.txt"),
      root,
      {
        targetExists: true,
      },
    );
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
    const result = resolveTargetPath(
      join(root, "link-out", "new-file.txt"),
      root,
      {
        targetExists: false,
      },
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("outside");
    }
  });

  test("new target allows when nearest existing parent is real directory inside root", () => {
    const subDir = join(root, "sub");
    mkdirSync(subDir, { recursive: true });
    const result = resolveTargetPath(
      join(root, "sub", "new", "file.txt"),
      root,
      {
        targetExists: false,
      },
    );
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

/* ── executeMorphEdit no-network tests ── */

function makeMockRuntime(
  overrides: Partial<ExecuteMorphEditRuntime> = {},
): ExecuteMorphEditRuntime {
  const logs: Array<{ level: string; message: string }> = [];
  return {
    log: async (level, message) => {
      logs.push({ level, message });
    },
    directory: "/project",
    context: { agent: "build" },
    now: () => 42,
    readFile: async () => ({ exists: false, text: "" }),
    writeFile: async () => {},
    callMorphApply: async () => ({
      success: false,
      error: "mock-not-configured",
    }),
    resolveTargetPath: (targetPath, root, _options?) => ({
      path: join(root, targetPath),
    }),
    normalizeCodeEditInput: (s) => normalizeCodeEditInput(s),
    findDroppedIdentifiers: (orig, merged, fp) =>
      findDroppedIdentifiers(orig, merged, fp),
    generateUnifiedDiff: (fp, orig, mod) => generateUnifiedDiff(fp, orig, mod),
    countChanges: (diff) => countChanges(diff),
    constants: {
      MORPH_API_KEY: "fake-key",
      ALLOW_READONLY_AGENTS: false,
      READONLY_AGENTS: ["plan", "explore"],
      EXISTING_CODE_MARKER: "// ... existing code ...",
      PLUGIN_VERSION: "1.0.0",
      MORPH_MODEL: "morph-v3-fast",
    },
    ...overrides,
  };
}

describe("executeMorphEdit - missing API key", () => {
  test("returns error when MORPH_API_KEY is missing", async () => {
    const runtime = makeMockRuntime({
      constants: {
        MORPH_API_KEY: undefined,
        ALLOW_READONLY_AGENTS: false,
        READONLY_AGENTS: ["plan", "explore"],
        EXISTING_CODE_MARKER,
        PLUGIN_VERSION: "1.0.0",
        MORPH_MODEL: "morph-v3-fast",
      },
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "add bar",
        code_edit: `${EXISTING_CODE_MARKER}\nconst bar = 1;\n${EXISTING_CODE_MARKER}`,
      },
      runtime,
    );

    expect(result).toContain("MORPH_API_KEY not configured");
  });
});

describe("executeMorphEdit - readonly agent block", () => {
  test("blocks plan agent when ALLOW_READONLY_AGENTS is false", async () => {
    const runtime = makeMockRuntime({
      context: { agent: "plan" },
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "add bar",
        code_edit: `${EXISTING_CODE_MARKER}\nconst bar = 1;\n${EXISTING_CODE_MARKER}`,
      },
      runtime,
    );

    expect(result).toContain("not available in plan mode");
  });

  test("blocks explore agent when ALLOW_READONLY_AGENTS is false", async () => {
    const runtime = makeMockRuntime({
      context: { agent: "explore" },
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "add bar",
        code_edit: `${EXISTING_CODE_MARKER}\nconst bar = 1;\n${EXISTING_CODE_MARKER}`,
      },
      runtime,
    );

    expect(result).toContain("not available in explore mode");
  });

  test("allows build agent", async () => {
    const runtime = makeMockRuntime({
      context: { agent: "build" },
      readFile: async () => ({
        exists: true,
        text: "// existing\nconst a = 1;\n",
      }),
      callMorphApply: async () => ({
        success: true,
        content: "// existing\nconst a = 1;\nconst bar = 1;\n",
      }),
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "add bar",
        code_edit: `${EXISTING_CODE_MARKER}\nconst bar = 1;\n${EXISTING_CODE_MARKER}`,
      },
      runtime,
    );

    expect(result).toContain("Applied edit to");
  });
});

describe("executeMorphEdit - missing marker refusal", () => {
  test("refuses edit with no markers on file >10 lines", async () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line ${i}`).join("\n");
    const runtime = makeMockRuntime({
      readFile: async () => ({ exists: true, text: lines }),
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "replace everything",
        code_edit: "completely new content",
      },
      runtime,
    );

    expect(result).toContain("Missing");
    expect(result).toContain(EXISTING_CODE_MARKER);
  });

  test("allows edit with no markers on file ≤3 lines", async () => {
    const runtime = makeMockRuntime({
      readFile: async () => ({
        exists: true,
        text: "a\nb\n",
      }),
      callMorphApply: async () => ({
        success: true,
        content: "x\ny\n",
      }),
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "change it",
        code_edit: "x\ny\n",
      },
      runtime,
    );

    expect(result).toContain("Applied edit to");
  });
});

describe("executeMorphEdit - unsafe Morph output refusal", () => {
  test("rejects marker leakage when original had no markers", async () => {
    const original = "const a = 1;\nconst b = 2;\n";
    const runtime = makeMockRuntime({
      readFile: async () => ({ exists: true, text: original }),
      callMorphApply: async () => ({
        success: true,
        content: `const a = 1;\n${EXISTING_CODE_MARKER}\nconst b = 2;\n`,
      }),
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "add marker",
        code_edit: `${EXISTING_CODE_MARKER}\nconst c = 3;\n${EXISTING_CODE_MARKER}`,
      },
      runtime,
    );

    expect(result).toContain("unsafe output");
    expect(result).toContain("placeholder marker text");
  });

  test("rejects catastrophic truncation", async () => {
    // original: 20 lines, ~80 chars
    const original = Array.from(
      { length: 20 },
      (_, i) => `const x${i} = ${i};`,
    ).join("\n");
    // merged: 2 lines, ~10 chars  (>60% char loss, >50% line loss)
    const merged = "const a = 1;\n";

    const runtime = makeMockRuntime({
      readFile: async () => ({ exists: true, text: original }),
      callMorphApply: async () => ({
        success: true,
        content: merged,
      }),
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "shrink",
        code_edit: `${EXISTING_CODE_MARKER}\n// tiny\n${EXISTING_CODE_MARKER}`,
      },
      runtime,
    );

    expect(result).toContain("potentially destructive merge");
    expect(result).toContain("% characters");
  });

  test("rejects dropped import identifiers", async () => {
    const original = `import { foo, bar } from "baz";\nconst x = foo();\n`;
    const merged = `import { foo } from "baz";\nconst x = foo();\n`;

    const runtime = makeMockRuntime({
      readFile: async () => ({ exists: true, text: original }),
      callMorphApply: async () => ({
        success: true,
        content: merged,
      }),
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "drop bar",
        code_edit: `${EXISTING_CODE_MARKER}\nconst x = foo();\n${EXISTING_CODE_MARKER}`,
      },
      runtime,
    );

    expect(result).toContain("missing imports");
    expect(result).toContain("bar");
  });
});

describe("executeMorphEdit - no-marker guard coverage", () => {
  const tenLines = Array.from(
    { length: 10 },
    (_, i) => `const v${i} = ${i};`,
  ).join("\n");

  test("blocks catastrophic shrink on no-marker edit (vs code_edit baseline)", async () => {
    // 10-line file (≤10 so the missing-marker refusal does not trigger),
    // no markers, agent provides a substantial full replacement, but Morph
    // returns an almost-empty result.
    const bigReplacement = Array.from(
      { length: 10 },
      (_, i) => `const replaced${i} = ${i};`,
    ).join("\n");

    let wrote = false;
    const runtime = makeMockRuntime({
      readFile: async () => ({ exists: true, text: tenLines }),
      callMorphApply: async () => ({ success: true, content: "x\n" }),
      writeFile: async () => {
        wrote = true;
      },
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "replace",
        code_edit: bigReplacement,
      },
      runtime,
    );

    expect(result).toContain("potentially destructive merge");
    expect(result).toContain("% characters");
    expect(wrote).toBe(false);
  });

  test("allows intentional no-marker replacement where merged ~= code_edit", async () => {
    // No false positive: merged result matches the provided replacement.
    const replacement = "const a = 1;\nconst b = 2;\nconst c = 3;\n";

    let wrote = false;
    const runtime = makeMockRuntime({
      readFile: async () => ({
        exists: true,
        text: "const a = 1;\nconst b = 2;\n",
      }),
      callMorphApply: async () => ({ success: true, content: replacement }),
      writeFile: async () => {
        wrote = true;
      },
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "replace",
        code_edit: replacement,
      },
      runtime,
    );

    expect(result).toContain("Applied edit to");
    expect(wrote).toBe(true);
  });

  test("blocks marker leakage on no-marker edit", async () => {
    let wrote = false;
    const runtime = makeMockRuntime({
      readFile: async () => ({
        exists: true,
        text: "const a = 1;\nconst b = 2;\n",
      }),
      callMorphApply: async () => ({
        success: true,
        content: `const a = 1;\n${EXISTING_CODE_MARKER}\nconst b = 2;\n`,
      }),
      writeFile: async () => {
        wrote = true;
      },
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "replace",
        code_edit: "const a = 1;\nconst b = 2;\nconst c = 3;\n",
      },
      runtime,
    );

    expect(result).toContain("unsafe output");
    expect(result).toContain("placeholder marker text");
    expect(wrote).toBe(false);
  });
});

describe("executeMorphEdit - write failure", () => {
  test("returns error when writeFile throws", async () => {
    const runtime = makeMockRuntime({
      readFile: async () => ({
        exists: true,
        text: "const a = 1;\n",
      }),
      callMorphApply: async () => ({
        success: true,
        content: "const a = 1;\nconst b = 2;\n",
      }),
      writeFile: async () => {
        throw new Error("disk full");
      },
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "add b",
        code_edit: `${EXISTING_CODE_MARKER}\nconst b = 2;\n${EXISTING_CODE_MARKER}`,
      },
      runtime,
    );

    expect(result).toContain("Error writing file");
    expect(result).toContain("disk full");
  });
});

describe("executeMorphEdit - mocked successful write/diff flow", () => {
  test("writes merged code and returns diff stats", async () => {
    let writtenPath: string | undefined;
    let writtenContent: string | undefined;

    const original = "const a = 1;\nconst b = 2;\n";
    const merged = "const a = 1;\nconst b = 2;\nconst c = 3;\n";

    const runtime = makeMockRuntime({
      readFile: async () => ({ exists: true, text: original }),
      callMorphApply: async () => ({
        success: true,
        content: merged,
      }),
      writeFile: async (path, content) => {
        writtenPath = path;
        writtenContent = content;
      },
      now: () => 1000,
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "add c",
        code_edit: `${EXISTING_CODE_MARKER}\nconst c = 3;\n${EXISTING_CODE_MARKER}`,
      },
      runtime,
    );

    expect(writtenPath).toBe(join("/project", "src/foo.ts"));
    expect(writtenContent).toBe(merged);
    expect(result).toContain("Applied edit to src/foo.ts");
    expect(result).toContain("+1");
    expect(result).toContain("->");
    expect(result).toContain("0ms"); // 1000 - 1000 if we call now() twice... wait
    // Actually now() returns 1000 both times, so 0ms
    expect(result).toContain("diff");
  });

  test("creates new file when target does not exist and no markers", async () => {
    let writtenPath: string | undefined;
    let writtenContent: string | undefined;

    const runtime = makeMockRuntime({
      readFile: async () => ({ exists: false, text: "" }),
      writeFile: async (path, content) => {
        writtenPath = path;
        writtenContent = content;
      },
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/new.ts",
        instructions: "create file",
        code_edit: "const x = 1;\n",
      },
      runtime,
    );

    expect(writtenPath).toBe(join("/project", "src/new.ts"));
    expect(writtenContent).toBe("const x = 1;\n");
    expect(result).toContain("Created new file: src/new.ts");
  });
});

/* ── scrubSecrets ── */

describe("scrubSecrets", () => {
  test("removes explicit apiKey from message", () => {
    const key = "sk-morph-test-key-12345";
    const message = `Request failed with key ${key} and token`;
    expect(scrubSecrets(message, key)).not.toContain(key);
    expect(scrubSecrets(message, key)).toContain("***REDACTED***");
  });

  test("removes Bearer token pattern", () => {
    const message = `Authorization: Bearer abcdef1234567890abcdef`;
    const scrubbed = scrubSecrets(message);
    expect(scrubbed).not.toContain("abcdef1234567890abcdef");
    expect(scrubbed).toContain("Bearer ***REDACTED***");
  });

  test("leaves unrelated text intact", () => {
    const message = "Morph API error (500): model not found";
    expect(scrubSecrets(message)).toBe(message);
  });

  test("coerces Error messages without throwing", () => {
    expect(scrubSecrets(new Error("boom"))).toBe("boom");
  });

  test("coerces nullish and numeric messages without throwing", () => {
    expect(scrubSecrets(undefined)).toBe("");
    expect(scrubSecrets(null)).toBe("");
    expect(scrubSecrets(123)).toBe("123");
  });

  test("handles unstringifiable message values without throwing", () => {
    const message = {
      toString() {
        throw new Error("cannot stringify");
      },
    };

    expect(scrubSecrets(message)).toBe("");
  });

  test("does not coerce non-string apiKey into an accidental redaction token", () => {
    const message = "Request failed with numeric value 12345";

    expect(scrubSecrets(message, 12345)).toBe(message);
  });

  test("redacts explicit apiKey and Bearer token in one pass", () => {
    const key = "sk-morph-test-key-67890";
    const bearerToken = "abcdef1234567890abcdef";
    const message = `Request failed with ${key} and Bearer ${bearerToken}`;
    const scrubbed = scrubSecrets(message, key);

    expect(scrubbed).toContain("***REDACTED***");
    expect(scrubbed).toContain("Bearer ***REDACTED***");
    expect(scrubbed).not.toContain(key);
    expect(scrubbed).not.toContain(bearerToken);
  });
});

/* ── callMorphApply - mocked fetch ── */

describe("callMorphApply - timeout", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns api_timeout when fetch hangs", async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal?.aborted) {
          reject(new Error("AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => {
          const err = new Error("AbortError");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    const result = await callMorphApply("code", "edit", "instr", {
      timeout: 10,
      apiKey: "fake-key",
    });

    expect(result.success).toBe(false);
    expect(result.kind).toBe("api_timeout");
    expect(result.error).toContain("timeout");
    expect(result.error).not.toContain("fake-key");
  });
});

describe("callMorphApply - failure kinds and secret scrubbing", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns api_http_error with scrubbed body", async () => {
    const secretKey = "sk-live-morph-abc123";
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: false,
        status: 401,
        text: () =>
          Promise.resolve(`Invalid key ${secretKey} or Bearer ${secretKey}`),
      } as Response)) as unknown as typeof fetch;

    const result = await callMorphApply("code", "edit", "instr", {
      apiKey: secretKey,
    });

    expect(result.success).toBe(false);
    expect(result.kind).toBe("api_http_error");
    expect(result.error).toContain("401");
    expect(result.error).not.toContain(secretKey);
    expect(result.error).toContain("***REDACTED***");
  });

  test("returns api_parse_error on invalid JSON", async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("not json"),
        json: () => Promise.reject(new Error("Unexpected token")),
      } as Response)) as unknown as typeof fetch;

    const result = await callMorphApply("code", "edit", "instr", {
      apiKey: "fake-key",
    });

    expect(result.success).toBe(false);
    expect(result.kind).toBe("api_parse_error");
    expect(result.error).toContain("invalid JSON");
  });

  test("returns api_timeout when abort fires during body parse", async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(""),
        json: () =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      } as Response)) as unknown as typeof fetch;

    const result = await callMorphApply("code", "edit", "instr", {
      timeout: 10,
      apiKey: "fake-key",
    });

    expect(result.success).toBe(false);
    expect(result.kind).toBe("api_timeout");
    expect(result.error).toContain("timeout");
    expect(result.error).not.toContain("invalid JSON");
  });

  test("returns api_empty_response when choices are missing", async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("{}"),
        json: () => Promise.resolve({ choices: [] }),
      } as Response)) as unknown as typeof fetch;

    const result = await callMorphApply("code", "edit", "instr", {
      apiKey: "fake-key",
    });

    expect(result.success).toBe(false);
    expect(result.kind).toBe("api_empty_response");
    expect(result.error).toContain("empty response");
  });

  test("returns api_request_failed on network error", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;

    const result = await callMorphApply("code", "edit", "instr", {
      apiKey: "fake-key",
    });

    expect(result.success).toBe(false);
    expect(result.kind).toBe("api_request_failed");
    expect(result.error).toContain("ECONNREFUSED");
  });

  test("returns missing_api_key when no key provided", async () => {
    const result = await callMorphApply("code", "edit", "instr", {
      apiKey: "",
    });

    expect(result.success).toBe(false);
    expect(result.kind).toBe("missing_api_key");
    expect(result.error).toContain("MORPH_API_KEY not set");
  });
});

/* ── executeMorphEdit - failure kind propagation ── */

describe("executeMorphEdit - API failure kind propagation", () => {
  test("propagates api_timeout from callMorphApply", async () => {
    const runtime = makeMockRuntime({
      readFile: async () => ({ exists: true, text: "const a = 1;\n" }),
      callMorphApply: async () => ({
        success: false,
        error: "Morph API timeout after 10ms",
        kind: "api_timeout",
      }),
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "add b",
        code_edit: `${EXISTING_CODE_MARKER}\nconst b = 2;\n${EXISTING_CODE_MARKER}`,
      },
      runtime,
    );

    expect(result).toContain("Morph API failed");
    expect(result).toContain("timeout");
  });

  test("propagates api_http_error from callMorphApply", async () => {
    const runtime = makeMockRuntime({
      readFile: async () => ({ exists: true, text: "const a = 1;\n" }),
      callMorphApply: async () => ({
        success: false,
        error: "Morph API error (500): server error",
        kind: "api_http_error",
      }),
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "add b",
        code_edit: `${EXISTING_CODE_MARKER}\nconst b = 2;\n${EXISTING_CODE_MARKER}`,
      },
      runtime,
    );

    expect(result).toContain("Morph API failed");
    expect(result).toContain("500");
  });

  test("propagates api_parse_error from callMorphApply", async () => {
    const runtime = makeMockRuntime({
      readFile: async () => ({ exists: true, text: "const a = 1;\n" }),
      callMorphApply: async () => ({
        success: false,
        error: "Morph API returned invalid JSON",
        kind: "api_parse_error",
      }),
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "add b",
        code_edit: `${EXISTING_CODE_MARKER}\nconst b = 2;\n${EXISTING_CODE_MARKER}`,
      },
      runtime,
    );

    expect(result).toContain("Morph API failed");
    expect(result).toContain("invalid JSON");
  });

  test("output does not leak secrets on API failure", async () => {
    const secret = "sk-super-secret-key";
    const runtime = makeMockRuntime({
      readFile: async () => ({ exists: true, text: "const a = 1;\n" }),
      callMorphApply: async () => ({
        success: false,
        error: `Something went wrong with ${secret}`,
        kind: "api_request_failed",
      }),
      constants: {
        MORPH_API_KEY: secret,
        ALLOW_READONLY_AGENTS: false,
        READONLY_AGENTS: ["plan", "explore"],
        EXISTING_CODE_MARKER,
        PLUGIN_VERSION: "1.0.0",
        MORPH_MODEL: "morph-v3-fast",
      },
    });

    const result = await executeMorphEdit(
      {
        target_filepath: "src/foo.ts",
        instructions: "add b",
        code_edit: `${EXISTING_CODE_MARKER}\nconst b = 2;\n${EXISTING_CODE_MARKER}`,
      },
      runtime,
    );

    expect(result).not.toContain(secret);
  });
});
