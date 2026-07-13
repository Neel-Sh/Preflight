import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PreflightConfig } from "../src/core/types.js";
import { collectChanges } from "../src/core/git.js";
import { runProcess } from "../src/core/process.js";

const roots: string[] = [];
const config: PreflightConfig = { version: 1, includeUntracked: true, concurrency: 2, criticalPaths: [], surfaces: [], checks: [], contracts: [] };

async function git(root: string, args: string[]): Promise<void> {
  const result = await runProcess("git", args, { cwd: root });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString("utf8"));
}

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "preflight-test-"));
  roots.push(root);
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "preflight@example.test"]);
  await git(root, ["config", "user.name", "Preflight Test"]);
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "value.ts"), "export const value = 1;\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "initial"]);
  return root;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("collectChanges", () => {
  it("collects modified and untracked worktree files", async () => {
    const root = await repository();
    await writeFile(join(root, "src", "value.ts"), "export const value = 2;\n");
    await writeFile(join(root, "new file.ts"), "export const fresh = true;\n");
    const { manifest } = await collectChanges(root, "worktree", config);
    expect(manifest.files).toMatchObject([
      { path: "new file.ts", status: "untracked", added: 1 },
      { path: "src/value.ts", status: "modified", added: 1, removed: 1 },
    ]);
    expect(manifest.fingerprint).toHaveLength(64);
  });

  it("keeps staged scope isolated from later worktree edits", async () => {
    const root = await repository();
    await writeFile(join(root, "src", "value.ts"), "export const value = 2;\n");
    await git(root, ["add", "src/value.ts"]);
    await writeFile(join(root, "src", "value.ts"), "export const value = 3;\n");
    const staged = await collectChanges(root, "staged", config);
    const worktree = await collectChanges(root, "worktree", config);
    expect(staged.manifest.added).toBe(1);
    expect(worktree.manifest.added).toBe(1);
    expect(staged.manifest.fingerprint).not.toBe(worktree.manifest.fingerprint);
  });

  it("includes committed branch changes and current untracked files", async () => {
    const root = await repository();
    await git(root, ["checkout", "-b", "feature"]);
    await writeFile(join(root, "src", "value.ts"), "export const value = 2;\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "change value"]);
    await writeFile(join(root, "untracked.md"), "note\n");
    const { manifest } = await collectChanges(root, "branch", config);
    expect(manifest.files.map((file) => file.path)).toEqual(["src/value.ts", "untracked.md"]);
  });

  it("preserves unusual filenames and rename metadata", async () => {
    const root = await repository();
    const unusual = "unicode-ß\nname.ts";
    await writeFile(join(root, unusual), "export const unusual = true;\n");
    await git(root, ["mv", "src/value.ts", "src/renamed value.ts"]);
    const { manifest } = await collectChanges(root, "branch", config);
    expect(manifest.files.find((file) => file.path === unusual)?.status).toBe("untracked");
    expect(manifest.files.find((file) => file.path === "src/renamed value.ts")).toMatchObject({
      status: "renamed",
      oldPath: "src/value.ts",
    });
  });
});
