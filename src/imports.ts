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
  const entries = extractImportEntries(code, filepath);
  const bindings = new Set<string>();
  for (const entry of entries) {
    for (const b of entry.bindings) {
      bindings.add(b);
    }
  }
  return [...bindings];
}

/**
 * A stable, structured representation of a single import declaration.
 *
 * `kind`    — language-specific discriminator (e.g. "ts-named", "py-from")
 * `source`  — module path / package name when available
 * `bindings`— local identifiers introduced by this declaration
 */
export type ImportEntry = {
  kind: string;
  source?: string;
  bindings: string[];
};

/**
 * Parse supported import declarations into stable entries representing
 * required local bindings in import declarations.
 *
 * Covers Python, TypeScript, JavaScript, Go, Rust, Java, C/C++, and C#.
 */
export function extractImportEntries(
  code: string,
  filepath: string,
): ImportEntry[] {
  const ext = filepath.split(".").pop()?.toLowerCase() || "";
  const entries: ImportEntry[] = [];
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

      const fromImport = trimmed.match(/^from\s+([\w.]+)\s+import\s+(.+)/);
      if (fromImport) {
        const source = fromImport[1];
        const names = fromImport[2]
          .replace(/[()]/g, "") // strip parens from multi-line imports
          .split(",")
          .map((s) => {
            const parts = s.trim().split(/\s+as\s+/);
            // If aliased, take the alias (last part); otherwise take the name
            return (parts.length > 1 ? parts[parts.length - 1] : parts[0])?.trim();
          })
          .filter((s): s is string => !!s && s.length > 0 && !s.startsWith("*"));
        if (names.length > 0) {
          entries.push({ kind: "py-from", source, bindings: names });
        }
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
          .filter((s): s is string => !!s && s.length > 0);
        for (const name of names) {
          entries.push({ kind: "py-import", source: name, bindings: [name] });
        }
        continue;
      }
    }

    // TypeScript / JavaScript: import { X, Y } from ...  |  import X from ...
    if (jsExts.includes(ext)) {
      // import { X, Y as Z } from '...'
      const namedImport = trimmed.match(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
      if (namedImport) {
        const source = namedImport[2];
        const names = namedImport[1]
          .split(",")
          .map((s) => {
            const parts = s.trim().split(/\s+as\s+/);
            // For named imports, the LOCAL binding is the last part (alias)
            return (parts.length > 1 ? parts[parts.length - 1] : parts[0])?.trim();
          })
          .filter((s): s is string => !!s && s.length > 0);
        if (names.length > 0) {
          entries.push({ kind: "ts-named", source, bindings: names });
        }
        continue;
      }

      // import X from '...'  (default import)
      const defaultImport = trimmed.match(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
      if (defaultImport) {
        entries.push({
          kind: "ts-default",
          source: defaultImport[2],
          bindings: [defaultImport[1]],
        });
        continue;
      }

      // import * as X from '...'
      const namespaceImport = trimmed.match(/^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
      if (namespaceImport) {
        entries.push({
          kind: "ts-namespace",
          source: namespaceImport[2],
          bindings: [namespaceImport[1]],
        });
        continue;
      }

      // const X = require('...')
      const requireImport = trimmed.match(
        /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
      );
      if (requireImport) {
        entries.push({
          kind: "ts-require",
          source: requireImport[2],
          bindings: [requireImport[1]],
        });
        continue;
      }

      // const { X, Y } = require('...')
      const requireDestructure = trimmed.match(
        /(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
      );
      if (requireDestructure) {
        const source = requireDestructure[2];
        const names = requireDestructure[1]
          .split(",")
          .map((s) => {
            const parts = s.trim().split(/\s*:\s*/);
            // For destructured require, the LOCAL binding is the left side of colon
            return parts[0]?.trim();
          })
          .filter((s): s is string => !!s && s.length > 0);
        if (names.length > 0) {
          entries.push({ kind: "ts-require-destructure", source, bindings: names });
        }
        continue;
      }
    }

    // Go: import "pkg"  |  import ( "pkg1" \n "pkg2" )
    if (ext === "go") {
      const singleImport = trimmed.match(
        /^import\s+(?:(\w+)\s+)?"([^"]+)"/,
      );
      if (singleImport) {
        const source = singleImport[2];
        const alias = singleImport[1];
        if (alias) {
          entries.push({ kind: "go-import", source, bindings: [alias] });
        } else {
          const parts = source.split("/");
          entries.push({
            kind: "go-import",
            source,
            bindings: [parts[parts.length - 1] || ""],
          });
        }
        continue;
      }
      // Inside import block: "pkg" or alias "pkg"
      const blockImport = trimmed.match(/^(?:(\w+)\s+)?"([^"]+)"/);
      if (blockImport && !trimmed.startsWith("//")) {
        const source = blockImport[2];
        const alias = blockImport[1];
        if (alias) {
          entries.push({ kind: "go-import", source, bindings: [alias] });
        } else {
          const parts = source.split("/");
          entries.push({
            kind: "go-import",
            source,
            bindings: [parts[parts.length - 1] || ""],
          });
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
          if (names.length > 0) {
            entries.push({ kind: "rs-use", bindings: names });
          }
        } else {
          const segments = path.split("::");
          const last = segments[segments.length - 1];
          if (last && last !== "*") {
            entries.push({ kind: "rs-use", bindings: [last] });
          }
        }
        continue;
      }
    }

    // Java: import X.Y.Z;
    if (ext === "java") {
      const javaImport = trimmed.match(/^import\s+(?:static\s+)?(.+);/);
      if (javaImport) {
        const source = javaImport[1];
        const parts = source.split(".");
        const last = parts[parts.length - 1];
        if (last && last !== "*") {
          entries.push({ kind: "java-import", source, bindings: [last] });
        }
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
        if (name) {
          entries.push({
            kind: "c-include",
            source: headerPath,
            bindings: [name],
          });
        }
        continue;
      }
    }

    // C#: using X.Y.Z;
    if (ext === "cs") {
      const usingStmt = trimmed.match(/^using\s+(?:static\s+)?(.+);/);
      if (usingStmt) {
        const source = usingStmt[1];
        const parts = source.split(".");
        const last = parts[parts.length - 1];
        if (last && last !== "*") {
          entries.push({ kind: "cs-using", source, bindings: [last] });
        }
        continue;
      }
    }
  }

  // Deduplicate entries by serializing to a stable key
  const seen = new Set<string>();
  const deduped: ImportEntry[] = [];
  for (const entry of entries) {
    const key = JSON.stringify({ kind: entry.kind, source: entry.source, bindings: entry.bindings });
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(entry);
    }
  }

  return deduped;
}

/**
 * Check whether the merged code preserves all imported identifiers from
 * the original file. Returns an array of identifiers that were dropped.
 *
 * This performs declaration-level comparison: it parses import declarations
 * in both original and merged code, then checks whether each local binding
 * from the original imports still appears in an import declaration in the
 * merged code. Identifiers that are merely *used* in the merged code but
 * no longer imported are still flagged.
 */
export function findDroppedIdentifiers(
  originalCode: string,
  mergedCode: string,
  filepath: string,
): string[] {
  const originalEntries = extractImportEntries(originalCode, filepath);
  if (originalEntries.length === 0) return [];

  const mergedEntries = extractImportEntries(mergedCode, filepath);
  const mergedBindings = new Set<string>();
  for (const entry of mergedEntries) {
    for (const b of entry.bindings) {
      mergedBindings.add(b);
    }
  }

  const dropped: string[] = [];
  for (const entry of originalEntries) {
    for (const binding of entry.bindings) {
      if (!mergedBindings.has(binding)) {
        dropped.push(binding);
      }
    }
  }

  return [...new Set(dropped)];
}
