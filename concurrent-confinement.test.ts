import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as ffi from "bun:ffi";
import * as fs from "node:fs";
import {
  closeSync,
  chmodSync,
  constants as fsc,
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin, { setupMorphEditV1, setupMorphEditV2 } from "./impl.js";
import {
  type ExecuteMorphEditRuntime,
  type MorphEditResult,
} from "./src/execute.js";
import { openConfinedTarget } from "./src/path-confinement.js";

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

function setAttribute(file: string, name: string, value: Uint8Array) {
  const native = ffi.dlopen("libc.so.6", {
    fsetxattr: { args: ["i32", "ptr", "ptr", "u64", "i32"], returns: "i32" },
  });
  const fd = openSync(file, fsc.O_RDONLY | fsc.O_NOFOLLOW);
  try {
    expect(
      native.symbols.fsetxattr(
        fd,
        Buffer.from(`${name}\0`),
        value,
        value.length,
        0,
      ),
    ).toBe(0);
  } finally {
    closeSync(fd);
    native.close();
  }
}

function attributeNames(file: string) {
  const native = ffi.dlopen("libc.so.6", {
    flistxattr: { args: ["i32", "ptr", "u64"], returns: "i64" },
  });
  const fd = openSync(file, fsc.O_RDONLY | fsc.O_NOFOLLOW);
  try {
    const names = Buffer.alloc(4096);
    const size = Number(native.symbols.flistxattr(fd, names, names.length));
    expect(size).toBeGreaterThanOrEqual(0);
    return names.subarray(0, size).toString().split("\0").filter(Boolean);
  } finally {
    closeSync(fd);
    native.close();
  }
}

function namedUserAcl() {
  // Linux UAPI: little-endian version 2 header, then tag/permissions/id entries.
  const entries = [
    [0x01, 7, 0xffffffff],
    [0x02, 4, 65534],
    [0x04, 0, 0xffffffff],
    [0x10, 4, 0xffffffff],
    [0x20, 0, 0xffffffff],
  ];
  const acl = Buffer.alloc(4 + entries.length * 8);
  acl.writeUInt32LE(2, 0);
  entries.forEach(([tag, permissions, id], index) => {
    acl.writeUInt16LE(tag, 4 + index * 8);
    acl.writeUInt16LE(permissions, 6 + index * 8);
    acl.writeUInt32LE(id, 8 + index * 8);
  });
  return acl;
}

function setDefaultAcl(directory: string) {
  setAttribute(directory, "system.posix_acl_default", namedUserAcl());
}

interface Seams {
  afterResolve?: () => void;
  afterRead?: () => void;
  duringApi?: () => void;
  runtime?: Partial<ExecuteMorphEditRuntime>;
}

async function morph(adapter: "V1" | "V2", seams: Seams = {}) {
  const apiInputs: string[] = [];
  const runtimeOverrides: Partial<ExecuteMorphEditRuntime> = {
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
    openTarget: (target, allowed) => {
      const result = openConfinedTarget(target, allowed);
      seams.afterResolve?.();
      if ("target" in result && seams.afterRead) {
        const read = result.target.read;
        result.target.read = async () => {
          const file = await read();
          seams.afterRead?.();
          return file;
        };
      }
      return result;
    },
    callMorphApply: async (originalCode) => {
      apiInputs.push(originalCode);
      seams.duringApi?.();
      return { success: true, content: MERGED };
    },
    ...seams.runtime,
  };
  let execute: (
    raw: unknown,
  ) => Promise<Pick<MorphEditResult, "status" | "code">>;
  if (adapter === "V1") {
    const hooks = await setupMorphEditV1(
      {
        directory: root,
        client: { app: { log: async () => {} } },
      } as unknown as Parameters<typeof setupMorphEditV1>[0],
      { runtimeOverrides },
    );
    const tool = hooks.tool!.morph_edit;
    execute = async (raw) => {
      const result = await tool.execute(
        raw as Parameters<typeof tool.execute>[0],
        {
          agent: "build",
          worktree: root,
        } as Parameters<typeof tool.execute>[1],
      );
      if (typeof result === "string") throw new Error("Missing V1 metadata");
      return result.metadata as Pick<MorphEditResult, "status" | "code">;
    };
  } else {
    const tools: Array<{
      execute: (
        raw: unknown,
        context: unknown,
      ) => Promise<{ output: MorphEditResult }>;
    }> = [];
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
      { runtimeOverrides },
    );
    execute = async (raw) =>
      (await tools[0].execute(raw, { sessionID: "fixture", agent: "build" }))
        .output;
  }
  return {
    edit: (target_filepath: string, code_edit = MERGED) =>
      execute({ target_filepath, instructions: "fixture", code_edit }),
    apiInputs,
  };
}

function swapForSymlink(pathname: string, target: string) {
  renameSync(pathname, `${pathname}.parked`);
  symlinkSync(target, pathname);
}

for (const adapter of ["V1", "V2"] as const) {
  describe(`${adapter}: replacement access metadata`, () => {
    test.each(["user.morph-test", "system.posix_acl_access"])(
      "source %s is refused before content read or API disclosure",
      async (attribute) => {
        const file = join(root, "src", "file.ts");
        setAttribute(
          file,
          attribute,
          attribute.startsWith("system.")
            ? namedUserAcl()
            : Buffer.from("private"),
        );
        const originalInode = statSync(file).ino;
        const { edit, apiInputs } = await morph(adapter);
        const readFile = fs.readFileSync;
        let contentReads = 0;
        const spy = spyOn(fs, "readFileSync").mockImplementation(((
          target,
          options,
        ) => {
          if (typeof target === "number") contentReads++;
          return readFile(target, options);
        }) as typeof fs.readFileSync);
        try {
          expect((await edit("src/file.ts")).code).toBe("path_refused");
          expect(contentReads).toBe(0);
        } finally {
          spy.mockRestore();
        }
        expect(apiInputs).toEqual([]);
        expect(read(file)).toBe(ORIGINAL);
        expect(statSync(file).ino).toBe(originalInode);
        expect(attributeNames(file)).toContain(attribute);
      },
    );
    test.each(["before-read", "during-api"])(
      "source attributes added %s are refused",
      async (stage) => {
        const file = join(root, "src", "file.ts");
        const originalInode = statSync(file).ino;
        const change = () =>
          setAttribute(file, "user.morph-test", Buffer.from("private"));
        const { edit, apiInputs } = await morph(
          adapter,
          stage === "before-read"
            ? { afterResolve: change }
            : { duringApi: change },
        );
        expect((await edit("src/file.ts")).code).toBe(
          stage === "before-read" ? "read_failed" : "write_failed",
        );
        expect(apiInputs).toEqual(stage === "before-read" ? [] : [ORIGINAL]);
        expect(statSync(file).ino).toBe(originalInode);
        expect(read(file)).toBe(ORIGINAL);
        expect(attributeNames(file)).toContain("user.morph-test");
        expect(readdirSync(join(root, "src"))).toEqual(["file.ts"]);
      },
    );
    test("source permission changes during the API wait are not replaced with stale permissions", async () => {
      const file = join(root, "src", "file.ts");
      chmodSync(file, 0o640);
      const { edit } = await morph(adapter, {
        duringApi: () => chmodSync(file, 0o600),
      });
      expect((await edit("src/file.ts")).code).toBe("write_failed");
      expect(read(file)).toBe(ORIGINAL);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    });
    test.each(["owner", "group"])(
      "a replacement %s mismatch is refused before writing content",
      async (kind) => {
        const stat = fs.fstatSync;
        const write = fs.writeFileSync;
        let contentWrites = 0;
        const statSpy = spyOn(fs, "fstatSync").mockImplementation(((
          fd,
          options,
        ) => {
          const result = stat(fd, options);
          if (fs.readlinkSync(`/proc/self/fd/${fd}`).includes("/.morph-"))
            return {
              ...result,
              [kind === "owner" ? "uid" : "gid"]: 0x7fffffffn,
            };
          return result;
        }) as typeof fs.fstatSync);
        const writeSpy = spyOn(fs, "writeFileSync").mockImplementation(
          (target, content, options) => {
            if (typeof target === "number") contentWrites++;
            return write(target, content, options);
          },
        );
        try {
          const { edit } = await morph(adapter);
          expect((await edit("src/file.ts")).code).toBe("write_failed");
          expect(contentWrites).toBe(0);
          expect(read(join(root, "src", "file.ts"))).toBe(ORIGINAL);
          expect(readdirSync(join(root, "src"))).toEqual(["file.ts"]);
        } finally {
          statSpy.mockRestore();
          writeSpy.mockRestore();
        }
      },
    );
    test("unavailable native inspection refuses existing edits but not new files", async () => {
      const before = readdirSync("/proc/self/fd").sort();
      const spy = spyOn(ffi, "dlopen").mockImplementation(() => {
        throw new Error("synthetic unavailable libc");
      });
      try {
        const { edit, apiInputs } = await morph(adapter);
        expect((await edit("src/file.ts")).code).toBe("path_refused");
        expect(apiInputs).toEqual([]);
        expect((await edit("src/new.ts", CREATED)).status).toBe("success");
        expect(read(join(root, "src", "file.ts"))).toBe(ORIGINAL);
        expect(readdirSync("/proc/self/fd").sort()).toEqual(before);
      } finally {
        spy.mockRestore();
      }
    });
    test("native inspection errors fail closed", async () => {
      const before = readdirSync("/proc/self/fd").sort();
      let closed = false;
      const spy = spyOn(ffi, "dlopen").mockImplementation((() => ({
        symbols: { flistxattr: () => -1n },
        close: () => {
          closed = true;
        },
      })) as unknown as typeof ffi.dlopen);
      try {
        const { edit, apiInputs } = await morph(adapter);
        expect((await edit("src/file.ts")).code).toBe("path_refused");
        expect(apiInputs).toEqual([]);
        expect(closed).toBe(true);
        expect(readdirSync("/proc/self/fd").sort()).toEqual(before);
      } finally {
        spy.mockRestore();
      }
    });
    test.each(["source", "replacement"])(
      "%s attributes added during the content write prevent publication",
      async (kind) => {
        const file = join(root, "src", "file.ts");
        const originalInode = statSync(file).ino;
        const write = fs.writeFileSync;
        let changed = false;
        const spy = spyOn(fs, "writeFileSync").mockImplementation(
          (target, content, options) => {
            const result = write(target, content, options);
            if (typeof target === "number") {
              changed = true;
              expect(statSync(`/proc/self/fd/${target}`).mode & 0o777).toBe(
                0o600,
              );
              setAttribute(
                kind === "source"
                  ? file
                  : fs.readlinkSync(`/proc/self/fd/${target}`),
                "user.morph-test",
                Buffer.from("private"),
              );
            }
            return result;
          },
        );
        try {
          const { edit } = await morph(adapter);
          expect((await edit("src/file.ts")).code).toBe("write_failed");
          expect(changed).toBe(true);
          expect(read(file)).toBe(ORIGINAL);
          expect(statSync(file).ino).toBe(originalInode);
          expect(readdirSync(join(root, "src"))).toEqual(["file.ts"]);
        } finally {
          spy.mockRestore();
        }
      },
    );
    test("new files keep kernel default ACLs", async () => {
      setDefaultAcl(join(root, "src"));
      const { edit } = await morph(adapter);
      expect((await edit("src/new.ts", CREATED)).status).toBe("success");
      expect(read(join(root, "src", "new.ts"))).toBe(CREATED);
      expect(attributeNames(join(root, "src", "new.ts"))).toContain(
        "system.posix_acl_access",
      );
    });
    test("inherited named-user ACLs never reach replacement content or publication", async () => {
      const file = join(root, "src", "file.ts");
      chmodSync(file, 0o640);
      const originalInode = statSync(file).ino;
      setDefaultAcl(join(root, "src"));
      expect(attributeNames(file)).toEqual([]);
      const before = readdirSync("/proc/self/fd").sort();
      const write = fs.writeFileSync;
      let contentWrites = 0;
      const spy = spyOn(fs, "writeFileSync").mockImplementation(
        (target, data, options) => {
          if (typeof target === "number") contentWrites++;
          return write(target, data, options);
        },
      );
      try {
        const { edit, apiInputs } = await morph(adapter);
        expect((await edit("src/file.ts")).code).toBe("write_failed");
        expect(apiInputs).toEqual([ORIGINAL]);
        expect(contentWrites).toBe(0);
      } finally {
        spy.mockRestore();
      }
      expect(statSync(file).ino).toBe(originalInode);
      expect(read(file)).toBe(ORIGINAL);
      expect(attributeNames(file)).toEqual([]);
      expect(readdirSync(join(root, "src"))).toEqual(["file.ts"]);
      expect(readdirSync("/proc/self/fd").sort()).toEqual(before);
    });
  });
  describe(`${adapter}: unchanged trees and static symlinks`, () => {
    test("existing file edit stays inside", async () => {
      const { edit } = await morph(adapter);
      expect((await edit("src/file.ts")).status).toBe("success");
      expect(read(join(root, "src", "file.ts"))).toBe(MERGED);
      expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
    });
    test("new nested file creates its parents inside", async () => {
      const { edit } = await morph(adapter);
      expect((await edit("new/deep/file.ts", CREATED)).status).toBe("success");
      expect(read(join(root, "new", "deep", "file.ts"))).toBe(CREATED);
    });
    test("static outside leaf symlink is refused before any read", async () => {
      symlinkSync(
        join(outside, "src", "file.ts"),
        join(root, "src", "link.ts"),
      );
      const { edit, apiInputs } = await morph(adapter);
      expect((await edit("src/link.ts")).code).toBe("path_refused");
      expect(apiInputs).toEqual([]);
      expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
    });
    test("static dangling outside symlink is refused", async () => {
      symlinkSync(join(outside, "absent.ts"), join(root, "src", "dangling.ts"));
      const { edit } = await morph(adapter);
      expect((await edit("src/dangling.ts", CREATED)).code).toBe(
        "path_refused",
      );
      expect(existsSync(join(outside, "absent.ts"))).toBe(false);
    });
  });

  describe(`${adapter}: existing file, mutation during the API wait`, () => {
    test("leaf replaced by outside symlink never changes the referent", async () => {
      const leaf = join(root, "src", "file.ts");
      const { edit } = await morph(adapter, {
        duringApi: () => swapForSymlink(leaf, join(outside, "src", "file.ts")),
      });
      expect((await edit("src/file.ts")).status).not.toBe("success");
      expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
      expect(read(`${leaf}.parked`)).toBe(ORIGINAL);
    });
    test("parent directory replacement edits the acquired parked directory", async () => {
      const parent = join(root, "src");
      const { edit } = await morph(adapter, {
        duringApi: () => swapForSymlink(parent, join(outside, "src")),
      });
      expect((await edit("src/file.ts")).status).toBe("success");
      expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
      expect(read(join(`${parent}.parked`, "file.ts"))).toBe(MERGED);
    });
    test("root pathname replacement edits the acquired parked directory", async () => {
      const { edit } = await morph(adapter, {
        duringApi: () => swapForSymlink(root, outside),
      });
      expect((await edit("src/file.ts")).status).toBe("success");
      expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
      expect(read(join(`${root}.parked`, "src", "file.ts"))).toBe(MERGED);
    });
  });

  describe(`${adapter}: existing file, mutation before the read`, () => {
    test("parent swapped after acquisition never sends outside contents to the API", async () => {
      const parent = join(root, "src");
      const { edit, apiInputs } = await morph(adapter, {
        afterResolve: () => swapForSymlink(parent, join(outside, "src")),
      });
      expect((await edit("src/file.ts")).status).toBe("success");
      expect(apiInputs).toEqual([ORIGINAL]);
      expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
      expect(read(join(`${parent}.parked`, "file.ts"))).toBe(MERGED);
    });
  });

  describe(`${adapter}: new file, mutation after the missing-file read`, () => {
    test("leaf symlink to an existing outside file never changes the referent", async () => {
      const { edit, apiInputs } = await morph(adapter, {
        afterRead: () =>
          symlinkSync(
            join(outside, "src", "file.ts"),
            join(root, "src", "new.ts"),
          ),
      });
      expect((await edit("src/new.ts", CREATED)).status).not.toBe("success");
      expect(apiInputs).toEqual([]);
      expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
    });
    test("dangling leaf symlink never creates the outside referent", async () => {
      const { edit } = await morph(adapter, {
        afterRead: () =>
          symlinkSync(join(outside, "absent.ts"), join(root, "src", "new.ts")),
      });
      expect((await edit("src/new.ts", CREATED)).status).not.toBe("success");
      expect(existsSync(join(outside, "absent.ts"))).toBe(false);
    });
    test("existing parent replacement creates parents in the acquired parked directory", async () => {
      const parent = join(root, "src");
      const { edit } = await morph(adapter, {
        afterRead: () => swapForSymlink(parent, join(outside, "src")),
      });
      expect((await edit("src/new/deep/file.ts", CREATED)).status).toBe(
        "success",
      );
      expect(existsSync(join(outside, "src", "new"))).toBe(false);
      expect(read(join(`${parent}.parked`, "new", "deep", "file.ts"))).toBe(
        CREATED,
      );
    });
    test("symlink inserted at a missing parent never creates outside parents", async () => {
      mkdirSync(join(outside, "gen"));
      const { edit } = await morph(adapter, {
        afterRead: () => symlinkSync(join(outside, "gen"), join(root, "gen")),
      });
      expect((await edit("gen/new/deep/file.ts", CREATED)).status).not.toBe(
        "success",
      );
      expect(existsSync(join(outside, "gen", "new"))).toBe(false);
    });
  });

  describe(`${adapter}: acquired objects and aliases`, () => {
    test("a parent moved outside still receives edits, not an unrelated outside file", async () => {
      const moved = join(outside, "moved");
      const { edit } = await morph(adapter, {
        duringApi: () => renameSync(join(root, "src"), moved),
      });
      expect((await edit("src/file.ts")).status).toBe("success");
      expect(read(join(moved, "file.ts"))).toBe(MERGED);
      expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
      expect(existsSync(join(root, "src"))).toBe(false);
    });
    test("a moved acquired directory may receive new nested files", async () => {
      const moved = join(outside, "moved");
      const { edit } = await morph(adapter, {
        afterRead: () => renameSync(join(root, "src"), moved),
      });
      expect((await edit("src/new/deep/file.ts", CREATED)).status).toBe(
        "success",
      );
      expect(read(join(moved, "new", "deep", "file.ts"))).toBe(CREATED);
      expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
      expect(existsSync(join(outside, "src", "new"))).toBe(false);
    });
    test("an outside hard link is refused before API disclosure", async () => {
      linkSync(join(outside, "src", "file.ts"), join(root, "src", "alias.ts"));
      const { edit, apiInputs } = await morph(adapter);
      expect((await edit("src/alias.ts")).code).toBe("path_refused");
      expect(apiInputs).toEqual([]);
      expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
    });
    test("an alias added after acquisition but before read is refused before API disclosure", async () => {
      const { edit, apiInputs } = await morph(adapter, {
        afterResolve: () =>
          linkSync(
            join(root, "src", "file.ts"),
            join(outside, "late-alias.ts"),
          ),
      });
      expect((await edit("src/file.ts")).code).toBe("read_failed");
      expect(apiInputs).toEqual([]);
      expect(read(join(outside, "late-alias.ts"))).toBe(ORIGINAL);
      expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
    });
    test("a hard link added during the API wait retains the original inode and mode", async () => {
      const file = join(root, "src", "file.ts");
      const alias = join(outside, "alias.ts");
      chmodSync(file, 0o751);
      const originalInode = statSync(file).ino;
      const { edit } = await morph(adapter, {
        duringApi: () => linkSync(file, alias),
      });
      expect((await edit("src/file.ts")).status).toBe("success");
      expect(read(alias)).toBe(ORIGINAL);
      expect(read(file)).toBe(MERGED);
      expect(statSync(alias).ino).toBe(originalInode);
      expect(statSync(file).ino).not.toBe(originalInode);
      expect(statSync(file).mode & 0o777).toBe(0o751);
      expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
    });
    test("a leaf replaced with an outside hard link is never truncated", async () => {
      const leaf = join(root, "src", "file.ts");
      const { edit, apiInputs } = await morph(adapter, {
        duringApi: () => {
          renameSync(leaf, `${leaf}.parked`);
          linkSync(join(outside, "src", "file.ts"), leaf);
        },
      });
      expect((await edit("src/file.ts")).status).not.toBe("success");
      expect(apiInputs).toEqual([ORIGINAL]);
      expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
      expect(read(`${leaf}.parked`)).toBe(ORIGINAL);
    });
    test.skipIf(process.getuid?.() === 0)(
      "a target without write permission is not replaced",
      async () => {
        const file = join(root, "src", "file.ts");
        chmodSync(file, 0o444);
        const originalInode = statSync(file).ino;
        const { edit, apiInputs } = await morph(adapter);
        expect((await edit("src/file.ts")).code).toBe("write_failed");
        expect(apiInputs).toEqual([ORIGINAL]);
        expect(read(file)).toBe(ORIGINAL);
        expect(statSync(file).ino).toBe(originalInode);
        expect(statSync(file).mode & 0o777).toBe(0o444);
        expect(readdirSync(join(root, "src"))).toEqual(["file.ts"]);
      },
    );
    test("a new file takes its mode from the kernel umask without reading it", async () => {
      const previous = process.umask(0o027);
      const umask = spyOn(process, "umask");
      try {
        const { edit } = await morph(adapter);
        expect((await edit("src/new.ts", CREATED)).status).toBe("success");
        expect(umask).not.toHaveBeenCalled();
        expect(statSync(join(root, "src", "new.ts")).mode & 0o777).toBe(0o640);
      } finally {
        umask.mockRestore();
        process.umask(previous);
      }
    });
    test.each([
      "relative-leaf",
      "absolute-leaf",
      "relative-parent",
      "absolute-parent",
    ])("in-root %s symlinks are refused", async (kind) => {
      const isParent = kind.endsWith("parent");
      symlinkSync(
        kind.startsWith("relative")
          ? isParent
            ? "src"
            : "src/file.ts"
          : join(root, "src", ...(isParent ? [] : ["file.ts"])),
        join(root, "alias"),
      );
      const { edit, apiInputs } = await morph(adapter);
      expect((await edit(isParent ? "alias/file.ts" : "alias")).code).toBe(
        "path_refused",
      );
      expect(apiInputs).toEqual([]);
      expect(read(join(root, "src", "file.ts"))).toBe(ORIGINAL);
    });
    test("root and ancestor symlink aliases are refused", async () => {
      const originalRoot = root;
      symlinkSync(originalRoot, join(base, "root-alias"));
      root = join(base, "root-alias");
      const fixture = await morph(adapter);
      expect((await fixture.edit("src/file.ts")).code).toBe("path_refused");
      symlinkSync(base, join(base, "ancestor-alias"));
      root = join(base, "ancestor-alias", "allowed");
      const other = await morph(adapter);
      expect((await other.edit("src/file.ts")).code).toBe("path_refused");
      expect(fixture.apiInputs).toEqual([]);
      expect(other.apiInputs).toEqual([]);
      expect(read(join(originalRoot, "src", "file.ts"))).toBe(ORIGINAL);
    });
    test("directories are refused without API input", async () => {
      const { edit, apiInputs } = await morph(adapter);
      expect((await edit("src")).code).toBe("path_refused");
      expect(apiInputs).toEqual([]);
    });
    test("a FIFO is refused without blocking or API input", async () => {
      const fifo = join(root, "src", "fifo");
      expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0);
      const { edit, apiInputs } = await morph(adapter);
      expect((await edit("src/fifo")).code).toBe("path_refused");
      expect(apiInputs).toEqual([]);
    });
    test("an unlinked acquired parent fails rather than reporting a lost creation", async () => {
      mkdirSync(join(root, "empty"));
      const { edit } = await morph(adapter, {
        afterRead: () => rmdirSync(join(root, "empty")),
      });
      expect((await edit("empty/new.ts", CREATED)).code).toBe("write_failed");
      expect(existsSync(join(root, "empty"))).toBe(false);
    });
    test("a just-created parent replaced by a symlink cannot redirect the next mkdir", async () => {
      const mkdir = fs.mkdirSync;
      const spy = spyOn(fs, "mkdirSync").mockImplementation(((
        pathname,
        options,
      ) => {
        const result = mkdir(pathname, options);
        if (String(pathname).endsWith("/gen"))
          swapForSymlink(join(root, "gen"), outside);
        return result;
      }) as typeof mkdirSync);
      try {
        const { edit } = await morph(adapter);
        expect((await edit("gen/new/deep/file.ts", CREATED)).code).toBe(
          "write_failed",
        );
        expect(existsSync(join(outside, "new"))).toBe(false);
        expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
      } finally {
        spy.mockRestore();
      }
    });
    test("parent substitution during secure acquisition is refused before API input", async () => {
      const open = fs.openSync;
      let changed = false;
      const spy = spyOn(fs, "openSync").mockImplementation(
        (pathname, flags, mode) => {
          if (
            !changed &&
            String(pathname).startsWith("/proc/") &&
            String(pathname).endsWith("/src")
          ) {
            changed = true;
            swapForSymlink(join(root, "src"), join(outside, "src"));
          }
          return open(pathname, flags, mode);
        },
      );
      try {
        const { edit, apiInputs } = await morph(adapter);
        expect((await edit("src/file.ts")).code).toBe("path_refused");
        expect(changed).toBe(true);
        expect(apiInputs).toEqual([]);
        expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
      } finally {
        spy.mockRestore();
      }
    });
    test.each(["root", "ancestor"])(
      "%s substitution during acquisition cannot redirect the root",
      async (kind) => {
        const nested = join(base, "nested");
        mkdirSync(nested);
        renameSync(root, join(nested, "allowed"));
        root = join(nested, "allowed");
        const victim = kind === "root" ? root : nested;
        const open = fs.openSync;
        let changed = false;
        const spy = spyOn(fs, "openSync").mockImplementation(
          (pathname, flags, mode) => {
            if (
              !changed &&
              String(pathname).startsWith("/proc/") &&
              String(pathname).endsWith(
                kind === "root" ? "/allowed" : "/nested",
              )
            ) {
              changed = true;
              swapForSymlink(victim, outside);
            }
            return open(pathname, flags, mode);
          },
        );
        try {
          const { edit, apiInputs } = await morph(adapter);
          expect((await edit("src/file.ts")).code).toBe("path_refused");
          expect(changed).toBe(true);
          expect(apiInputs).toEqual([]);
          expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
        } finally {
          spy.mockRestore();
        }
      },
    );
    test("unsupported hosts fail closed without API input or creation", async () => {
      const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
      Object.defineProperty(process, "platform", {
        value: "darwin",
        configurable: true,
      });
      try {
        const { edit, apiInputs } = await morph(adapter);
        expect((await edit("src/new.ts", CREATED)).code).toBe("path_refused");
        expect(apiInputs).toEqual([]);
        expect(existsSync(join(root, "src", "new.ts"))).toBe(false);
      } finally {
        Object.defineProperty(process, "platform", platform);
      }
    });
    test.each(["wrong-filesystem", "unavailable"])(
      "procfs %s fails closed",
      async (kind) => {
        const statfs = fs.statfsSync;
        const spy = spyOn(fs, "statfsSync").mockImplementation(((
          pathname,
          options,
        ) => {
          if (kind === "unavailable") throw new Error("procfs unavailable");
          return { ...statfs(pathname, options), type: 0 };
        }) as typeof fs.statfsSync);
        try {
          const { edit, apiInputs } = await morph(adapter);
          expect((await edit("src/new.ts", CREATED)).code).toBe("path_refused");
          expect(apiInputs).toEqual([]);
          expect(existsSync(join(root, "src", "new.ts"))).toBe(false);
        } finally {
          spy.mockRestore();
        }
      },
    );
    test("a procfs descriptor identity mismatch fails closed", async () => {
      const stat = fs.statSync;
      const spy = spyOn(fs, "statSync").mockImplementation(((
        pathname,
        options,
      ) => {
        const result = stat(pathname, options);
        if (String(pathname).startsWith("/proc/self/fd/"))
          return { ...result, ino: 0n };
        return result;
      }) as typeof fs.statSync);
      try {
        const { edit, apiInputs } = await morph(adapter);
        expect((await edit("src/new.ts", CREATED)).code).toBe("path_refused");
        expect(apiInputs).toEqual([]);
        expect(existsSync(join(root, "src", "new.ts"))).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });
    test.each(["read", "write", "rename"])(
      "%s syscall failure closes all descriptors and removes staging files",
      async (stage) => {
        const before = readdirSync(`/proc/${process.pid}/fd`).sort();
        const readFile = fs.readFileSync;
        const writeFile = fs.writeFileSync;
        const rename = fs.renameSync;
        const readSpy = spyOn(fs, "readFileSync").mockImplementation(((
          pathname,
          options,
        ) => {
          if (stage === "read" && typeof pathname === "number")
            throw new Error("synthetic read failure");
          return readFile(pathname, options);
        }) as typeof fs.readFileSync);
        const writeSpy = spyOn(fs, "writeFileSync").mockImplementation(
          (pathname, data, options) => {
            if (stage === "write" && typeof pathname === "number")
              throw new Error("synthetic write failure");
            return writeFile(pathname, data, options);
          },
        );
        const renameSpy = spyOn(fs, "renameSync").mockImplementation(
          (oldPath, newPath) => {
            if (stage === "rename" && String(oldPath).startsWith("/proc/"))
              throw new Error("synthetic rename failure");
            return rename(oldPath, newPath);
          },
        );
        try {
          const { edit } = await morph(adapter);
          expect((await edit("src/file.ts")).code).toBe(
            stage === "read" ? "read_failed" : "write_failed",
          );
        } finally {
          readSpy.mockRestore();
          writeSpy.mockRestore();
          renameSpy.mockRestore();
        }
        expect(readdirSync(`/proc/${process.pid}/fd`).sort()).toEqual(before);
        expect(readdirSync(join(root, "src"))).toEqual(["file.ts"]);
        expect(read(join(root, "src", "file.ts"))).toBe(ORIGINAL);
        expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
      },
    );
    test("an acquisition cleanup failure remains a refusal and closes remaining descriptors", async () => {
      const before = readdirSync(`/proc/${process.pid}/fd`).sort();
      const close = fs.closeSync;
      let injected = false;
      const spy = spyOn(fs, "closeSync").mockImplementation((fd) => {
        close(fd);
        if (!injected) {
          injected = true;
          throw new Error("synthetic close failure");
        }
      });
      try {
        const { edit, apiInputs } = await morph(adapter);
        expect((await edit("src/file.ts")).code).toBe("path_refused");
        expect(apiInputs).toEqual([]);
      } finally {
        spy.mockRestore();
      }
      expect(readdirSync(`/proc/${process.pid}/fd`).sort()).toEqual(before);
    });
    test("a final close failure returns an I/O error rather than escaping the adapter", async () => {
      const before = readdirSync(`/proc/${process.pid}/fd`).sort();
      const close = fs.closeSync;
      const spy = spyOn(fs, "closeSync").mockImplementation((fd) => {
        const file = fs.readlinkSync(`/proc/${process.pid}/fd/${fd}`);
        close(fd);
        if (file.includes("/src/file.ts"))
          throw new Error("synthetic final close failure");
      });
      try {
        const { edit } = await morph(adapter);
        expect((await edit("src/file.ts")).code).toBe("write_failed");
      } finally {
        spy.mockRestore();
      }
      expect(readdirSync(`/proc/${process.pid}/fd`).sort()).toEqual(before);
      expect(read(join(root, "src", "file.ts"))).toBe(MERGED);
      expect(read(join(outside, "src", "file.ts"))).toBe(SENTINEL);
    });
    test("descriptors close after successful, refused, API-error and write-error outcomes", async () => {
      const descriptors = () => readdirSync(`/proc/${process.pid}/fd`).sort();
      const before = descriptors();
      const successful = await morph(adapter);
      expect((await successful.edit("src/new.ts", CREATED)).status).toBe(
        "success",
      );
      expect(descriptors()).toEqual(before);
      expect(
        (await successful.edit("src/missing.ts", "// ... existing code ..."))
          .code,
      ).toBe("file_not_found");
      expect(descriptors()).toEqual(before);
      const markerLeak = await morph(adapter, {
        runtime: {
          callMorphApply: async () => ({
            success: true,
            content: "// ... existing code ...\n",
          }),
        },
      });
      expect((await markerLeak.edit("src/file.ts")).code).toBe(
        "marker_leakage",
      );
      expect(descriptors()).toEqual(before);
      const missingKey = await morph(adapter, {
        runtime: {
          constants: {
            MORPH_API_KEY: undefined,
            ALLOW_READONLY_AGENTS: false,
            READONLY_AGENTS: ["plan", "explore"],
            EXISTING_CODE_MARKER: "// ... existing code ...",
            PLUGIN_VERSION: "test",
            MORPH_MODEL: "test",
          },
        },
      });
      expect((await missingKey.edit("src/file.ts")).code).toBe(
        "missing_api_key",
      );
      expect(descriptors()).toEqual(before);
      const apiError = await morph(adapter, {
        runtime: {
          callMorphApply: async () => ({
            success: false,
            error: "synthetic API failure",
          }),
        },
      });
      expect((await apiError.edit("src/file.ts")).status).toBe("error");
      expect(descriptors()).toEqual(before);
      const writeError = await morph(adapter, {
        afterRead: () => symlinkSync(outside, join(root, "missing")),
      });
      expect((await writeError.edit("missing/new.ts", CREATED)).code).toBe(
        "write_failed",
      );
      expect(descriptors()).toEqual(before);
      const thrownApi = await morph(adapter, {
        duringApi: () => {
          throw new Error("synthetic thrown API");
        },
      });
      await expect(thrownApi.edit("src/file.ts")).rejects.toThrow(
        "synthetic thrown API",
      );
      expect(descriptors()).toEqual(before);
    });
  });
}

describe("confined target lifecycle", () => {
  test("reads use a stable snapshot and close is idempotent", async () => {
    const acquired = openConfinedTarget("src/file.ts", root);
    if ("error" in acquired) throw new Error(acquired.error);
    try {
      expect(await acquired.target.read()).toEqual({
        exists: true,
        text: ORIGINAL,
      });
      expect(await acquired.target.read()).toEqual({
        exists: true,
        text: ORIGINAL,
      });
    } finally {
      acquired.target.close();
    }
    acquired.target.close();
    await expect(acquired.target.read()).rejects.toThrow("closed");
    await expect(acquired.target.write(MERGED)).rejects.toThrow("closed");
  });
  test("a failed parent creation cannot retry publication at a shallower directory", async () => {
    const acquired = openConfinedTarget("gen/new/file.ts", root);
    if ("error" in acquired) throw new Error(acquired.error);
    try {
      symlinkSync(outside, join(root, "gen"));
      await expect(acquired.target.write(CREATED)).rejects.toThrow();
      fs.unlinkSync(join(root, "gen"));
      await expect(acquired.target.write(CREATED)).rejects.toThrow(
        "already attempted",
      );
      expect(existsSync(join(root, "file.ts"))).toBe(false);
      expect(existsSync(join(outside, "new"))).toBe(false);
    } finally {
      acquired.target.close();
    }
  });
});

describe("confinement inputs outside the process's control", () => {
  test("descriptor paths resolve through this process, not process.pid", async () => {
    const child = Bun.spawn(["sleep", "30"]);
    const pid = Object.getOwnPropertyDescriptor(process, "pid")!;
    Object.defineProperty(process, "pid", {
      value: child.pid,
      configurable: true,
    });
    try {
      const acquired = openConfinedTarget("src/file.ts", root);
      if ("error" in acquired) throw new Error(acquired.error);
      try {
        expect(await acquired.target.read()).toEqual({
          exists: true,
          text: ORIGINAL,
        });
      } finally {
        acquired.target.close();
      }
    } finally {
      Object.defineProperty(process, "pid", pid);
      child.kill();
      await child.exited;
    }
  });
  test("V1 host plugin options cannot replace the edit runtime", async () => {
    // The V1 host passes config-supplied plugin options here.
    const server = plugin.server as (
      input: Parameters<typeof plugin.server>[0],
      options: unknown,
    ) => ReturnType<typeof plugin.server>;
    const hooks = await server(
      {
        directory: root,
        client: { app: { log: async () => {} } },
      } as unknown as Parameters<typeof plugin.server>[0],
      {
        runtimeOverrides: {
          context: { agent: "build", worktree: outside },
          constants: {
            MORPH_API_KEY: undefined,
            ALLOW_READONLY_AGENTS: false,
            READONLY_AGENTS: [],
            EXISTING_CODE_MARKER: "// ... existing code ...",
            PLUGIN_VERSION: "test",
            MORPH_MODEL: "test",
          },
        },
      },
    );
    const tool = hooks.tool!.morph_edit;
    const result = await tool.execute(
      {
        target_filepath: join(outside, "src", "created.ts"),
        instructions: "fixture",
        code_edit: CREATED,
      },
      { agent: "build", worktree: root } as Parameters<typeof tool.execute>[1],
    );
    if (typeof result === "string") throw new Error("Missing V1 metadata");
    expect(result.metadata).toMatchObject({ code: "path_refused" });
    expect(existsSync(join(outside, "src", "created.ts"))).toBe(false);
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
    try {
      writeSync(fd, MERGED);
    } finally {
      closeSync(fd);
    }
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
    try {
      swapForSymlink(leaf, join(outside, "src", "file.ts"));
      await Bun.write(Bun.file(fd), MERGED);
    } finally {
      closeSync(fd);
    }
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
