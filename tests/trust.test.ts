import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlannedCheck } from "../src/core/types.js";
import { executionPolicyHash } from "../src/core/trust.js";

describe("execution trust", () => {
  it("binds package scripts without invalidating on dependency-only edits", async () => {
    const root = await mkdtemp(join(tmpdir(), "preflight-trust-"));
    const check: PlannedCheck = {
      id: "test",
      label: "Tests",
      command: ["pnpm", "run", "test"],
      cwd: root,
      timeoutMs: 1_000,
      blocking: true,
      reason: ["test"],
      proves: [],
    };
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest" }, dependencies: { a: "1" } }));
    const original = await executionPolicyHash(root, "config", [check]);
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest" }, dependencies: { a: "2" } }));
    expect(await executionPolicyHash(root, "config", [check])).toBe(original);
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "node dangerous.js" }, dependencies: { a: "2" } }));
    expect(await executionPolicyHash(root, "config", [check])).not.toBe(original);
    await rm(root, { recursive: true, force: true });
  });
});
