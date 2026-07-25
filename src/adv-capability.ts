import * as path from "node:path";

/** Global capability symbol ADV attaches after validating workdir+taskId. */
export const ADV_MORPH_WORKTREE_CAPABILITY = Symbol.for(
  "advance.morph-worktree-capability.v1",
);

/**
 * Read the ADV worktree capability root from morph_edit args.
 * morph redeclares the Symbol.for key (plugins are independently versioned).
 * Trusted only after shape-validation; confinement still goes through
 * resolveTargetPath. Returns null when absent/malformed → fail closed.
 * Shape-validation is lexical; relies on ADV attaching an already-canonical root.
 */
export function readCapabilityRoot(args: unknown): string | null {
  if (args === null || typeof args !== "object") return null;
  const cap = (args as Record<symbol, unknown>)[ADV_MORPH_WORKTREE_CAPABILITY];
  if (cap === null || typeof cap !== "object") return null;
  const root = (cap as { root?: unknown }).root;
  if (typeof root !== "string" || root.length === 0 || !path.isAbsolute(root)) {
    return null;
  }
  return path.resolve(root);
}
