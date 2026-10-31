import { lstatSync, realpathSync } from "node:fs";
import * as path from "node:path";

export interface ResolveResult {
  path: string;
}

export interface RejectResult {
  error: string;
}

export type ResolveTargetPathResult = ResolveResult | RejectResult;

/**
 * Check whether `resolved` is contained within `root`.
 *
 * Uses the canonical check: resolved === root OR resolved starts with root + path.sep.
 * This avoids the naïve prefix bug where /rootEvil passes for root /root.
 */
function isContained(resolved: string, root: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedResolved = path.resolve(resolved);
  return (
    normalizedResolved === normalizedRoot ||
    normalizedResolved.startsWith(normalizedRoot + path.sep)
  );
}

/** Find the nearest filesystem entry, including a dangling symlink. */
function findNearestExistingParent(targetPath: string): string | null {
  let current = targetPath;
  while (true) {
    if (lstatSync(current, { throwIfNoEntry: false })) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Resolve and confine a target file path to an allowed root directory.
 *
 * - For existing targets: follows symlinks via realpath and ensures the
 *   canonical location is inside the root.
 * - For new targets: resolves the path, finds the nearest existing parent,
 *   follows symlinks on that parent, and ensures the parent is inside root.
 *
 * @param targetPath - The requested path (relative or absolute)
 * @param root - The allowed root directory
 * @param options - `{ targetExists?: boolean }` — when true, realpaths the
 *   target itself; when false/omitted, realpaths the nearest existing parent
 * @returns `{ path: resolvedPath }` on success, `{ error: message }` on rejection
 */
export function resolveTargetPath(
  targetPath: string,
  root: string,
  options?: { targetExists?: boolean },
): ResolveTargetPathResult {
  const normalizedRoot = path.resolve(root);

  // Resolve the target path relative to root
  const resolved = path.resolve(normalizedRoot, targetPath);

  // Initial containment check on the resolved path
  if (!isContained(resolved, normalizedRoot)) {
    return {
      error: `Path is outside allowed root: ${targetPath}`,
    };
  }

  const targetExists = options?.targetExists ?? false;

  try {
    const parent = targetExists
      ? resolved
      : findNearestExistingParent(resolved);
    if (!parent) {
      return {
        error: `Cannot resolve path inside allowed root: ${targetPath}`,
      };
    }
    const canonicalParent = realpathSync(parent);
    if (!isContained(canonicalParent, normalizedRoot)) {
      return {
        error: `Path resolves outside allowed root via symlink: ${targetPath}`,
      };
    }
    const effectivePath = path.resolve(
      canonicalParent,
      path.relative(parent, resolved),
    );
    if (!isContained(effectivePath, normalizedRoot)) {
      return {
        error: `Effective path resolves outside allowed root via symlink: ${targetPath}`,
      };
    }
    return { path: effectivePath };
  } catch {
    return { error: `Cannot resolve path inside allowed root: ${targetPath}` };
  }
}
