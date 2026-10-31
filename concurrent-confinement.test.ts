/**
 * Deterministic concurrent-change fixtures for morph_edit root confinement.
 *
 * Each schedule inserts a filesystem mutation at a named seam between the
 * path check and the file I/O, the way another process could. Tests marked
 * EXPOSURE assert the current unsafe outcome so the reproduction stays
 * observable; a confinement repair must invert each of them into a safety
 * regression (refusal, no outside read, no outside write).
 *
 * Every tree lives under one mkdtemp base. rmSync removes symlinks without
 * following them.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  closeSync,
  constants as fsc,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupMorphEditV2 } from "./impl.js";
import { type MorphEditResult } from "./src/execute.js";
import { resolveTargetPath } from "./src/path-confinement.js";

const ORIGINAL = "export const value = 1;\n";
const MERGED = "export const value = 2;\n";
const SENTINEL = "synthetic outside sentinel\n";
const CREATED = "export const created = true;\n";

let base: string;
let root: string;
let outside: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "morph-concurrent-"));
  root = join(base, "allowed");
  outside = join(base, "outside");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(outside, "src"), { recursive: true });
  writeFileSync(join(root, "src", "file.ts"), ORIGINAL);
  writeFileSync(join(outside, "src", "file.ts"), SENTINEL);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const read = (p: string) => readFileSync(p, "utf8");

interface Seams {
  /** After the real resolver returns, before the first read. */
  afterResolve?: () => void;
  /** After the read, before the write, on a missing target (no API call). */
  afterRead?: () => void;
  /** During the API wait, after the read of an existing target. */
  duringApi?: () => void;
}

async function morph(seams: Seams = {}) {
  const tools: Array<{
    execute: (
      raw: unknown,
      context: unknown,
    ) => Promise<{ output: MorphEditResult }>;
  }> = [];
  const apiInputs: string[] = [];
  await setupMorphEditV2(
    {
      tool: {
        transform: async (cb: (editor: unknown) => void) => {
          cb({ add: (tool: (typeof tools)[number]) => tools.push(tool) });
        },
        hook: async () => {},
      },
      session: { get: async () => ({ location: { directory: root } }) },
    } as unknown as Parameters<typeof setupMorphEditV2>[0],
    {
      runtimeOverrides: {
        log: async () => {},
        now: () => 0,
        constants: {
          MORPH_API_KEY: "fixture-key",
          ALLOW_READONLY_AGENTS: false,
          READONLY_AGENTS: ["plan", "explore"],
          EXISTING_CODE_MARKER: "// ... existing code ...",
          PLUGIN_VERSION: "test",
          MORPH_MODEL: "test",
        },
        resolveTargetPath: (target, allowed, options) => {
          const result = resolveTargetPath(target, allowed, options);
          seams.afterResolve?.();
          return result;
        },
        callMorphApply: async (originalCode) => {
          apiInputs.push(originalCode);
          seams.duringApi?.();
          return { success: true, content: MERGED };
        },
        // Same operations as the adapter's readFile, plus the seam.
        ...(seams.afterRead
          ? {
              readFile: async (filepath: string) => {
                const file = Bun.file(filepath);
                const exists = await file.exists();
                const result = {
                  exists,
                  text: exists ? await file.text() : "",
                };
                seams.afterRead?.();
                return result;
              },
            }
          : {}),
      },
    },
  );
  const edit = async (target_filepath: string, code_edit = MERGED) =>
    (
      await tools[0].execute(
        { target_filepath, instructions: "fixture", code_edit },
        { sessionID: "fixture", agent: "build" },
      )
    ).output;
  return { edit, apiInputs };
}

/** Park the original entry and put a symlink to `target` at its pathname. */
function swapForSymlink(pathname: string, target: string) {
  renameSync(pathname, `${pathname}.parked`);
  symlinkSync(target, pathname);
}

describe("controls: unchanged trees and static symlinks", () => {
  test("existing file edit stays inside", async () => {
    const { edit } = await morph();
    expect((await edit("src/file.ts")).status).toBe("success");
    expect(read(join(root, "src", "file.ts"))).toBe(MERGED);
    expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
  });

  test("new nested file creates its parents inside", async () => {
    const { edit } = await morph();
    expect((await edit("new/deep/file.ts", CREATED)).status).toBe("success");
    expect(read(join(root, "new", "deep", "file.ts"))).toBe(CREATED);
  });

  test("static outside leaf symlink is refused before any read", async () => {
    symlinkSync(join(outside, "src", "file.ts"), join(root, "src", "link.ts"));
    const { edit, apiInputs } = await morph();
    expect((await edit("src/link.ts")).code).toBe("path_refused");
    expect(apiInputs).toEqual([]);
    expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
  });

  test("static dangling outside symlink is refused", async () => {
    symlinkSync(join(outside, "absent.ts"), join(root, "src", "dangling.ts"));
    const { edit } = await morph();
    expect((await edit("src/dangling.ts", CREATED)).code).toBe("path_refused");
    expect(existsSync(join(outside, "absent.ts"))).toBe(false);
  });
});

describe("EXPOSURE: existing file, mutation during the API wait", () => {
  test("leaf replaced by outside symlink: outside file overwritten", async () => {
    const leaf = join(root, "src", "file.ts");
    const { edit } = await morph({
      duringApi: () => swapForSymlink(leaf, join(outside, "src", "file.ts")),
    });
    expect((await edit("src/file.ts")).status).toBe("success");
    expect(read(join(outside, "src", "file.ts"))).toBe(MERGED);
    expect(read(`${leaf}.parked`)).toBe(ORIGINAL);
  });

  test("parent directory replaced by outside symlink: outside file overwritten", async () => {
    const parent = join(root, "src");
    const { edit } = await morph({
      duringApi: () => swapForSymlink(parent, join(outside, "src")),
    });
    expect((await edit("src/file.ts")).status).toBe("success");
    expect(read(join(outside, "src", "file.ts"))).toBe(MERGED);
    expect(read(join(`${parent}.parked`, "file.ts"))).toBe(ORIGINAL);
  });

  test("allowed root pathname replaced by outside symlink: outside file overwritten", async () => {
    const { edit } = await morph({
      duringApi: () => swapForSymlink(root, outside),
    });
    expect((await edit("src/file.ts")).status).toBe("success");
    expect(read(join(outside, "src", "file.ts"))).toBe(MERGED);
    expect(read(join(`${root}.parked`, "src", "file.ts"))).toBe(ORIGINAL);
  });
});

describe("EXPOSURE: existing file, mutation before the read", () => {
  test("parent swapped after resolution: outside contents reach the API and are overwritten", async () => {
    const parent = join(root, "src");
    const { edit, apiInputs } = await morph({
      afterResolve: () => swapForSymlink(parent, join(outside, "src")),
    });
    expect((await edit("src/file.ts")).status).toBe("success");
    expect(apiInputs).toEqual([SENTINEL]);
    expect(read(join(outside, "src", "file.ts"))).toBe(MERGED);
  });
});

describe("EXPOSURE: new file, mutation after the missing-file read", () => {
  test("leaf symlink to an existing outside file: outside file overwritten", async () => {
    const { edit, apiInputs } = await morph({
      afterRead: () =>
        symlinkSync(
          join(outside, "src", "file.ts"),
          join(root, "src", "new.ts"),
        ),
    });
    expect((await edit("src/new.ts", CREATED)).status).toBe("success");
    expect(apiInputs).toEqual([]);
    expect(read(join(outside, "src", "file.ts"))).toBe(CREATED);
  });

  test("dangling leaf symlink: outside file created", async () => {
    const { edit } = await morph({
      afterRead: () =>
        symlinkSync(join(outside, "absent.ts"), join(root, "src", "new.ts")),
    });
    expect((await edit("src/new.ts", CREATED)).status).toBe("success");
    expect(read(join(outside, "absent.ts"))).toBe(CREATED);
  });

  test("existing parent replaced: new parents created outside", async () => {
    const parent = join(root, "src");
    const { edit } = await morph({
      afterRead: () => swapForSymlink(parent, join(outside, "src")),
    });
    expect((await edit("src/new/deep/file.ts", CREATED)).status).toBe(
      "success",
    );
    expect(read(join(outside, "src", "new", "deep", "file.ts"))).toBe(CREATED);
    expect(existsSync(join(`${parent}.parked`, "new"))).toBe(false);
  });

  test("symlink inserted at a previously missing parent: new parents created outside", async () => {
    mkdirSync(join(outside, "gen"));
    const { edit } = await morph({
      afterRead: () => symlinkSync(join(outside, "gen"), join(root, "gen")),
    });
    expect((await edit("gen/new/deep/file.ts", CREATED)).status).toBe(
      "success",
    );
    expect(read(join(outside, "gen", "new", "deep", "file.ts"))).toBe(CREATED);
  });
});

describe("filesystem API options available to the adapters", () => {
  const errCode = (fn: () => void) => {
    try {
      fn();
    } catch (err) {
      return (err as NodeJS.ErrnoException).code;
    }
    return "no error";
  };

  test("O_NOFOLLOW refuses an existing-referent leaf symlink", () => {
    const link = join(root, "src", "link.ts");
    symlinkSync(join(outside, "src", "file.ts"), link);
    expect(errCode(() => openSync(link, fsc.O_WRONLY | fsc.O_NOFOLLOW))).toBe(
      "ELOOP",
    );
  });

  test("O_NOFOLLOW|O_CREAT refuses a dangling leaf symlink", () => {
    const link = join(root, "src", "dangling.ts");
    symlinkSync(join(outside, "absent.ts"), link);
    expect(
      errCode(() =>
        openSync(link, fsc.O_WRONLY | fsc.O_CREAT | fsc.O_NOFOLLOW),
      ),
    ).toBe("ELOOP");
    expect(existsSync(join(outside, "absent.ts"))).toBe(false);
  });

  test("O_NOFOLLOW still follows an outside ancestor to an existing file", () => {
    symlinkSync(join(outside, "src"), join(root, "via"));
    const fd = openSync(
      join(root, "via", "file.ts"),
      fsc.O_WRONLY | fsc.O_TRUNC | fsc.O_NOFOLLOW,
    );
    writeSync(fd, MERGED);
    closeSync(fd);
    expect(read(join(outside, "src", "file.ts"))).toBe(MERGED);
  });

  test("O_NOFOLLOW|O_CREAT|O_EXCL still follows an outside ancestor", () => {
    symlinkSync(join(outside, "src"), join(root, "via"));
    const fd = openSync(
      join(root, "via", "new.ts"),
      fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL | fsc.O_NOFOLLOW,
    );
    closeSync(fd);
    expect(existsSync(join(outside, "src", "new.ts"))).toBe(true);
  });

  test("a descriptor acquired before a leaf swap writes the parked original", async () => {
    const leaf = join(root, "src", "file.ts");
    const fd = openSync(leaf, fsc.O_RDWR | fsc.O_NOFOLLOW);
    swapForSymlink(leaf, join(outside, "src", "file.ts"));
    await Bun.write(Bun.file(fd), MERGED);
    closeSync(fd);
    expect(read(`${leaf}.parked`)).toBe(MERGED);
    expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
  });

  test("rename over a leaf symlink replaces the link, not its referent", () => {
    const link = join(root, "src", "link.ts");
    symlinkSync(join(outside, "src", "file.ts"), link);
    writeFileSync(join(root, "src", ".tmp"), MERGED);
    renameSync(join(root, "src", ".tmp"), link);
    expect(lstatSync(link).isSymbolicLink()).toBe(false);
    expect(read(link)).toBe(MERGED);
    expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
  });

  test("rename through an outside ancestor lands outside", () => {
    symlinkSync(join(outside, "src"), join(root, "via"));
    writeFileSync(join(root, ".tmp"), MERGED);
    renameSync(join(root, ".tmp"), join(root, "via", "file.ts"));
    expect(read(join(outside, "src", "file.ts"))).toBe(MERGED);
  });
});
