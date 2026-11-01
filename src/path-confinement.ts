import {
  accessSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statfsSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { dlopen } from "bun:ffi";

export interface ResolveResult {
  path: string;
}

export interface RejectResult {
  error: string;
}

export type ResolveTargetPathResult = ResolveResult | RejectResult;

/**
 * Check whether `resolved` is contained within `root`.
 *
 * Uses the canonical check: resolved === root OR resolved starts with root + path.sep.
 * This avoids the naïve prefix bug where /rootEvil passes for root /root.
 */
function isContained(resolved: string, root: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedResolved = path.resolve(resolved);
  return (
    normalizedResolved === normalizedRoot ||
    normalizedResolved.startsWith(normalizedRoot + path.sep)
  );
}

/** Find the nearest filesystem entry, including a dangling symlink. */
function findNearestExistingParent(targetPath: string): string | null {
  let current = targetPath;
  while (true) {
    if (lstatSync(current, { throwIfNoEntry: false })) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Diagnose path refusals. The returned pathname is not authority for I/O;
 * openConfinedTarget acquires the objects used by an edit.
 *
 * - For existing targets: follows symlinks via realpath and ensures the
 *   canonical location is inside the root.
 * - For new targets: resolves the path, finds the nearest existing parent,
 *   follows symlinks on that parent, and ensures the parent is inside root.
 *
 * @param targetPath - The requested path (relative or absolute)
 * @param root - The allowed root directory
 * @param options - `{ targetExists?: boolean }` — when true, realpaths the
 *   target itself; when false/omitted, realpaths the nearest existing parent
 * @returns `{ path: resolvedPath }` on success, `{ error: message }` on rejection
 */
export function resolveTargetPath(
  targetPath: string,
  root: string,
  options?: { targetExists?: boolean },
): ResolveTargetPathResult {
  const normalizedRoot = path.resolve(root);

  // Resolve the target path relative to root
  const resolved = path.resolve(normalizedRoot, targetPath);

  // Initial containment check on the resolved path
  if (!isContained(resolved, normalizedRoot)) {
    return {
      error: `Path is outside allowed root: ${targetPath}`,
    };
  }

  const targetExists = options?.targetExists ?? false;

  try {
    const parent = targetExists
      ? resolved
      : findNearestExistingParent(resolved);
    if (!parent) {
      return {
        error: `Cannot resolve path inside allowed root: ${targetPath}`,
      };
    }
    const canonicalParent = realpathSync(parent);
    if (!isContained(canonicalParent, normalizedRoot)) {
      return {
        error: `Path resolves outside allowed root via symlink: ${targetPath}`,
      };
    }
    const effectivePath = path.resolve(
      canonicalParent,
      path.relative(parent, resolved),
    );
    if (!isContained(effectivePath, normalizedRoot)) {
      return {
        error: `Effective path resolves outside allowed root via symlink: ${targetPath}`,
      };
    }
    return { path: effectivePath };
  } catch {
    return { error: `Cannot resolve path inside allowed root: ${targetPath}` };
  }
}

export interface ConfinedTarget {
  /** Return the acquired file's snapshot. A target permits one publication. */
  read: () => Promise<{ exists: boolean; text: string }>;
  write: (content: string) => Promise<void>;
  close: () => void;
}

export type OpenTargetResult = { target: ConfinedTarget } | RejectResult;

const errorCode = (err: unknown) => (err as NodeJS.ErrnoException).code;

function openMetadataInspection() {
  // size_t/ssize_t use the 64-bit Linux ABI on these supported architectures.
  if (process.arch !== "x64" && process.arch !== "arm64")
    throw new Error("Access metadata inspection requires 64-bit Linux glibc");
  return dlopen("libc.so.6", {
    flistxattr: { args: ["i32", "ptr", "u64"], returns: "i64" },
  });
}

/**
 * Acquire directory objects without following user-tree symlinks. Authority
 * stays with those objects after rename, not with their former pathnames.
 * Linux procfs supplies dirfd-relative paths missing from node:fs's API.
 */
export function openConfinedTarget(
  targetPath: string,
  root: string,
): OpenTargetResult {
  const descriptors = new Set<number>();
  let metadata: ReturnType<typeof openMetadataInspection> | undefined;
  const requireNoAttributes = (fd: number) => {
    if (!metadata) throw new Error("Access metadata inspection is unavailable");
    // Zero size only queries the length; no native buffer or attribute copying.
    const size = metadata.symbols.flistxattr(fd, null, 0);
    if (size !== 0n)
      throw new Error(
        size < 0n
          ? "Cannot inspect extended attributes; refusing replacement"
          : "Extended attributes or ACLs prevent safe replacement",
      );
  };
  const hold = (fd: number) => {
    descriptors.add(fd);
    return fd;
  };
  const release = (fd: number) => {
    descriptors.delete(fd);
    closeSync(fd);
  };
  const close = () => {
    let failure: unknown;
    for (const fd of descriptors) {
      try {
        release(fd);
      } catch (err) {
        failure ??= err;
      }
    }
    try {
      metadata?.close();
    } catch (err) {
      failure ??= err;
    }
    metadata = undefined;
    if (failure) throw failure;
  };
  try {
    if (
      process.platform !== "linux" ||
      !constants.O_NOFOLLOW ||
      !constants.O_DIRECTORY
    ) {
      throw new Error(
        "Confined editing requires Linux with O_NOFOLLOW and procfs",
      );
    }
    const directoryFlags =
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
    let parent = hold(openSync("/", directoryFlags));
    // The kernel resolves self to the caller; process.pid can name another
    // process when this procfs belongs to a different PID namespace.
    const proc = "/proc/self/fd";
    // /proc is a kernel mount, not an application directory or symlink alias.
    // Privileged mount-namespace changes are outside this process's boundary.
    const procFd = hold(openSync("/proc", directoryFlags));
    if (
      statfsSync("/proc").type !== 0x9fa0 ||
      statfsSync(proc).type !== 0x9fa0 ||
      !lstatSync(proc).isDirectory()
    ) {
      throw new Error("Cannot verify Linux procfs for confined editing");
    }
    const anchor = fstatSync(parent, { bigint: true });
    const viaProc = statSync(`${proc}/${parent}`, { bigint: true });
    if (
      anchor.dev !== viaProc.dev ||
      anchor.ino !== viaProc.ino ||
      !lstatSync(`${proc}/${parent}`).isSymbolicLink()
    ) {
      throw new Error("Cannot verify procfs descriptor resolution");
    }
    release(procFd);
    const at = (fd: number, name: string) => `${proc}/${fd}/${name}`;
    const descend = (name: string) => {
      const next = hold(openSync(at(parent, name), directoryFlags));
      release(parent);
      parent = next;
    };

    const resolved = resolveTargetPath(targetPath, root);
    if ("error" in resolved) throw new Error(resolved.error);
    const normalizedRoot = path.resolve(root);
    // Use the requested spelling, never a realpath that removed symlinks.
    const relative = path.relative(
      normalizedRoot,
      path.resolve(normalizedRoot, targetPath),
    );
    if (!relative)
      throw new Error("Target must be a regular file, not the root directory");
    for (const component of normalizedRoot.split(path.sep).filter(Boolean))
      descend(component);
    const components = relative.split(path.sep);
    const leaf = components.pop()!;
    const missingParents: string[] = [];
    for (let i = 0; i < components.length; i++) {
      try {
        descend(components[i]);
      } catch (err) {
        if (errorCode(err) !== "ENOENT") throw err;
        missingParents.push(...components.slice(i));
        break;
      }
    }

    let fileFd: number | undefined;
    if (missingParents.length === 0) {
      try {
        fileFd = hold(
          openSync(
            at(parent, leaf),
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          ),
        );
      } catch (err) {
        if (errorCode(err) !== "ENOENT") throw err;
      }
    }
    const original =
      fileFd === undefined ? undefined : fstatSync(fileFd, { bigint: true });
    if (original && (!original.isFile() || original.nlink !== 1n)) {
      throw new Error(
        "Target must be a regular file without hard-link aliases",
      );
    }
    if (fileFd !== undefined) {
      metadata = openMetadataInspection();
      requireNoAttributes(fileFd);
    }
    const requireOriginalMetadata = () => {
      if (fileFd === undefined || !original) return;
      requireNoAttributes(fileFd);
      const current = fstatSync(fileFd, { bigint: true });
      if (
        current.uid !== original.uid ||
        current.gid !== original.gid ||
        current.mode !== original.mode
      )
        throw new Error("Target access metadata changed during the edit");
    };
    let closed = false;
    let writeStarted = false;
    let snapshot: { exists: boolean; text: string } | undefined;
    const requireOpen = () => {
      if (closed) throw new Error("Confined target is closed");
    };
    return {
      target: {
        read: async () => {
          requireOpen();
          if (snapshot) return snapshot;
          if (fileFd === undefined)
            return (snapshot = { exists: false, text: "" });
          if (fstatSync(fileFd, { bigint: true }).nlink > 1n)
            throw new Error("Target acquired hard-link aliases before read");
          requireOriginalMetadata();
          return (snapshot = {
            exists: true,
            text: readFileSync(fileFd, "utf8"),
          });
        },
        write: async (content) => {
          requireOpen();
          if (writeStarted)
            throw new Error("Confined target already attempted publication");
          writeStarted = true;
          for (const component of missingParents) {
            try {
              mkdirSync(at(parent, component));
            } catch (err) {
              if (errorCode(err) !== "EEXIST") throw err;
            }
            descend(component);
          }
          const destination = at(parent, leaf);
          const current = lstatSync(destination, {
            bigint: true,
            throwIfNoEntry: false,
          });
          // Conflict detection is diagnostic only. rename never follows the
          // destination leaf, even if another process changes it after this.
          if (
            original
              ? !current ||
                !current.isFile() ||
                current.dev !== original.dev ||
                current.ino !== original.ino
              : current
          ) {
            throw new Error("Target changed during the edit");
          }
          // Replacing the name needs only a writable parent; keep the
          // acquired file's own write permission as a precondition.
          if (fileFd !== undefined)
            accessSync(`${proc}/${fileFd}`, constants.W_OK);
          requireOriginalMetadata();
          const temporary = at(parent, `.morph-${randomUUID()}.tmp`);
          // The kernel applies umask and default ACLs to a new file's mode.
          // Reading process.umask() briefly sets the process umask to 0.
          const fd = hold(
            openSync(
              temporary,
              constants.O_WRONLY |
                constants.O_CREAT |
                constants.O_EXCL |
                constants.O_NOFOLLOW,
              original ? 0o600 : 0o666,
            ),
          );
          let published = false;
          let failure: unknown;
          try {
            const requireReplacementMetadata = () => {
              if (!original) return;
              requireNoAttributes(fd);
              const replacement = fstatSync(fd, { bigint: true });
              if (
                replacement.uid !== original.uid ||
                replacement.gid !== original.gid
              )
                throw new Error(
                  "Replacement owner or group differs from target",
                );
            };
            requireReplacementMetadata();
            writeFileSync(fd, content, "utf8");
            if (original) fchmodSync(fd, Number(original.mode & 0o777n));
            requireOriginalMetadata();
            requireReplacementMetadata();
            // A fresh inode avoids modifying any hard-link alias of the
            // original. Both names resolve through the held parent object.
            renameSync(temporary, destination);
            published = true;
          } catch (err) {
            failure = err;
          }
          try {
            release(fd);
          } catch (err) {
            failure ??= err;
          }
          if (!published) {
            try {
              unlinkSync(temporary);
            } catch (err) {
              if (errorCode(err) !== "ENOENT") failure ??= err;
            }
          }
          if (failure) throw failure;
        },
        close: () => {
          if (closed) return;
          closed = true;
          close();
        },
      },
    };
  } catch (err) {
    try {
      close();
    } catch (cleanupError) {
      return {
        error: `Cannot acquire confined target: ${String(err)}; cleanup failed: ${String(cleanupError)}`,
      };
    }
    return {
      error: `Cannot acquire confined target: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
