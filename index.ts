/**
 * OpenCode Morph Fast Apply Plugin
 *
 * Integrates Morph's Fast Apply API for 10x faster code editing.
 * Uses lazy edit markers (// ... existing code ...) for partial file updates.
 *
 * @see https://docs.morphllm.com/quickstart
 */

import { type Plugin, tool } from "@opencode-ai/plugin"
import { createTwoFilesPatch } from "diff"

// Get API key from environment (set in mcpm/jarvis config)
const MORPH_API_KEY = process.env.MORPH_API_KEY
const MORPH_API_URL = process.env.MORPH_API_URL || "https://api.morphllm.com"
const MORPH_MODEL = process.env.MORPH_MODEL || "morph-v3-fast"
const MORPH_TIMEOUT = parseInt(process.env.MORPH_TIMEOUT || "30000", 10)

/**
 * Agents that are blocked from using morph_edit by default.
 * Users can override by setting MORPH_ALLOW_READONLY_AGENTS=true
 */
const READONLY_AGENTS = ["plan", "explore"]
const ALLOW_READONLY_AGENTS =
  process.env.MORPH_ALLOW_READONLY_AGENTS === "true"

/** Plugin version */
const PLUGIN_VERSION = "1.5.0"

/**
 * Generate a unified diff with context for display
 */
function generateUnifiedDiff(
  filepath: string,
  original: string,
  modified: string
): string {
  // Use proper unified diff with 3 lines of context
  const patch = createTwoFilesPatch(
    `a/${filepath}`,
    `b/${filepath}`,
    original,
    modified,
    "",
    "",
    { context: 3 }
  )

  // If no changes, return early
  if (!patch.includes("@@")) {
    return "No changes detected"
  }

  return patch
}

/**
 * Count additions and deletions from a unified diff
 */
function countChanges(diff: string): { added: number; removed: number } {
  const lines = diff.split("\n")
  let added = 0
  let removed = 0

  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added++
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed++
    }
  }

  return { added, removed }
}

/** Canonical marker string used for lazy edit placeholders */
export const EXISTING_CODE_MARKER = "// ... existing code ..."

/**
 * Normalize code_edit input from LLM tool calls.
 *
 * Agents frequently wrap tool arguments in markdown fences (```lang ... ```).
 * When this is nested inside Morph's <update> XML tag, it confuses the merge
 * model. This function strips a single outer fence pair using line-based parsing.
 *
 * @param codeEdit - Raw code_edit string from the tool call
 * @returns The code content with outer markdown fences removed, if present
 */
export function normalizeCodeEditInput(codeEdit: string): string {
  const trimmed = codeEdit.trim()
  const lines = trimmed.split("\n")

  if (lines.length < 3) return codeEdit

  const firstLine = lines[0]
  const lastLine = lines[lines.length - 1]

  if (/^```[\w-]*$/.test(firstLine) && /^```$/.test(lastLine)) {
    return lines.slice(1, -1).join("\n")
  }

  return codeEdit
}

/**
 * Call Morph's Apply API to merge code edits
 */
async function callMorphApply(
  originalCode: string,
  codeEdit: string,
  instructions: string
): Promise<{ success: boolean; content?: string; error?: string }> {
  if (!MORPH_API_KEY) {
    return {
      success: false,
      error:
        "MORPH_API_KEY not set. Get one at https://morphllm.com/dashboard/api-keys",
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), MORPH_TIMEOUT)

  try {
    const response = await fetch(`${MORPH_API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MORPH_API_KEY}`,
      },
      body: JSON.stringify({
        model: MORPH_MODEL,
        messages: [
          {
            role: "user",
            content: `<instruction>${instructions}</instruction>\n<code>${originalCode}</code>\n<update>${codeEdit}</update>`,
          },
        ],
        temperature: 0,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `Morph API error (${response.status}): ${errorText}`,
      }
    }

    const result = (await response.json()) as {
      choices: Array<{ message: { content: string } }>
    }
    const mergedCode = result.choices?.[0]?.message?.content

    if (!mergedCode) {
      return {
        success: false,
        error: "Morph API returned empty response",
      }
    }

    return {
      success: true,
      content: mergedCode,
    }
  } catch (err) {
    clearTimeout(timeoutId)
    const error = err as Error
    if (error.name === "AbortError") {
      return {
        success: false,
        error: `Morph API timeout after ${MORPH_TIMEOUT}ms`,
      }
    }
    return {
      success: false,
      error: `Morph API request failed: ${error.message}`,
    }
  }
}

export const MorphFastApply: Plugin = async ({ directory, client }) => {
  /**
   * Helper for structured logging with stderr fallback
   */
  const log = async (
    level: "debug" | "info" | "warn" | "error",
    message: string
  ) => {
    try {
      await client.app.log({
        body: {
          service: "morph-fast-apply",
          level,
          message,
        },
      })
    } catch {
      // Fallback to stderr if SDK logging fails
      process.stderr.write(`[morph-fast-apply] ${message}\n`)
    }
  }

  // Log plugin initialization status
  if (!MORPH_API_KEY) {
    await log(
      "warn",
      "MORPH_API_KEY not set - morph_edit tool will be disabled"
    )
  } else {
    await log("info", `Plugin loaded with model: ${MORPH_MODEL}`)
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
        description: `Use this tool to edit existing files by showing only the changed lines.

USAGE GUIDELINES:
- Use 'morph_edit' for: multi-hunk edits, large files (300+ lines), complex refactoring, or when exact string matching is difficult.
- Use native 'edit' for: simple single-string replacements, small files (<50 lines), or creating new files.

Use "// ... existing code ..." to represent unchanged code blocks. Include just enough surrounding context to locate each edit precisely.

Example format:
// ... existing code ...
FIRST_EDIT
// ... existing code ...
SECOND_EDIT
// ... existing code ...

Rules:
- ALWAYS use "// ... existing code ..." for unchanged sections (omitting this marker will cause deletions)
- ALWAYS wrap your changes with markers at the start AND end to preserve surrounding code
- Include minimal context around edits for disambiguation
- Preserve exact indentation
- For deletions: show context before and after, omit the deleted lines
- Batch multiple edits to the same file in one call`,

        args: {
          target_filepath: tool.schema
            .string()
            .describe("Path of the file to modify"),
          instructions: tool.schema
            .string()
            .describe(
              "Brief first-person description of what you're changing. Used to disambiguate uncertainty in the edit."
            ),
          code_edit: tool.schema
            .string()
            .describe(
              'The code changes wrapped with "// ... existing code ..." markers for unchanged sections'
            ),
        },

        async execute(args, context) {
          const { target_filepath, instructions, code_edit } = args
          const normalizedCodeEdit = normalizeCodeEditInput(code_edit)

          // Block usage in readonly agents (plan, explore) unless overridden
          if (!ALLOW_READONLY_AGENTS && READONLY_AGENTS.includes(context.agent)) {
            await log(
              "debug",
              `Blocked morph_edit in readonly agent: ${context.agent}`
            )
            return `Error: morph_edit is not available in ${context.agent} mode.

The ${context.agent} agent is read-only and cannot modify files.

Options:
1. Switch to 'build' mode (Tab key) to make changes
2. Use the native 'edit' tool if permitted by your agent config
3. Set MORPH_ALLOW_READONLY_AGENTS=true to override this restriction`
          }

          // Resolve file path relative to project directory
          const filepath = target_filepath.startsWith("/")
            ? target_filepath
            : `${directory}/${target_filepath}`

          // Check if API key is available
          if (!MORPH_API_KEY) {
            return `Error: MORPH_API_KEY not configured.

To use morph_edit, set the MORPH_API_KEY environment variable.
Get your API key at: https://morphllm.com/dashboard/api-keys

Alternatively, use the native 'edit' tool for this change.`
          }

          // Read the original file
          let originalCode: string
          try {
            const file = Bun.file(filepath)
            if (!(await file.exists())) {
              // New file - check if this is a creation
              if (!normalizedCodeEdit.includes(EXISTING_CODE_MARKER)) {
                // Simple file creation
                await Bun.write(filepath, normalizedCodeEdit)
                return `Created new file: ${target_filepath}\n\nLines: ${normalizedCodeEdit.split("\n").length}`
              }
              return `Error: File not found: ${target_filepath}

The file doesn't exist and the code_edit contains lazy markers.
For new files, provide the complete content without "${EXISTING_CODE_MARKER}" markers.`
            }
            originalCode = await file.text()
          } catch (err) {
            const error = err as Error
            return `Error reading file ${target_filepath}: ${error.message}`
          }

          // Pre-flight validation: check for markers to prevent accidental deletions
          const hasMarkers = normalizedCodeEdit.includes(EXISTING_CODE_MARKER)
          const originalLineCount = originalCode.split("\n").length

          // If file has significant content and no markers, this is likely an error
          if (!hasMarkers && originalLineCount > 10) {
            return `Error: Missing "${EXISTING_CODE_MARKER}" markers.

Your code_edit would replace the entire file (${originalLineCount} lines) because it contains no markers.
This is almost certainly unintended and would cause code loss.

To fix, wrap your changes with markers:
${EXISTING_CODE_MARKER}
YOUR_CHANGES_HERE
${EXISTING_CODE_MARKER}

If you truly want to replace the entire file, use the 'write' tool instead.`
          }

          // Warn for smaller files but still proceed (might be intentional full replacement)
          if (!hasMarkers && originalLineCount > 3) {
            // Log warning but continue - small files might be intentional replacements
            await log(
              "warn",
              `No markers in code_edit for ${target_filepath} (${originalLineCount} lines). Proceeding with full replacement.`
            )
          }

          // Call Morph API to merge the edit (with timing)
          const startTime = Date.now()
          const result = await callMorphApply(
            originalCode,
            normalizedCodeEdit,
            instructions
          )
          const apiDuration = Date.now() - startTime

          if (!result.success || !result.content) {
            // Return error with suggestion to use native edit
            return `Morph API failed: ${result.error}

Suggestion: Try using the native 'edit' tool instead with exact string replacement.
The edit tool requires matching the exact text in the file.`
          }

          const mergedCode = result.content

          // Post-merge guard: marker leakage detection
          // If the merged output contains the placeholder marker but the original
          // file did not, the model treated markers as literal code instead of
          // expanding them. Skip check for self-referential files (docs, tests
          // for this plugin) that legitimately contain the marker string.
          const originalHadMarker = originalCode.includes(EXISTING_CODE_MARKER)
          if (
            hasMarkers &&
            !originalHadMarker &&
            mergedCode.includes(EXISTING_CODE_MARKER)
          ) {
            await log(
              "warn",
              `Marker leakage detected in merged output for ${target_filepath}`
            )
            return `Morph API produced unsafe output for ${target_filepath}.

Detected placeholder marker text ("${EXISTING_CODE_MARKER}") in merged output.
This means the merge model treated markers as literal code instead of expanding them.

No file changes were written.

Options:
1. Retry with more concrete surrounding context in code_edit
2. Use the native 'edit' tool for exact string replacement
3. Break the change into smaller, more targeted edits`
          }

          // Post-merge guard: catastrophic truncation detection
          // If the merged output loses >60% of characters AND >50% of lines,
          // the model likely failed to expand markers. Uses dual-metric to
          // reduce false positives from legitimate formatting changes.
          const mergedLineCount = mergedCode.split("\n").length
          const charLoss =
            (originalCode.length - mergedCode.length) / originalCode.length
          const lineLoss =
            (originalLineCount - mergedLineCount) / originalLineCount

          if (hasMarkers && charLoss > 0.6 && lineLoss > 0.5) {
            await log(
              "warn",
              `Catastrophic truncation detected for ${target_filepath}: ${Math.round(charLoss * 100)}% char loss, ${Math.round(lineLoss * 100)}% line loss`
            )
            return `Morph API produced a potentially destructive merge for ${target_filepath}.

Original: ${originalLineCount} lines (${originalCode.length} chars)
Merged:   ${mergedLineCount} lines (${mergedCode.length} chars)
Loss:     ${Math.round(charLoss * 100)}% characters, ${Math.round(lineLoss * 100)}% lines

Because markers were provided, this large shrink is likely unintended.
No file changes were written.

Options:
1. Retry with more precise anchors in code_edit
2. Use the native 'edit' tool for exact string replacement
3. Break the change into smaller edits`
          }

          // Write the merged result
          try {
            await Bun.write(filepath, mergedCode)
          } catch (err) {
            const error = err as Error
            return `Error writing file ${target_filepath}: ${error.message}`
          }

          // Generate unified diff
          const diff = generateUnifiedDiff(
            target_filepath,
            originalCode,
            mergedCode
          )

          // Calculate change stats
          const { added, removed } = countChanges(diff)
          const originalLines = originalCode.split("\n").length
          const mergedLines = mergedCode.split("\n").length

          return `Applied edit to ${target_filepath}

+${added} -${removed} lines | ${originalLines} -> ${mergedLines} total | ${apiDuration}ms

\`\`\`diff
${diff.slice(0, 3000)}${diff.length > 3000 ? "\n... (truncated)" : ""}
\`\`\``
        },
      }),
    },

    /**
     * Customize tool output display in TUI
     */
    "tool.execute.after": async (input, output) => {
      if (input.tool === "morph_edit") {
        // Parse output to build a branded title
        const fileMatch = output.output.match(/Applied edit to (.+?)\n/)
        const statsMatch = output.output.match(/\+(\d+) -(\d+) lines/)
        const timingMatch = output.output.match(/\| (\d+)ms/)
        const createdMatch = output.output.match(/Created new file: (.+?)\n/)
        const linesMatch = output.output.match(/Lines: (\d+)/)
        const errorMatch = output.output.match(/^Error:/)
        const blockedMatch = output.output.match(/not available in (.+?) mode/)
        const apiFailMatch = output.output.match(/^Morph API failed:/)

        if (createdMatch) {
          // New file created
          const lines = linesMatch?.[1] || "?"
          output.title = `Morph: ${createdMatch[1]} (new, ${lines} lines)`
        } else if (fileMatch && statsMatch) {
          // Successful edit
          const timing = timingMatch ? ` (${timingMatch[1]}ms)` : ""
          output.title = `Morph: ${fileMatch[1]} +${statsMatch[1]}/-${statsMatch[2]}${timing}`
        } else if (blockedMatch) {
          // Blocked by readonly agent
          output.title = `Morph: blocked (${blockedMatch[1]} mode)`
        } else if (apiFailMatch) {
          // API failure
          output.title = `Morph: API failed`
        } else if (errorMatch) {
          // Other error
          output.title = `Morph: failed`
        }

        // Add structured metadata for potential future TUI enhancements
        output.metadata = {
          ...output.metadata,
          provider: "morph",
          version: PLUGIN_VERSION,
          model: MORPH_MODEL,
        }
      }
    },
  }
}

// Default export for OpenCode plugin loader
export default MorphFastApply
