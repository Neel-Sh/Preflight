import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PreflightConfig } from "../src/core/types.js";
import { executeCheckWorkflow } from "../src/core/run.js";
import { runProcess } from "../src/core/process.js";
import { serializeConfig } from "../src/core/config.js";

const roots: string[] = [];

async function git(root: string, args: string[]): Promise<void> {
  const result = await runProcess("git", args, { cwd: root });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString("utf8"));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("evidence workflow", () => {
  it("marks a receipt stale when a check mutates the inspected workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "preflight-workflow-"));
    roots.push(root);
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.email", "preflight@example.test"]);
    await git(root, ["config", "user.name", "Preflight Test"]);
    await writeFile(join(root, ".gitignore"), ".preflight/\n");
    await writeFile(join(root, "app.ts"), "export const state = 'initial';\n");
    const config: PreflightConfig = {
      version: 1,
      includeUntracked: true,
      concurrency: 1,
      criticalPaths: [],
      surfaces: [],
      checks: [{
        id: "mutating-check",
        label: "Mutating check",
        when: { changed: ["app.ts"] },
        run: [process.execPath, "-e", "require('node:fs').writeFileSync('app.ts', \"export const state = 'changed-during-check';\\n\")"],
        timeout: "5s",
        blocking: true,
        proves: [],
      }],
      contracts: [],
    };
    await writeFile(join(root, ".preflight.yml"), serializeConfig(config));
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "initial"]);
    await writeFile(join(root, "app.ts"), "export const state = 'before-check';\n");

    const run = await executeCheckWorkflow({ cwd: root, scope: "worktree", quick: false, trustConfig: true, json: true });
    expect(run.checks[0]?.state).toBe("passed");
    expect(run.preRunFingerprint).not.toBe(run.postRunFingerprint);
    expect(run.outcome).toBe("stale");
  });
});
