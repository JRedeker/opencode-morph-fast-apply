import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin, { setupMorphEditV2 } from "./impl.js";
import { parseMorphEditArgs, type MorphEditResult } from "./src/execute.js";
import { openConfinedTarget } from "./src/path-confinement.js";

const args = {
  target_filepath: "file.ts",
  instructions: "create file",
  code_edit: "export const value = 1;\n",
};

async function v2(directory: string) {
  const tools: Array<{
    input: { properties: Record<string, unknown> };
    description: string;
    execute: (
      raw: unknown,
      context: unknown,
    ) => Promise<{ output: MorphEditResult }>;
  }> = [];
  const writes: string[] = [];
  let reads = 0;
  let calls = 0;
  await setupMorphEditV2(
    {
      tool: {
        transform: async (cb: (editor: unknown) => void) => {
          cb({ add: (tool: (typeof tools)[number]) => tools.push(tool) });
        },
        hook: async () => {},
      },
      session: { get: async () => ({ location: { directory } }) },
    } as unknown as Parameters<typeof setupMorphEditV2>[0],
    {
      runtimeOverrides: {
        log: async () => {},
        constants: {
          MORPH_API_KEY: "fixture-key",
          ALLOW_READONLY_AGENTS: false,
          READONLY_AGENTS: ["plan", "explore"],
          EXISTING_CODE_MARKER: "// ... existing code ...",
          PLUGIN_VERSION: "test",
          MORPH_MODEL: "test",
        },
        openTarget: (targetPath, root) => {
          const acquired = openConfinedTarget(targetPath, root);
          if ("error" in acquired) return acquired;
          const target = acquired.target;
          return {
            target: {
              read: async () => {
                reads++;
                return target.read();
              },
              write: async (content) => {
                writes.push(join(root, targetPath));
                await target.write(content);
              },
              close: target.close,
            },
          };
        },
        callMorphApply: async () => {
          calls++;
          return { success: false };
        },
      },
    },
  );
  return {
    tool: tools[0],
    writes,
    reads: () => reads,
    calls: () => calls,
    execute: (raw: unknown) =>
      tools[0].execute(raw, { sessionID: "fixture", agent: "build" }),
  };
}

describe("root-only route", () => {
  test("runtime rejects retired routing arguments instead of silently using the session root", () => {
    for (const extra of [
      { workdir: "/other" },
      { taskId: "task" },
      { workdir: undefined },
    ]) {
      const parsed = parseMorphEditArgs({ ...args, ...extra });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toContain("native 'edit'");
    }
  });

  test("V1 registration exposes only the three editing inputs and names root recovery", async () => {
    const hooks = await plugin.server({
      directory: "/session",
      client: { app: { log: async () => {} } },
    } as unknown as Parameters<typeof plugin.server>[0]);
    const tool = hooks.tool!.morph_edit;
    expect(Object.keys(tool.args).sort()).toEqual(Object.keys(args).sort());
    expect(tool.description).toContain("allowed root");
    expect(tool.description).not.toContain("ADV");
    const result = await tool.execute(
      { ...args, workdir: "/other" } as typeof args,
      {
        agent: "build",
        directory: "/session",
        worktree: "/session",
      } as Parameters<typeof tool.execute>[1],
    );
    expect(result).toMatchObject({ metadata: { code: "invalid_arguments" } });
  });

  test("V2 registration exposes only the three editing inputs", async () => {
    const { tool } = await v2("/session");
    expect(Object.keys(tool.input.properties).sort()).toEqual(
      Object.keys(args).sort(),
    );
    expect(tool.description).toContain("allowed root");
    expect(tool.description).not.toContain("ADV");
  });

  test("V2 refuses relative workdir calls before any file read, write or API call", async () => {
    const root = mkdtempSync(join(tmpdir(), "morph-relative-"));
    try {
      const fixture = await v2(root);
      const result = await fixture.execute({ ...args, workdir: "/other" });
      expect(result.output).toMatchObject({
        status: "error",
        code: "invalid_arguments",
      });
      expect(result.output.text).toContain("native 'edit'");
      expect(fixture.reads()).toBe(0);
      expect(fixture.calls()).toBe(0);
      expect(fixture.writes).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an ad-hoc session root is admitted but a sibling worktree is refused with native recovery", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "morph-root-"));
    try {
      const root = join(tmp, "worktree-adhoc", "repo", "branch");
      mkdirSync(root, { recursive: true });
      const fixture = await v2(root);
      expect((await fixture.execute(args)).output.status).toBe("success");
      expect(fixture.writes).toEqual([join(root, "file.ts")]);
      const sibling = join(tmp, "worktree-adhoc", "repo", "other", "file.ts");
      const refused = await fixture.execute({
        ...args,
        target_filepath: sibling,
      });
      expect(refused.output).toMatchObject({
        status: "refused",
        code: "path_refused",
      });
      expect(refused.output.text).toContain("native 'edit'");
      expect(refused.output.text).toContain(root);
      expect(fixture.writes).toHaveLength(1);
      expect(fixture.reads()).toBe(1);
      expect(fixture.calls()).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("retired non-enumerable capability cannot redirect a relative edit", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "morph-symbol-"));
    try {
      const root = join(tmp, "session");
      const other = join(tmp, "other");
      mkdirSync(root);
      mkdirSync(other);
      const fixture = await v2(root);
      const raw = { ...args };
      Object.defineProperty(
        raw,
        Symbol.for("advance.morph-worktree-capability.v1"),
        { value: { root: other } },
      );
      expect((await fixture.execute(raw)).output.status).toBe("success");
      expect(fixture.writes).toEqual([join(root, "file.ts")]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
