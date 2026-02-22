import { describe, expect, test } from "bun:test"
import { EXISTING_CODE_MARKER, normalizeCodeEditInput } from "./index"

describe("EXISTING_CODE_MARKER", () => {
  test("is the canonical marker string", () => {
    expect(EXISTING_CODE_MARKER).toBe("// ... existing code ...")
  })
})

describe("normalizeCodeEditInput", () => {
  test("returns plain code unchanged", () => {
    const input = `${EXISTING_CODE_MARKER}\nfunction foo() { return 1 }\n${EXISTING_CODE_MARKER}`
    expect(normalizeCodeEditInput(input)).toBe(input)
  })

  test("strips standard markdown fence with language", () => {
    const input = "```typescript\nfunction foo() { return 1 }\n```"
    expect(normalizeCodeEditInput(input)).toBe("function foo() { return 1 }")
  })

  test("strips markdown fence without language", () => {
    const input = "```\nfunction foo() { return 1 }\n```"
    expect(normalizeCodeEditInput(input)).toBe("function foo() { return 1 }")
  })

  test("preserves multi-line content inside fences", () => {
    const inner = `${EXISTING_CODE_MARKER}\nfunction foo() {\n  return 1\n}\n${EXISTING_CODE_MARKER}`
    const input = `\`\`\`typescript\n${inner}\n\`\`\``
    expect(normalizeCodeEditInput(input)).toBe(inner)
  })

  test("does not strip incomplete fences (missing closing)", () => {
    const input = "```typescript\nfunction foo() { return 1 }"
    expect(normalizeCodeEditInput(input)).toBe(input)
  })

  test("does not strip incomplete fences (missing opening)", () => {
    const input = "function foo() { return 1 }\n```"
    expect(normalizeCodeEditInput(input)).toBe(input)
  })

  test("returns short input unchanged (< 3 lines)", () => {
    expect(normalizeCodeEditInput("hello")).toBe("hello")
    expect(normalizeCodeEditInput("line1\nline2")).toBe("line1\nline2")
  })

  test("handles fence with hyphenated language", () => {
    const input = "```c-sharp\nConsole.WriteLine();\n```"
    expect(normalizeCodeEditInput(input)).toBe("Console.WriteLine();")
  })

  test("does not strip fences with text after closing", () => {
    const input = "```typescript\nfoo()\n``` extra text"
    expect(normalizeCodeEditInput(input)).toBe(input)
  })

  test("trims whitespace before checking fences", () => {
    const input = "  \n```typescript\nfunction foo() {}\n```\n  "
    expect(normalizeCodeEditInput(input)).toBe("function foo() {}")
  })
})

describe("marker leakage detection logic", () => {
  // These test the guard logic inline — we can't import it directly since
  // it's embedded in execute(), but we verify the conditions here.

  test("marker leakage: detected when original lacks marker", () => {
    const originalCode = "function foo() { return 1 }"
    const mergedCode = `function foo() { return 1 }\n${EXISTING_CODE_MARKER}\nfunction bar() {}`
    const hasMarkers = true
    const originalHadMarker = originalCode.includes(EXISTING_CODE_MARKER)

    const wouldTrigger =
      hasMarkers && !originalHadMarker && mergedCode.includes(EXISTING_CODE_MARKER)
    expect(wouldTrigger).toBe(true)
  })

  test("marker leakage: skipped when original already contains marker", () => {
    const originalCode = `// Use "${EXISTING_CODE_MARKER}" to represent unchanged code`
    const mergedCode = `// Use "${EXISTING_CODE_MARKER}" to represent unchanged code\n// Added line`
    const hasMarkers = true
    const originalHadMarker = originalCode.includes(EXISTING_CODE_MARKER)

    const wouldTrigger =
      hasMarkers && !originalHadMarker && mergedCode.includes(EXISTING_CODE_MARKER)
    expect(wouldTrigger).toBe(false)
  })

  test("marker leakage: not triggered when no markers in input", () => {
    const originalCode = "function foo() { return 1 }"
    const mergedCode = `function foo() { return 1 }\n${EXISTING_CODE_MARKER}`
    const hasMarkers = false // no markers in code_edit

    const wouldTrigger =
      hasMarkers && mergedCode.includes(EXISTING_CODE_MARKER)
    expect(wouldTrigger).toBe(false)
  })
})

describe("truncation detection logic", () => {
  test("triggers when both char and line loss exceed thresholds", () => {
    const originalCode = "x".repeat(1000) + "\n".repeat(100)
    const mergedCode = "x".repeat(300) + "\n".repeat(40)
    const hasMarkers = true

    const originalLineCount = originalCode.split("\n").length
    const mergedLineCount = mergedCode.split("\n").length
    const charLoss = (originalCode.length - mergedCode.length) / originalCode.length
    const lineLoss = (originalLineCount - mergedLineCount) / originalLineCount

    const wouldTrigger = hasMarkers && charLoss > 0.6 && lineLoss > 0.5
    expect(wouldTrigger).toBe(true)
  })

  test("does not trigger when only char loss exceeds threshold", () => {
    // Lots of char loss but lines stay similar (e.g., whitespace removal)
    const originalCode = "x    ".repeat(200) + "\n".repeat(50)
    const mergedCode = "x".repeat(200) + "\n".repeat(50)
    const hasMarkers = true

    const originalLineCount = originalCode.split("\n").length
    const mergedLineCount = mergedCode.split("\n").length
    const charLoss = (originalCode.length - mergedCode.length) / originalCode.length
    const lineLoss = (originalLineCount - mergedLineCount) / originalLineCount

    const wouldTrigger = hasMarkers && charLoss > 0.6 && lineLoss > 0.5
    expect(wouldTrigger).toBe(false)
  })

  test("does not trigger when only line loss exceeds threshold", () => {
    // Lines shrunk but chars stayed similar (e.g., joined multi-line to single-line)
    const lines = Array.from({ length: 100 }, () => "ab").join("\n")
    const joined = Array.from({ length: 40 }, () => "ab".repeat(3)).join("\n")
    const hasMarkers = true

    const originalLineCount = lines.split("\n").length
    const mergedLineCount = joined.split("\n").length
    const charLoss = (lines.length - joined.length) / lines.length
    const lineLoss = (originalLineCount - mergedLineCount) / originalLineCount

    // charLoss should be low/negative (joined has more chars per line)
    const wouldTrigger = hasMarkers && charLoss > 0.6 && lineLoss > 0.5
    expect(wouldTrigger).toBe(false)
  })

  test("does not trigger when no markers in input", () => {
    const originalCode = "x".repeat(1000) + "\n".repeat(100)
    const mergedCode = "x".repeat(100)
    const hasMarkers = false

    const originalLineCount = originalCode.split("\n").length
    const mergedLineCount = mergedCode.split("\n").length
    const charLoss = (originalCode.length - mergedCode.length) / originalCode.length
    const lineLoss = (originalLineCount - mergedLineCount) / originalLineCount

    const wouldTrigger = hasMarkers && charLoss > 0.6 && lineLoss > 0.5
    expect(wouldTrigger).toBe(false)
  })
})
