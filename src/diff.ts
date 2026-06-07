import { createTwoFilesPatch } from "diff";

/**
 * Generate a unified diff with context for display.
 */
export function generateUnifiedDiff(
  filepath: string,
  original: string,
  modified: string,
): string {
  // Use proper unified diff with 3 lines of context
  const patch = createTwoFilesPatch(
    `a/${filepath}`,
    `b/${filepath}`,
    original,
    modified,
    "",
    "",
    { context: 3 },
  );

  // If no changes, return early
  if (!patch.includes("@@")) {
    return "No changes detected";
  }

  return patch;
}

/**
 * Count additions and deletions from a unified diff.
 */
export function countChanges(diff: string): { added: number; removed: number } {
  const lines = diff.split("\n");
  let added = 0;
  let removed = 0;

  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed++;
    }
  }

  return { added, removed };
}
