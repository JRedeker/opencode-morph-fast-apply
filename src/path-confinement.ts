import { existsSync, realpathSync } from "node:fs";
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

/**
 * Find the nearest existing ancestor directory of `targetPath`.
 * Returns the path itself if it exists.
 */
function findNearestExistingParent(targetPath: string): string | null {
  let current = targetPath;
  while (current !== path.dirname(current)) {
    if (existsSync(current)) {
      return current;
    }
    current = path.dirname(current);
  }
  // Check root itself
  if (existsSync(current)) {
    return current;
  }
  return null;
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

  if (targetExists) {
    // Existing target: follow symlinks on the target itself
    try {
      const canonical = realpathSync(resolved);
      if (!isContained(canonical, normalizedRoot)) {
        return {
          error: `Path resolves outside allowed root via symlink: ${targetPath}`,
        };
      }
      return { path: canonical };
    } catch {
      // If realpath fails, fall back to the resolved path (already checked)
      return { path: resolved };
    }
  } else {
    // New target: find nearest existing parent and follow symlinks on it
    const parent = findNearestExistingParent(resolved);
    if (parent) {
      try {
        const canonicalParent = realpathSync(parent);
        if (!isContained(canonicalParent, normalizedRoot)) {
          return {
            error: `Nearest existing parent resolves outside allowed root via symlink: ${targetPath}`,
          };
        }
        // Reconstruct the path using the canonical parent to ensure consistency
        const relativeFromParent = path.relative(parent, resolved);
        const effectivePath = path.resolve(canonicalParent, relativeFromParent);
        if (!isContained(effectivePath, normalizedRoot)) {
          return {
            error: `Effective path resolves outside allowed root via symlink: ${targetPath}`,
          };
        }
        return { path: effectivePath };
      } catch {
        // If realpath fails, fall back to resolved path (already checked)
        return { path: resolved };
      }
    }
    // No existing parent found (unlikely for valid roots), fall back
    return { path: resolved };
  }
}
