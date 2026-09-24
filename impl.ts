/**
 * OpenCode Morph Fast Apply Plugin
 *
 * Integrates Morph's Fast Apply API for 10x faster code editing.
 * Uses lazy edit markers (// ... existing code ...) for partial file updates.
 *
 * @see https://docs.morphllm.com/quickstart
 */

import { type Plugin, tool } from "@opencode-ai/plugin";
import { Plugin as PluginV2 } from "@opencode/plugin";
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
import {
  executeMorphEdit,
  parseMorphEditArgs,
  type ExecuteMorphEditRuntime,
} from "./src/execute.js";
import { readCapabilityRoot } from "./src/adv-capability.js";

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
    /Bearer\s+[A-Za-z0-9_.-]{10,}/gi,
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
 * Shared morph_edit argument descriptions. One name per field across the V1
 * tool schema and the V2 JSON Schema so both registries stay in sync.
 */
const FIELD_DESCRIPTIONS = {
  target_filepath: "Path of the file to modify",
  instructions:
    "Brief first-person description of what you're changing. Used to disambiguate uncertainty in the edit.",
  code_edit:
    'The code changes wrapped with "// ... existing code ..." markers for unchanged sections',
  workdir:
    "ADV worktree root. Pass with taskId to edit ADV per-change worktrees; ADV validates both against the task's worktree. Omit for session-repo edits.",
  taskId:
    "ADV task ID. Pass with workdir to edit ADV per-change worktrees; ADV validates both. Omit for session-repo edits.",
} as const;

/**
 * Shared morph_edit tool description (V1 tool + V2 registration).
 */
const MORPH_EDIT_DESCRIPTION = `Edit existing files using partial code snippets with "// ... existing code ..." markers. Morph's AI merges your changes into the full file.

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

FALLBACK: If morph_edit fails (API error, timeout), use the native 'edit' tool with exact oldString/newString matching.`;

/**
 * Format the branded TUI title from a morph_edit text result.
 *
 * Shared by the V1 "tool.execute.after" hook and the V2 "execute.after"
 * completed hook so both surfaces keep one title grammar. Returns undefined
 * when no known outcome pattern matches (the caller leaves the default title).
 */
export function formatMorphEditTitle(text: string): string | undefined {
  const fileMatch = text.match(/Applied edit to (.+?)\n/);
  const statsMatch = text.match(/\+(\d+) -(\d+) lines/);
  const timingMatch = text.match(/\| (\d+)ms/);
  const createdMatch = text.match(/Created new file: (.+?)\n/);
  const linesMatch = text.match(/Lines: (\d+)/);
  const errorMatch = text.match(/^Error:/);
  const blockedMatch = text.match(/not available in (.+?) mode/);
  const apiFailMatch = text.match(/^Morph API failed:/);
  const unsafeMatch = text.match(
    /^Morph API produced unsafe output for (.+?)\./,
  );
  const truncationMatch = text.match(
    /^Morph API produced a potentially destructive merge for (.+?)\./,
  );
  const droppedImportsMatch = text.match(
    /^Morph API produced a merge with missing imports for (.+?)\./,
  );

  if (createdMatch) {
    // New file created
    const lines = linesMatch?.[1] || "?";
    return `Morph: ${createdMatch[1]} (new, ${lines} lines)`;
  }
  if (fileMatch && statsMatch) {
    // Successful edit
    const timing = timingMatch ? ` (${timingMatch[1]}ms)` : "";
    return `Morph: ${fileMatch[1]} +${statsMatch[1]}/-${statsMatch[2]}${timing}`;
  }
  if (unsafeMatch) {
    // Post-merge guard: marker leakage
    return `Morph: blocked (marker leakage) ${unsafeMatch[1]}`;
  }
  if (truncationMatch) {
    // Post-merge guard: catastrophic truncation
    return `Morph: blocked (truncation) ${truncationMatch[1]}`;
  }
  if (droppedImportsMatch) {
    // Post-merge guard: dropped import identifiers
    return `Morph: blocked (dropped imports) ${droppedImportsMatch[1]}`;
  }
  if (blockedMatch) {
    // Blocked by readonly agent
    return `Morph: blocked (${blockedMatch[1]} mode)`;
  }
  if (apiFailMatch) {
    // API failure
    return `Morph: API failed`;
  }
  if (errorMatch) {
    // Other error
    return `Morph: failed`;
  }
  return undefined;
}

/**
 * Branded structured metadata for a morph_edit text result, shared by the V1
 * hook (spread into output.metadata) and the V2 completed hook (spread into
 * result.metadata).
 */
export function morphEditMetadata(text: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    provider: "morph",
    version: PLUGIN_VERSION,
    model: MORPH_MODEL,
  };
  const title = formatMorphEditTitle(text);
  if (title) metadata.title = title;
  return metadata;
}

/**
 * Extract the text payload from a V2 tool result for title/metadata
 * formatting. Falls back to a string `output` so both V1- and V2-shaped
 * results feed the same formatter.
 */
function morphEditResultText(result: {
  content?: unknown;
  output?: unknown;
}): string {
  const content = result.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (part): part is { type: "text"; text: string } =>
          typeof part === "object" &&
          part !== null &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string",
      )
      .map((part) => part.text)
      .join("\n");
  }
  return typeof result.output === "string" ? result.output : "";
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
      error: scrubSecrets(`Morph API request failed: ${error.message}`, apiKey),
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
        description: MORPH_EDIT_DESCRIPTION,

        args: {
          target_filepath: tool.schema
            .string()
            .describe(FIELD_DESCRIPTIONS.target_filepath),
          instructions: tool.schema
            .string()
            .describe(FIELD_DESCRIPTIONS.instructions),
          code_edit: tool.schema
            .string()
            .describe(FIELD_DESCRIPTIONS.code_edit),
          workdir: tool.schema
            .string()
            .optional()
            .describe(FIELD_DESCRIPTIONS.workdir),
          taskId: tool.schema
            .string()
            .optional()
            .describe(FIELD_DESCRIPTIONS.taskId),
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
            readCapabilityRoot,
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
        // Shared branded title formatting (also used by the V2 adapter)
        const title = formatMorphEditTitle(output.output);
        if (title) {
          output.title = title;
        }

        output.metadata = {
          ...output.metadata,
          ...morphEditMetadata(output.output),
        };
      }
    },
  };
};

/**
 * Options for the OpenCode V2 adapter setup.
 */
export interface MorphEditV2SetupOptions {
  /**
   * Partial runtime overrides merged into the production runtime on every
   * tool execution. Production callers omit it; adapter tests inject mock
   * fs/API dependencies so the V2 path is verifiable without network access.
   */
  runtimeOverrides?: Partial<ExecuteMorphEditRuntime>;
}

/**
 * OpenCode V2 adapter: registers exactly one morph_edit tool through the V2
 * plugin API and attaches branded metadata in the execute.after completed
 * hook. Shares MORPH_EDIT_DESCRIPTION, the execution law (executeMorphEdit),
 * and the title formatting with the V1 adapter.
 */
export async function setupMorphEditV2(
  ctx: PluginV2.Context,
  options?: MorphEditV2SetupOptions,
): Promise<void> {
  // The V2 plugin context exposes no client or log domain; logging falls
  // back to stderr for both adapters' shared log signature.
  const log = async (
    level: "debug" | "info" | "warn" | "error",
    message: string,
  ) => {
    process.stderr.write(`[morph-fast-apply] ${level}: ${message}\n`);
  };

  await ctx.tool.transform((editor) => {
    editor.add({
      name: "morph_edit",
      description: MORPH_EDIT_DESCRIPTION,
      input: {
        type: "object",
        properties: {
          target_filepath: {
            type: "string",
            description: FIELD_DESCRIPTIONS.target_filepath,
          },
          instructions: {
            type: "string",
            description: FIELD_DESCRIPTIONS.instructions,
          },
          code_edit: {
            type: "string",
            description: FIELD_DESCRIPTIONS.code_edit,
          },
          workdir: {
            type: "string",
            description: FIELD_DESCRIPTIONS.workdir,
          },
          taskId: {
            type: "string",
            description: FIELD_DESCRIPTIONS.taskId,
          },
        },
        required: ["target_filepath", "instructions", "code_edit"],
      },

      async execute(rawArgs, toolContext) {
        // Untrusted tool input is recognized at the boundary before the
        // shared execution law runs.
        const parsed = parseMorphEditArgs(rawArgs);
        if (!parsed.ok) {
          return {
            content: [{ type: "text", text: `Error: ${parsed.error}` }],
          };
        }

        // Confinement root, resolved per invocation: the V2 tool context
        // carries no directory, and the plugin load location can differ from
        // the session location, so ask the session domain each call.
        let directory: string | undefined;
        try {
          const session = await ctx.session.get({
            sessionID: toolContext.sessionID,
          });
          directory = session?.location?.directory;
        } catch (err) {
          await log("warn", `session lookup failed: ${scrubSecrets(err)}`);
        }
        if (!directory) {
          return {
            content: [
              {
                type: "text",
                text: "Error: could not resolve the session directory for morph_edit.\nNo file was modified. Check the session state before retrying the edit.",
              },
            ],
          };
        }

        const text = await executeMorphEdit(parsed.args, {
          log,
          directory,
          context: { agent: toolContext.agent },
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
          readCapabilityRoot,
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
          ...options?.runtimeOverrides,
        });

        // V2 consumes structured content; the shared text grammar is wrapped,
        // not duplicated.
        return { content: [{ type: "text", text }] };
      },
    });
  });

  await ctx.tool.hook("execute.after", (hookInput) => {
    if (hookInput.tool !== "morph_edit") return;
    if (hookInput.status !== "completed") return;
    const text = morphEditResultText(hookInput.result);
    // Tool.Result fields are readonly; replace the result object with the
    // branded metadata attached.
    hookInput.result = {
      ...hookInput.result,
      metadata: {
        ...hookInput.result.metadata,
        ...morphEditMetadata(text),
      },
    };
  });
}

/**
 * Stable plugin identity shared by both adapters.
 */
export const MORPH_PLUGIN_ID = "opencode-morph-fast-apply";

/**
 * Dual-entry plugin object.
 *
 * - OpenCode V2 decodes the default export as a Promise plugin `{ id, setup }`
 *   and runs `setup` (the extra `server` key is an ignored excess property).
 * - OpenCode V1 (1.18.29+) reads the default export as a `{ server }`
 *   adapter and calls `server(input)` for its hooks object. Older V1 loaders
 *   only invoke function-valued exports, so the object export is skipped and
 *   the plugin does not load there (documented in README).
 *
 * Each loader therefore registers exactly one morph_edit, and both adapters
 * share one execution law and one title grammar.
 */
const morphFastApplyPlugin = {
  id: MORPH_PLUGIN_ID,
  setup: setupMorphEditV2,
  server: MorphFastApply,
} satisfies PluginV2.Plugin & { server: typeof MorphFastApply };

// Default export for OpenCode plugin loader
export default morphFastApplyPlugin;
