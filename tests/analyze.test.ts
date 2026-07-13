import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChangeManifest, PreflightConfig } from "../src/core/types.js";
import { analyze } from "../src/core/analyze.js";

const config: PreflightConfig = { version: 1, includeUntracked: true, concurrency: 1, criticalPaths: [], surfaces: [], checks: [], contracts: [] };

describe("deterministic analyzers", () => {
  it("blocks known secret prefixes without retaining the value", async () => {
    const root = await mkdtemp(join(tmpdir(), "preflight-analyze-"));
    const secret = `ghp_${"x".repeat(36)}`;
    const manifest: ChangeManifest = {
      scope: "worktree",
      files: [{ path: "config.ts", status: "added", added: 1, removed: 0, binary: false, surfaces: [] }],
      added: 1,
      removed: 0,
      binaryFiles: 0,
      patch: `diff --git a/config.ts b/config.ts\n--- /dev/null\n+++ b/config.ts\n@@ -0,0 +1 @@\n+export const token = '${secret}';`,
      fingerprint: "test",
    };
    const findings = await analyze(root, manifest, config);
    const finding = findings.find((item) => item.ruleId === "secret.github-token");
    expect(finding).toMatchObject({ blocking: true, severity: "error", location: { path: "config.ts", line: 1 } });
    expect(JSON.stringify(finding)).not.toContain(secret);
    await rm(root, { recursive: true, force: true });
  });
});
