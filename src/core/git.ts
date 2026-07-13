import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import type { ChangeManifest, ChangedFile, ChangeStatus, PreflightConfig, RepositoryState, ScopeMode, TaskIntent } from "./types.js";
import { runProcess, runText } from "./process.js";
import { sha256 } from "./utils.js";

interface GitContext {
  root: string;
  headSha: string | null;
  branch: string;
  remoteHash?: string;
}

interface DiffSpec {
  args: string[];
  baseRef: string;
  mergeBaseSha: string;
}

export async function findRepositoryRoot(cwd: string): Promise<string> {
  try {
    return (await runText("git", ["rev-parse", "--show-toplevel"], { cwd })).trim();
  } catch {
    throw new Error("Preflight must be run inside a Git repository.");
  }
}

async function gitMaybe(root: string, args: string[]): Promise<string | null> {
  const result = await runProcess("git", args, { cwd: root });
  return result.exitCode === 0 ? result.stdout.toString("utf8").trim() : null;
}

export async function getGitContext(root: string): Promise<GitContext> {
  const headSha = await gitMaybe(root, ["rev-parse", "HEAD"]);
  const branch = (await gitMaybe(root, ["symbolic-ref", "--quiet", "--short", "HEAD"])) ?? "(detached)";
  const remote = await gitMaybe(root, ["config", "--get", "remote.origin.url"]);
  return { root, headSha, branch, ...(remote ? { remoteHash: sha256(remote) } : {}) };
}

export async function isDirty(root: string): Promise<boolean> {
  const output = await runText("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: root });
  return output.length > 0;
}

async function resolveBase(root: string, configured?: string): Promise<string> {
  if (configured) {
    if (!(await gitMaybe(root, ["rev-parse", "--verify", `${configured}^{commit}`]))) {
      throw new Error(`Configured base branch '${configured}' does not exist locally.`);
    }
    return configured;
  }

  const remoteHead = await gitMaybe(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (remoteHead) return remoteHead;
  for (const candidate of ["origin/main", "main", "origin/master", "master"]) {
    if (await gitMaybe(root, ["rev-parse", "--verify", `${candidate}^{commit}`])) return candidate;
  }
  return "HEAD";
}

async function emptyTree(root: string): Promise<string> {
  return (await runText("git", ["hash-object", "-t", "tree", "--stdin"], { cwd: root, input: Buffer.alloc(0) })).trim();
}

async function makeDiffSpec(root: string, scope: ScopeMode, config: PreflightConfig, task?: TaskIntent): Promise<DiffSpec> {
  const context = await getGitContext(root);
  if (scope === "staged") return { args: ["--cached"], baseRef: "HEAD (staged)", mergeBaseSha: context.headSha ?? await emptyTree(root) };
  if (scope === "worktree") return { args: [], baseRef: "index (worktree)", mergeBaseSha: context.headSha ?? await emptyTree(root) };

  if (scope === "task") {
    if (!task) throw new Error("No active task. Run `preflight start <intent>` first, or choose --branch.");
    if (!(await gitMaybe(root, ["cat-file", "-e", `${task.startHeadSha}^{commit}`]))) {
      throw new Error(`The task starting commit ${task.startHeadSha.slice(0, 10)} is no longer available.`);
    }
    return { args: [task.startHeadSha], baseRef: task.startHeadSha, mergeBaseSha: task.startHeadSha };
  }

  if (!context.headSha) {
    const empty = await emptyTree(root);
    return { args: [empty], baseRef: "empty tree", mergeBaseSha: empty };
  }
  const baseRef = await resolveBase(root, config.baseBranch);
  if (baseRef === "HEAD") return { args: ["HEAD"], baseRef, mergeBaseSha: context.headSha };
  const mergeBaseSha = (await runText("git", ["merge-base", "HEAD", baseRef], { cwd: root })).trim();
  return { args: [mergeBaseSha], baseRef, mergeBaseSha };
}

function mapStatus(value: string): ChangeStatus {
  const code = value[0];
  if (code === "A") return "added";
  if (code === "M") return "modified";
  if (code === "D") return "deleted";
  if (code === "R") return "renamed";
  if (code === "C") return "copied";
  if (code === "T") return "type-changed";
  return "unknown";
}

export function parseNameStatusZ(output: Buffer): ChangedFile[] {
  const fields = output.toString("utf8").split("\0");
  const files: ChangedFile[] = [];
  let index = 0;
  while (index < fields.length && fields[index]) {
    const statusField = fields[index++]!;
    let status = statusField;
    let path: string | undefined;
    if (statusField.includes("\t")) {
      const [embeddedStatus, embeddedPath] = statusField.split("\t", 2);
      status = embeddedStatus ?? statusField;
      path = embeddedPath;
    }
    path ??= fields[index++];
    if (!path) break;
    const mapped = mapStatus(status);
    if (mapped === "renamed" || mapped === "copied") {
      const newPath = fields[index++];
      if (!newPath) break;
      files.push({ path: newPath, oldPath: path, status: mapped, added: 0, removed: 0, binary: false, surfaces: [] });
    } else {
      files.push({ path, status: mapped, added: 0, removed: 0, binary: false, surfaces: [] });
    }
  }
  return files;
}

export function parseNumstatZ(output: Buffer): Map<string, { added: number | null; removed: number | null; binary: boolean }> {
  const fields = output.toString("utf8").split("\0");
  const result = new Map<string, { added: number | null; removed: number | null; binary: boolean }>();
  let index = 0;
  while (index < fields.length && fields[index] !== undefined && fields[index] !== "") {
    const field = fields[index++]!;
    const firstTab = field.indexOf("\t");
    const secondTab = field.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const addedRaw = field.slice(0, firstTab);
    const removedRaw = field.slice(firstTab + 1, secondTab);
    let path = field.slice(secondTab + 1);
    if (!path) {
      index += 1; // old path for a rename/copy
      path = fields[index++] ?? "";
    }
    if (!path) continue;
    const binary = addedRaw === "-" || removedRaw === "-";
    result.set(path, {
      added: binary ? null : Number(addedRaw),
      removed: binary ? null : Number(removedRaw),
      binary,
    });
  }
  return result;
}

async function untrackedPaths(root: string): Promise<string[]> {
  const output = await runText("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: root });
  return output.split("\0").filter((entry) => entry.startsWith("?? ")).map((entry) => entry.slice(3));
}

async function untrackedFile(root: string, path: string): Promise<{ file: ChangedFile; patch: string; hash: string }> {
  const absolute = join(root, path);
  const fileStat = await lstat(absolute);
  if (fileStat.isSymbolicLink()) {
    const target = await readlink(absolute);
    return {
      file: { path, status: "untracked", added: 1, removed: 0, binary: false, surfaces: [] },
      patch: `diff --preflight-untracked a/${path} b/${path}\n--- /dev/null\n+++ b/${path}\n+symbolic link -> ${target}`,
      hash: sha256(`symlink:${target}`),
    };
  }
  if (!fileStat.isFile() || fileStat.size > 2 * 1024 * 1024) {
    return {
      file: { path, status: "untracked", added: null, removed: 0, binary: true, surfaces: [] },
      patch: "",
      hash: sha256(`${path}:${fileStat.size}:${fileStat.mtimeMs}`),
    };
  }
  const content = await readFile(absolute);
  const binary = content.includes(0);
  const text = binary ? "" : content.toString("utf8");
  const added = binary ? null : (text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));
  const patch = binary ? "" : `diff --preflight-untracked a/${path} b/${path}\n--- /dev/null\n+++ b/${path}\n${text.split("\n").map((line) => `+${line}`).join("\n")}`;
  return {
    file: { path, status: "untracked", added, removed: 0, binary, surfaces: [] },
    patch,
    hash: sha256(content),
  };
}

export async function collectChanges(root: string, scope: ScopeMode, config: PreflightConfig, task?: TaskIntent): Promise<{ repository: RepositoryState; manifest: ChangeManifest }> {
  const context = await getGitContext(root);
  const spec = await makeDiffSpec(root, scope, config, task);
  const common = ["--no-ext-diff", "--find-renames", ...spec.args];
  const [names, numstat, patchResult, binaryPatchResult] = await Promise.all([
    runProcess("git", ["diff", ...common, "--name-status", "-z"], { cwd: root }),
    runProcess("git", ["diff", ...common, "--numstat", "-z"], { cwd: root }),
    runProcess("git", ["diff", ...common, "--unified=0"], { cwd: root, maxOutputBytes: 8 * 1024 * 1024 }),
    runProcess("git", ["diff", ...common, "--binary", "--full-index"], { cwd: root, maxOutputBytes: 16 * 1024 * 1024 }),
  ]);
  for (const result of [names, numstat, patchResult, binaryPatchResult]) {
    if (result.exitCode !== 0) throw new Error(result.stderr.toString("utf8").trim() || "Git could not collect the requested diff.");
  }

  const files = parseNameStatusZ(names.stdout);
  const stats = parseNumstatZ(numstat.stdout);
  for (const file of files) {
    const fileStats = stats.get(file.path);
    if (fileStats) Object.assign(file, fileStats);
  }

  const patches = [patchResult.stdout.toString("utf8")];
  const untrackedHashes: string[] = [];
  if (config.includeUntracked && scope !== "staged") {
    for (const path of await untrackedPaths(root)) {
      const collected = await untrackedFile(root, path);
      files.push(collected.file);
      if (collected.patch) patches.push(collected.patch);
      untrackedHashes.push(`${path}:${collected.hash}`);
    }
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  const dirty = await isDirty(root);
  const patch = patches.filter(Boolean).join("\n");
  const fingerprintInput = Buffer.concat([
    binaryPatchResult.stdout,
    Buffer.from(`\n${untrackedHashes.sort().join("\n")}\n${scope}\n${spec.mergeBaseSha}`, "utf8"),
  ]);
  const added = files.reduce((sum, file) => sum + (file.added ?? 0), 0);
  const removed = files.reduce((sum, file) => sum + (file.removed ?? 0), 0);
  const repository: RepositoryState = {
    root,
    branch: context.branch,
    headSha: context.headSha,
    ...(context.remoteHash ? { remoteHash: context.remoteHash } : {}),
    baseRef: spec.baseRef,
    mergeBaseSha: spec.mergeBaseSha,
    dirty,
  };
  return {
    repository,
    manifest: {
      scope,
      files,
      added,
      removed,
      binaryFiles: files.filter((file) => file.binary).length,
      patch,
      fingerprint: sha256(fingerprintInput),
    },
  };
}
