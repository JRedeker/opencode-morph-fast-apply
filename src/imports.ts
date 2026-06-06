/**
 * Extract imported identifiers from a source file's top-level import/require
 * statements. Covers Python, TypeScript, JavaScript, Go, Rust, Java, C/C++,
 * and C#.
 *
 * Returns an array of identifier strings (e.g. ["PostgresError", "Router"]).
 * Returns empty array if no imports found or file extension is unrecognized.
 */
export function extractImportedIdentifiers(
  code: string,
  filepath: string,
): string[] {
  const ext = filepath.split(".").pop()?.toLowerCase() || "";
  const identifiers: string[] = [];
  const cExts = ["c", "cpp", "cc", "cxx", "h", "hpp", "hxx"];
  const jsExts = ["ts", "tsx", "js", "jsx", "mjs", "cjs"];

  // For Python, join continuation lines (parenthesized multi-line imports)
  // before processing so `from X import (\n  Y,\n  Z\n)` becomes one line.
  let normalizedCode = code;
  if (ext === "py") {
    let result = "";
    let depth = 0;
    for (const ch of code) {
      if (ch === "(") { depth++; result += ch; continue; }
      if (ch === ")") { depth--; result += ch; continue; }
      if (ch === "\n" && depth > 0) { result += " "; continue; }
      result += ch;
    }
    normalizedCode = result;
  }

  const lines = normalizedCode.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comment lines (but NOT #include / #using directives)
    if (!trimmed) continue;
    if (trimmed.startsWith("#") && ext !== "py" && !cExts.includes(ext)) continue;

    // Python: from X import Y, Z  |  import X, Y
    if (ext === "py") {
      // Skip comment lines in Python (# comment, not import)
      if (trimmed.startsWith("#")) continue;
      const fromImport = trimmed.match(/^from\s+[\w.]+\s+import\s+(.+)/);
      if (fromImport) {
        // "Y, Z as A" → extract the LOCAL name (after 'as' if present)
        const names = fromImport[1]
          .replace(/[()]/g, "") // strip parens from multi-line imports
          .split(",")
          .map((s) => {
            const parts = s.trim().split(/\s+as\s+/);
            // If aliased, take the alias (last part); otherwise take the name
            return (parts.length > 1 ? parts[parts.length - 1] : parts[0])?.trim();
          })
          .filter((s) => s && s.length > 0 && !s.startsWith("*"));
        identifiers.push(...names);
        continue;
      }
      const bareImport = trimmed.match(/^import\s+(.+)/);
      if (bareImport) {
        const names = bareImport[1]
          .split(",")
          .map((s) => {
            const parts = s.trim().split(/\s+as\s+/);
            return (parts.length > 1 ? parts[parts.length - 1] : parts[0])?.trim();
          })
          .filter((s) => s && s.length > 0);
        identifiers.push(...names);
        continue;
      }
    }

    // TypeScript / JavaScript: import { X, Y } from ...  |  import X from ...
    if (jsExts.includes(ext)) {
      // import { X, Y as Z } from '...'
      const namedImport = trimmed.match(/^import\s+\{([^}]+)\}\s+from/);
      if (namedImport) {
        const names = namedImport[1]
          .split(",")
          .map((s) => s.trim().split(/\s+as\s+/)[0]?.trim())
          .filter((s) => s && s.length > 0);
        identifiers.push(...names);
        continue;
      }
      // import X from '...'  (default import)
      const defaultImport = trimmed.match(/^import\s+(\w+)\s+from/);
      if (defaultImport) {
        identifiers.push(defaultImport[1]);
        continue;
      }
      // import * as X from '...'
      const namespaceImport = trimmed.match(/^import\s+\*\s+as\s+(\w+)\s+from/);
      if (namespaceImport) {
        identifiers.push(namespaceImport[1]);
        continue;
      }
      // const X = require('...')
      const requireImport = trimmed.match(
        /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(/,
      );
      if (requireImport) {
        identifiers.push(requireImport[1]);
        continue;
      }
      // const { X, Y } = require('...')
      const requireDestructure = trimmed.match(
        /(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\s*\(/,
      );
      if (requireDestructure) {
        const names = requireDestructure[1]
          .split(",")
          .map((s) => s.trim().split(/:/)[0]?.trim())
          .filter((s) => s && s.length > 0);
        identifiers.push(...names);
        continue;
      }
    }

    // Go: import "pkg"  |  import ( "pkg1" \n "pkg2" )
    if (ext === "go") {
      const singleImport = trimmed.match(
        /^import\s+(?:(\w+)\s+)?"([^"]+)"/,
      );
      if (singleImport) {
        if (singleImport[1]) {
          identifiers.push(singleImport[1]); // aliased
        } else {
          const parts = singleImport[2].split("/");
          identifiers.push(parts[parts.length - 1] || "");
        }
        continue;
      }
      // Inside import block: "pkg" or alias "pkg"
      const blockImport = trimmed.match(/^(?:(\w+)\s+)?"([^"]+)"/);
      if (blockImport && !trimmed.startsWith("//")) {
        if (blockImport[1]) {
          identifiers.push(blockImport[1]);
        } else {
          const parts = blockImport[2].split("/");
          identifiers.push(parts[parts.length - 1] || "");
        }
        continue;
      }
    }

    // Rust: use X::Y::Z;  |  use X::{Y, Z};
    if (ext === "rs") {
      const useStmt = trimmed.match(/^use\s+(.+);/);
      if (useStmt) {
        const path = useStmt[1];
        const multiMatch = path.match(/\{([^}]+)\}/);
        if (multiMatch) {
          const names = multiMatch[1]
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          identifiers.push(...names);
        } else {
          const segments = path.split("::");
          const last = segments[segments.length - 1];
          if (last && last !== "*") identifiers.push(last);
        }
        continue;
      }
    }

    // Java: import X.Y.Z;
    if (ext === "java") {
      const javaImport = trimmed.match(/^import\s+(?:static\s+)?(.+);/);
      if (javaImport) {
        const parts = javaImport[1].split(".");
        const last = parts[parts.length - 1];
        if (last && last !== "*") identifiers.push(last);
        continue;
      }
    }

    // C/C++: #include <...> or #include "..."
    if (cExts.includes(ext)) {
      const include = trimmed.match(/^#include\s+[<"]([^>"]+)[>"]/);
      if (include) {
        const headerPath = include[1];
        const baseName = headerPath.split("/").pop() || headerPath;
        const name = baseName.split(".")[0];
        if (name) identifiers.push(name);
        continue;
      }
    }

    // C#: using X.Y.Z;
    if (ext === "cs") {
      const usingStmt = trimmed.match(/^using\s+(?:static\s+)?(.+);/);
      if (usingStmt) {
        const parts = usingStmt[1].split(".");
        const last = parts[parts.length - 1];
        if (last && last !== "*") identifiers.push(last);
        continue;
      }
    }
  }

  return [...new Set(identifiers)]; // deduplicate
}

/**
 * Check whether the merged code preserves all imported identifiers from
 * the original file. Returns an array of identifiers that were dropped.
 */
export function findDroppedIdentifiers(
  originalCode: string,
  mergedCode: string,
  filepath: string,
): string[] {
  const originalIds = extractImportedIdentifiers(originalCode, filepath);
  if (originalIds.length === 0) return [];

  const dropped: string[] = [];
  for (const id of originalIds) {
    // Check if identifier appears anywhere in merged code (usage or import)
    if (!mergedCode.includes(id)) {
      dropped.push(id);
    }
  }
  return dropped;
}
