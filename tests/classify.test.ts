import { describe, expect, it } from "vitest";
import { assessRisk, classifyChanges } from "../src/core/classify.js";
import type { ChangeManifest, PreflightConfig } from "../src/core/types.js";

const config: PreflightConfig = { version: 1, includeUntracked: true, concurrency: 2, criticalPaths: ["firestore.rules"], surfaces: [], checks: [], contracts: [] };

function manifest(paths: string[]): ChangeManifest {
  return {
    scope: "branch",
    files: paths.map((path) => ({ path, status: "modified", added: 1, removed: 1, binary: false, surfaces: [] })),
    added: paths.length,
    removed: paths.length,
    binaryFiles: 0,
    patch: "",
    fingerprint: "test",
  };
}

describe("classification and risk", () => {
  it("classifies sensitive Apple and Firebase surfaces", () => {
    const change = manifest(["Sources/Auth/SessionViewModel.swift", "App.entitlements", "firestore.rules"]);
    classifyChanges(change, config);
    expect(change.files[0]!.surfaces).toContain("authentication");
    expect(change.files[1]!.surfaces).toContain("permissions");
    expect(change.files[2]!.surfaces).toContain("database");
    const risk = assessRisk(change, config);
    expect(risk.score).toBeGreaterThanOrEqual(50);
    expect(risk.signals.find((signal) => signal.id === "critical-path")).toBeDefined();
  });
});
