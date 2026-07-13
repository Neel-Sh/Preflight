import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChangeManifest, PreflightConfig } from "../src/core/types.js";
import { planChecks } from "../src/core/planner.js";
import { runProcess } from "../src/core/process.js";

const manifest: ChangeManifest = {
  scope: "worktree",
  files: [{ path: "src/index.ts", status: "modified", added: 1, removed: 1, binary: false, surfaces: [] }],
  added: 1,
  removed: 1,
  binaryFiles: 0,
  patch: "",
  fingerprint: "test",
};

describe("execution boundaries", () => {
  it("rejects a check cwd that escapes through a symbolic link", async () => {
    const root = await mkdtemp(join(tmpdir(), "preflight-root-"));
    const outside = await mkdtemp(join(tmpdir(), "preflight-outside-"));
    await mkdir(join(root, "src"));
    await symlink(outside, join(root, "escape"));
    const config: PreflightConfig = {
      version: 1,
      includeUntracked: true,
      concurrency: 1,
      criticalPaths: [],
      surfaces: [],
      checks: [{ id: "escape", label: "Escape", run: ["true"], cwd: "escape", timeout: "1s", blocking: true, proves: [] }],
      contracts: [],
    };
    expect(() => planChecks(root, manifest, config)).toThrow("outside the repository");
  });

  it("labels bounded output as truncated", async () => {
    const root = await mkdtemp(join(tmpdir(), "preflight-process-"));
    const result = await runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(1000))"], { cwd: root, maxOutputBytes: 100 });
    expect(result.stdout).toHaveLength(100);
    expect(result.stdoutTruncated).toBe(true);
  });

  it("times out long-running commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "preflight-timeout-"));
    const result = await runProcess(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { cwd: root, timeoutMs: 20 });
    expect(result.timedOut).toBe(true);
  });
});
