/**
 * OpenCode Morph Fast Apply Plugin
 *
 * Integrates Morph's Fast Apply API for 10x faster code editing.
 * Uses lazy edit markers (// ... existing code ...) for partial file updates.
 *
 * @see https://docs.morphllm.com/quickstart
 */

import { type Plugin, tool } from "@opencode-ai/plugin";
import {
  ALLOW_READONLY_AGENTS,
  EXISTING_CODE_MARKER,
  MORPH_API_KEY,
  MORPH_API_URL,
  MORPH_MODEL,
  MORPH_TIMEOUT,
  PLUGIN_VERSION,
  READONLY_AGENTS,
} from "./src/constants.js";
import { countChanges, generateUnifiedDiff } from "./src/diff.js";
import { findDroppedIdentifiers } from "./src/imports.js";
import { normalizeCodeEditInput } from "./src/normalize.js";
import { resolveTargetPath } from "./src/path-confinement.js";
import { executeMorphEdit } from "./src/execute.js";

/**
 * Stable failure-kind classification for API/guard/write failures.
 * These strings are safe to log and contain no secrets.
 */
export type FailureKind =
  | "api_timeout"
  | "api_http_error"
  | "api_parse_error"
  | "api_request_failed"
  | "api_empty_response"
  | "missing_api_key";

/**
 * Remove secrets from a message before returning or logging it.
 */
export function scrubSecrets(message: unknown, apiKey?: unknown): string {
  let result: string;
  if (typeof message === "string") {
    result = message;
  } else if (message instanceof Error) {
    result = message.message;
  } else {
    try {
      result = String(message ?? "");
    } catch {
      result = "";
    }
  }
  if (typeof apiKey === "string" && apiKey.length > 0) {
    result = result.split(apiKey).join("***REDACTED***");
  }
  // Scrub generic Bearer tokens
  result = result.replace(
    /Bearer\s+[A-Za-z0-9_\-\.]{10,}/gi,
    "Bearer ***REDACTED***",
  );
  return result;
}

export interface CallMorphApplyResult {
  success: boolean;
  content?: string;
  error?: string;
  kind?: FailureKind;
}

/**
 * Call Morph's Apply API to merge code edits.
 *
 * The AbortController timeout stays active through the full response lifecycle
 * (fetch, error body read, and JSON body parse) so slow body streams are also
 * bounded.
 */
export async function callMorphApply(
  originalCode: string,
  codeEdit: string,
  instructions: string,
  options?: {
    timeout?: number;
    apiKey?: string;
    apiUrl?: string;
    model?: string;
  },
): Promise<CallMorphApplyResult> {
  const {
    timeout = MORPH_TIMEOUT,
    apiKey = MORPH_API_KEY,
    apiUrl = MORPH_API_URL,
    model = MORPH_MODEL,
  } = options || {};

  if (!apiKey) {
    return {
      success: false,
      error:
        "MORPH_API_KEY not set. Get one at https://morphllm.com/dashboard/api-keys",
      kind: "missing_api_key",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${apiUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: `<instruction>${instructions}</instruction>\n<code>${originalCode}</code>\n<update>${codeEdit}</update>`,
          },
        ],
        temperature: 0,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      clearTimeout(timeoutId);
      return {
        success: false,
        error: scrubSecrets(
          `Morph API error (${response.status}): ${errorText}`,
          apiKey,
        ),
        kind: "api_http_error",
      };
    }

    let result: { choices: Array<{ message: { content: string } }> };
    try {
      result = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
    } catch (parseErr) {
      clearTimeout(timeoutId);
      // A timeout that fires while the response body is being read/parsed
      // surfaces here as an AbortError. Classify it as a timeout rather than a
      // parse error so failures are diagnosed correctly.
      const e = parseErr as Error;
      if (e?.name === "AbortError" || controller.signal.aborted) {
        return {
          success: false,
          error: `Morph API timeout after ${timeout}ms`,
          kind: "api_timeout",
        };
      }
      return {
        success: false,
        error: "Morph API returned invalid JSON",
        kind: "api_parse_error",
      };
    }

    clearTimeout(timeoutId);
    const mergedCode = result.choices?.[0]?.message?.content;

    if (!mergedCode) {
      return {
        success: false,
        error: "Morph API returned empty response",
        kind: "api_empty_response",
      };
    }

    return {
      success: true,
      content: mergedCode,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const error = err as Error;
    if (error.name === "AbortError") {
      return {
        success: false,
        error: `Morph API timeout after ${timeout}ms`,
        kind: "api_timeout",
      };
    }
    return {
      success: false,
      error: scrubSecrets(
        `Morph API request failed: ${error.message}`,
        apiKey,
      ),
      kind: "api_request_failed",
    };
  }
}

const MorphFastApply: Plugin = async ({ directory, client }) => {
  /**
   * Helper for structured logging with stderr fallback
   */
  const log = async (
    level: "debug" | "info" | "warn" | "error",
    message: string,
  ) => {
    try {
      await client.app.log({
        body: {
          service: "morph-fast-apply",
          level,
          message,
        },
      });
    } catch {
      // Fallback to stderr if SDK logging fails
      process.stderr.write(`[morph-fast-apply] ${message}\n`);
    }
  };

  // Log plugin initialization status
  if (!MORPH_API_KEY) {
    await log(
      "warn",
      "MORPH_API_KEY not set - morph_edit tool will be disabled",
    );
  } else {
    await log("info", `Plugin loaded with model: ${MORPH_MODEL}`);
  }

  return {
    tool: {
      /**
       * morph_edit - Fast code editing using Morph's Apply API
       *
       * Use this tool for efficient partial file edits. It's 10x faster than
       * traditional edit tools for large files and complex changes.
       *
       * Uses "// ... existing code ..." markers to represent unchanged sections.
       */
      morph_edit: tool({
        description: `Edit existing files using partial code snippets with "// ... existing code ..." markers. Morph's AI merges your changes into the full file.

WHEN TO USE morph_edit vs edit:
- morph_edit: large files (300+ lines), multiple scattered changes, complex refactoring, whitespace-sensitive edits
- native edit: small exact string replacements, simple renames, single-line fixes (faster, no API call)
- native write: creating new files from scratch

FORMAT — use "// ... existing code ..." to represent unchanged sections:
// ... existing code ...
FIRST_EDIT
// ... existing code ...
SECOND_EDIT
// ... existing code ...

CRITICAL RULES:
- ALWAYS wrap changes with markers at start AND end (omitting markers DELETES surrounding code)
- Include 1-2 unique context lines around each edit to anchor the location precisely
- Write a specific 'instructions' param: "I am adding X to function Y" not "update code"
- Preserve exact indentation
- For deletions: show surrounding context, omit the deleted lines
- Batch multiple edits to the same file in one call

DISAMBIGUATION — when a file has repeated patterns, include enough unique context:
  BAD:  just "return result;" (matches many places)
  GOOD: include the unique function signature above it

NATIVE EDIT RECOVERY — when a native edit reports an unmatched or ambiguous exact target:
- Re-read the target file before any retry.
- Do not repeat the unchanged failed edit input.
- Make at most one corrected native edit only when the re-read proves the change is still small and exact.
- Otherwise use morph_edit for the contextual repair (multi-line, scattered, whitespace-sensitive, or broader anchoring).
- Use write only for new-file or intentional full-file replacement.

This recovery is separate from the Morph API-error/timeout fallback below, which still recovers to native edit.

FALLBACK: If morph_edit fails (API error, timeout), use the native 'edit' tool with exact oldString/newString matching.`,

        args: {
          target_filepath: tool.schema
            .string()
            .describe("Path of the file to modify"),
          instructions: tool.schema
            .string()
            .describe(
              "Brief first-person description of what you're changing. Used to disambiguate uncertainty in the edit.",
            ),
          code_edit: tool.schema
            .string()
            .describe(
              'The code changes wrapped with "// ... existing code ..." markers for unchanged sections',
            ),
        },

        async execute(args, context) {
          return executeMorphEdit(args, {
            log,
            directory,
            context,
            now: () => Date.now(),
            readFile: async (filepath) => {
              const file = Bun.file(filepath);
              const exists = await file.exists();
              return {
                exists,
                text: exists ? await file.text() : "",
              };
            },
            writeFile: async (filepath, content) => {
              await Bun.write(filepath, content);
            },
            callMorphApply,
            resolveTargetPath,
            normalizeCodeEditInput,
            findDroppedIdentifiers,
            generateUnifiedDiff,
            countChanges,
            constants: {
              MORPH_API_KEY,
              ALLOW_READONLY_AGENTS,
              READONLY_AGENTS,
              EXISTING_CODE_MARKER,
              PLUGIN_VERSION,
              MORPH_MODEL,
            },
          });
        },
      }),
    },

    /**
     * Customize tool output display in TUI
     */
    "tool.execute.after": async (input, output) => {
      if (input.tool === "morph_edit") {
        // Parse output to build a branded title
        const fileMatch = output.output.match(/Applied edit to (.+?)\n/);
        const statsMatch = output.output.match(/\+(\d+) -(\d+) lines/);
        const timingMatch = output.output.match(/\| (\d+)ms/);
        const createdMatch = output.output.match(/Created new file: (.+?)\n/);
        const linesMatch = output.output.match(/Lines: (\d+)/);
        const errorMatch = output.output.match(/^Error:/);
        const blockedMatch = output.output.match(/not available in (.+?) mode/);
        const apiFailMatch = output.output.match(/^Morph API failed:/);
        const unsafeMatch = output.output.match(
          /^Morph API produced unsafe output for (.+?)\./,
        );
        const truncationMatch = output.output.match(
          /^Morph API produced a potentially destructive merge for (.+?)\./,
        );
        const droppedImportsMatch = output.output.match(
          /^Morph API produced a merge with missing imports for (.+?)\./,
        );

        if (createdMatch) {
          // New file created
          const lines = linesMatch?.[1] || "?";
          output.title = `Morph: ${createdMatch[1]} (new, ${lines} lines)`;
        } else if (fileMatch && statsMatch) {
          // Successful edit
          const timing = timingMatch ? ` (${timingMatch[1]}ms)` : "";
          output.title = `Morph: ${fileMatch[1]} +${statsMatch[1]}/-${statsMatch[2]}${timing}`;
        } else if (unsafeMatch) {
          // Post-merge guard: marker leakage
          output.title = `Morph: blocked (marker leakage) ${unsafeMatch[1]}`;
        } else if (truncationMatch) {
          // Post-merge guard: catastrophic truncation
          output.title = `Morph: blocked (truncation) ${truncationMatch[1]}`;
        } else if (droppedImportsMatch) {
          // Post-merge guard: dropped import identifiers
          output.title = `Morph: blocked (dropped imports) ${droppedImportsMatch[1]}`;
        } else if (blockedMatch) {
          // Blocked by readonly agent
          output.title = `Morph: blocked (${blockedMatch[1]} mode)`;
        } else if (apiFailMatch) {
          // API failure
          output.title = `Morph: API failed`;
        } else if (errorMatch) {
          // Other error
          output.title = `Morph: failed`;
        }

        // Add structured metadata for potential future TUI enhancements
        output.metadata = {
          ...output.metadata,
          provider: "morph",
          version: PLUGIN_VERSION,
          model: MORPH_MODEL,
        };
      }
    },
  };
};

// Default export for OpenCode plugin loader
export default MorphFastApply;
