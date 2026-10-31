import type { ResolveTargetPathResult } from "./path-confinement.js";
import type { FailureKind } from "../impl.js";
import { scrubSecrets } from "../impl.js";

export interface ExecuteMorphEditArgs {
  target_filepath: string;
  instructions: string;
  code_edit: string;
}

export type MorphEditRefusalCode =
  | "readonly_agent"
  | "path_refused"
  | "file_not_found"
  | "missing_markers"
  | "marker_leakage"
  | "catastrophic_truncation"
  | "dropped_imports";

export type MorphEditErrorCode =
  | FailureKind
  | "read_failed"
  | "write_failed"
  | "invalid_arguments"
  | "session_unavailable";

export type MorphEditResult = {
  text: string;
  /** True only when the displayed diff is shortened, not when a merge is refused. */
  truncated: boolean;
} & (
  | { status: "success"; code: null }
  | { status: "refused"; code: MorphEditRefusalCode }
  | { status: "error"; code: MorphEditErrorCode }
);

export interface ExecuteMorphEditRuntime {
  log: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
  ) => Promise<void>;
  directory: string;
  context: {
    agent: string;
    worktree?: string;
    directory?: string;
  };
  now: () => number;
  readFile: (filepath: string) => Promise<{ exists: boolean; text: string }>;
  writeFile: (filepath: string, content: string) => Promise<void>;
  callMorphApply: (
    originalCode: string,
    codeEdit: string,
    instructions: string,
  ) => Promise<{
    success: boolean;
    content?: string;
    error?: string;
    kind?: FailureKind;
  }>;
  resolveTargetPath: (
    targetPath: string,
    root: string,
    options?: { targetExists?: boolean },
  ) => ResolveTargetPathResult;
  normalizeCodeEditInput: (codeEdit: string) => string;
  findDroppedIdentifiers: (
    originalCode: string,
    mergedCode: string,
    filepath: string,
  ) => string[];
  generateUnifiedDiff: (
    filepath: string,
    original: string,
    modified: string,
  ) => string;
  countChanges: (diff: string) => { added: number; removed: number };
  constants: {
    MORPH_API_KEY?: string;
    ALLOW_READONLY_AGENTS: boolean;
    READONLY_AGENTS: string[];
    EXISTING_CODE_MARKER: string;
    PLUGIN_VERSION: string;
    MORPH_MODEL: string;
  };
}

export type ParsedMorphEditArgs =
  { ok: true; args: ExecuteMorphEditArgs } | { ok: false; error: string };

/**
 * Validate raw morph_edit arguments before the execution law runs.
 *
 * Both adapters check received input here instead of trusting their host's
 * schema validation alone.
 */
export function parseMorphEditArgs(raw: unknown): ParsedMorphEditArgs {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      error:
        "morph_edit requires a JSON object with target_filepath, instructions, and code_edit",
    };
  }
  const record = raw as Record<string, unknown>;
  for (const key of ["workdir", "taskId"] as const) {
    if (key in record) {
      return {
        ok: false,
        error: `morph_edit does not support '${key}' or selecting another root. No file was modified. Use native 'edit' or 'apply_patch' with the absolute target path only when that tool is exposed and permitted for the target. Do not retry a refused absolute target as a relative path.`,
      };
    }
  }
  for (const key of ["target_filepath", "instructions", "code_edit"] as const) {
    if (typeof record[key] !== "string") {
      return {
        ok: false,
        error: `morph_edit argument '${key}' is required and must be a string`,
      };
    }
  }
  return { ok: true, args: raw as ExecuteMorphEditArgs };
}

/**
 * Production implementation of morph_edit execution.
 *
 * All external dependencies (fs, api, log, time, context, config) are injected
 * via the `runtime` parameter so this function is fully testable without
 * network access.
 */
export async function executeMorphEdit(
  args: ExecuteMorphEditArgs,
  runtime: ExecuteMorphEditRuntime,
): Promise<MorphEditResult> {
  const { target_filepath, instructions, code_edit } = args;

  const {
    log,
    directory,
    context,
    now,
    readFile,
    writeFile,
    callMorphApply,
    resolveTargetPath,
    normalizeCodeEditInput,
    findDroppedIdentifiers,
    generateUnifiedDiff,
    countChanges,
    constants,
  } = runtime;

  const {
    MORPH_API_KEY,
    ALLOW_READONLY_AGENTS,
    READONLY_AGENTS,
    EXISTING_CODE_MARKER,
  } = constants;

  const normalizedCodeEdit = normalizeCodeEditInput(code_edit);

  // Block usage in readonly agents (plan, explore) unless overridden
  if (!ALLOW_READONLY_AGENTS && READONLY_AGENTS.includes(context.agent)) {
    await log(
      "debug",
      `Blocked morph_edit in readonly agent: ${context.agent}`,
    );
    return {
      status: "refused",
      code: "readonly_agent",
      truncated: false,
      text: `Error: morph_edit is not available in ${context.agent} mode.\n\nThe ${context.agent} agent is read-only and cannot modify files.\n\nOptions:\n1. Switch to 'build' mode (Tab key) to make changes\n2. Use the native 'edit' tool if permitted by your agent config\n3. Set MORPH_ALLOW_READONLY_AGENTS=true to override this restriction`,
    };
  }

  // Resolve and confine target path to allowed root
  const root = context.worktree ?? context.directory ?? directory;
  const resolved = resolveTargetPath(target_filepath, root);
  if ("error" in resolved) {
    await log("warn", `Blocked morph_edit: ${resolved.error}`);
    return {
      status: "refused",
      code: "path_refused",
      truncated: false,
      text: `Error: ${resolved.error}\n\nAllowed root: ${root}\nNo file was modified. Use native 'edit' or 'apply_patch' with the absolute target path only when that tool is exposed and permitted for the target. Do not retry a refused absolute target as a relative path: it may name a different file inside the session root.`,
    };
  }
  const filepath = resolved.path;

  // Check if API key is available
  if (!MORPH_API_KEY) {
    return {
      status: "error",
      code: "missing_api_key",
      truncated: false,
      text: `Error: MORPH_API_KEY not configured.\n\nTo use morph_edit, set the MORPH_API_KEY environment variable.\nGet your API key at: https://morphllm.com/dashboard/api-keys\n\nAlternatively, use the native 'edit' tool for this change.`,
    };
  }

  // Read the original file
  let file: { exists: boolean; text: string };
  try {
    file = await readFile(filepath);
  } catch (err) {
    return {
      status: "error",
      code: "read_failed",
      truncated: false,
      text: `Error reading file ${target_filepath}: ${scrubSecrets(err, MORPH_API_KEY)}`,
    };
  }
  if (!file.exists) {
    // New file - check if this is a creation
    if (!normalizedCodeEdit.includes(EXISTING_CODE_MARKER)) {
      // Simple file creation
      try {
        await writeFile(filepath, normalizedCodeEdit);
      } catch (err) {
        return {
          status: "error",
          code: "write_failed",
          truncated: false,
          text: `Error writing file ${target_filepath}: ${scrubSecrets(err, MORPH_API_KEY)}`,
        };
      }
      return {
        status: "success",
        code: null,
        truncated: false,
        text: `Created new file: ${target_filepath}\n\nLines: ${normalizedCodeEdit.split("\n").length}`,
      };
    }
    return {
      status: "refused",
      code: "file_not_found",
      truncated: false,
      text: `Error: File not found: ${target_filepath}\n\nThe file doesn't exist and the code_edit contains lazy markers.\nFor new files, provide the complete content without "${EXISTING_CODE_MARKER}" markers.`,
    };
  }
  const originalCode = file.text;

  // Pre-flight validation: check for markers to prevent accidental deletions
  const hasMarkers = normalizedCodeEdit.includes(EXISTING_CODE_MARKER);
  const originalLineCount = originalCode.split("\n").length;

  // If file has significant content and no markers, this is likely an error
  if (!hasMarkers && originalLineCount > 10) {
    return {
      status: "refused",
      code: "missing_markers",
      truncated: false,
      text: `Error: Missing "${EXISTING_CODE_MARKER}" markers.\n\nYour code_edit would replace the entire file (${originalLineCount} lines) because it contains no markers.\nThis is almost certainly unintended and would cause code loss.\n\nTo fix, wrap your changes with markers:\n${EXISTING_CODE_MARKER}\nYOUR_CHANGES_HERE\n${EXISTING_CODE_MARKER}\n\nIf you truly want to replace the entire file, use the 'write' tool instead.`,
    };
  }

  // Warn for smaller files but still proceed (might be intentional full replacement)
  if (!hasMarkers && originalLineCount > 3) {
    await log(
      "warn",
      `No markers in code_edit for ${target_filepath} (${originalLineCount} lines). Proceeding with full replacement.`,
    );
  }

  // Call Morph API to merge the edit (with timing)
  const startTime = now();
  const result = await callMorphApply(
    originalCode,
    normalizedCodeEdit,
    instructions,
  );
  const apiDuration = now() - startTime;

  if (!result.success || !result.content) {
    const safeError = scrubSecrets(
      result.error || "unknown error",
      MORPH_API_KEY,
    );
    return {
      status: "error",
      code:
        result.kind ??
        (result.success ? "api_empty_response" : "api_request_failed"),
      truncated: false,
      text: `Morph API failed: ${safeError}\n\nSuggestion: Try using the native 'edit' tool instead with exact string replacement.\nThe edit tool requires matching the exact text in the file.`,
    };
  }

  const mergedCode = result.content;

  // Post-merge guard: marker leakage detection
  //
  // Fires regardless of whether the code_edit carried markers: a merged file
  // should never gain literal marker text it did not previously contain. The
  // `!originalHadMarker` precondition avoids false positives on files that
  // legitimately contain the marker string.
  const originalHadMarker = originalCode.includes(EXISTING_CODE_MARKER);
  if (!originalHadMarker && mergedCode.includes(EXISTING_CODE_MARKER)) {
    await log(
      "warn",
      `Marker leakage detected in merged output for ${target_filepath}`,
    );
    return {
      status: "refused",
      code: "marker_leakage",
      truncated: false,
      text: `Morph API produced unsafe output for ${target_filepath}.\n\nDetected placeholder marker text ("${EXISTING_CODE_MARKER}") in merged output.\nThis means the merge model treated markers as literal code instead of expanding them.\n\nNo file changes were written.\n\nOptions:\n1. Retry with more concrete surrounding context in code_edit\n2. Use the native 'edit' tool for exact string replacement\n3. Break the change into smaller, more targeted edits`,
    };
  }

  // Post-merge guard: catastrophic truncation detection
  //
  // Runs for both marker and no-marker edits. The "expected" output differs by
  // mode: for marker edits the merged result should be ~the original file; for
  // a no-marker full replacement it should be ~the provided code_edit. Comparing
  // the merged output against the right baseline catches Morph mangling in both
  // modes without false-positiving an intentional small replacement (where the
  // merged result is close to the code_edit and therefore shows ~0 loss).
  const mergedLineCount = mergedCode.split("\n").length;
  const truncationBaseline = hasMarkers ? originalCode : normalizedCodeEdit;
  const baselineLineCount = truncationBaseline.split("\n").length;
  const charLoss =
    truncationBaseline.length > 0
      ? (truncationBaseline.length - mergedCode.length) /
        truncationBaseline.length
      : 0;
  const lineLoss =
    baselineLineCount > 0
      ? (baselineLineCount - mergedLineCount) / baselineLineCount
      : 0;

  if (charLoss > 0.6 && lineLoss > 0.5) {
    await log(
      "warn",
      `Catastrophic truncation detected for ${target_filepath}: ${Math.round(charLoss * 100)}% char loss, ${Math.round(lineLoss * 100)}% line loss`,
    );
    const baselineLabel = hasMarkers
      ? `Original: ${originalLineCount} lines (${originalCode.length} chars)`
      : `Your edit: ${baselineLineCount} lines (${truncationBaseline.length} chars)`;
    const reason = hasMarkers
      ? "Because markers were provided, this large shrink is likely unintended."
      : "The merged result is far smaller than the replacement you provided, indicating the merge model mangled the edit.";
    return {
      status: "refused",
      code: "catastrophic_truncation",
      truncated: false,
      text: `Morph API produced a potentially destructive merge for ${target_filepath}.\n\n${baselineLabel}\nMerged:   ${mergedLineCount} lines (${mergedCode.length} chars)\nLoss:     ${Math.round(charLoss * 100)}% characters, ${Math.round(lineLoss * 100)}% lines\n\n${reason}\nNo file changes were written.\n\nOptions:\n1. Retry with more precise anchors in code_edit\n2. Use the native 'edit' tool for exact string replacement\n3. Break the change into smaller edits`,
    };
  }

  // Post-merge guard: import identifier preservation
  const droppedIds = findDroppedIdentifiers(
    originalCode,
    mergedCode,
    target_filepath,
  );
  if (droppedIds.length > 0) {
    await log(
      "warn",
      `Dropped import identifiers detected for ${target_filepath}: ${droppedIds.join(", ")}`,
    );
    return {
      status: "refused",
      code: "dropped_imports",
      truncated: false,
      text: `Morph API produced a merge with missing imports for ${target_filepath}.\n\nOriginal file imported identifiers that are absent from the merged result:\n  ${droppedIds.map((id) => `• ${id}`).join("\n  ")}\n\nThis is a known Morph model accuracy issue (#5) where imports outside the\nedit's anchoring context get silently dropped.\n\nNo file changes were written.\n\nOptions:\n1. Retry with the import block included as context in code_edit\n2. Use the native 'edit' tool for exact string replacement\n3. Break the change into smaller, more targeted edits`,
    };
  }

  // Write the merged result
  try {
    await writeFile(filepath, mergedCode);
  } catch (err) {
    return {
      status: "error",
      code: "write_failed",
      truncated: false,
      text: `Error writing file ${target_filepath}: ${scrubSecrets(err, MORPH_API_KEY)}`,
    };
  }

  // Generate unified diff
  const diff = generateUnifiedDiff(target_filepath, originalCode, mergedCode);

  // Calculate change stats
  const { added, removed } = countChanges(diff);
  const originalLines = originalCode.split("\n").length;
  const mergedLines = mergedCode.split("\n").length;

  const truncated = diff.length > 3000;
  return {
    status: "success",
    code: null,
    truncated,
    text: `Applied edit to ${target_filepath}\n\n+${added} -${removed} lines | ${originalLines} -> ${mergedLines} total | ${apiDuration}ms\n\n\`\`\`diff\n${diff.slice(0, 3000)}${truncated ? "\n... (truncated)" : ""}\n\`\`\``,
  };
}
