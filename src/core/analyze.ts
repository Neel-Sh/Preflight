import { lstat, readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import picomatch from "picomatch";
import type { ChangeManifest, ContractConfig, Finding, PreflightConfig, TaskIntent } from "./types.js";
import { matchesAny } from "./classify.js";
import { secretMatches } from "./redaction.js";
import { shortHash } from "./utils.js";

function finding(input: Omit<Finding, "id">): Finding {
  const locationKey = input.location ? `${input.location.path}:${input.location.line ?? ""}` : "";
  return { ...input, id: `${input.ruleId}:${shortHash(`${input.ruleId}:${locationKey}:${input.detail}`)}` };
}

function scopeFindings(manifest: ChangeManifest, task?: TaskIntent): Finding[] {
  if (!task) return [];
  const findings: Finding[] = [];
  if (task.expectedPaths.length > 0) {
    for (const file of manifest.files.filter((candidate) => !matchesAny(candidate.path, task.expectedPaths))) {
      findings.push(finding({
        ruleId: "scope.outside-expected",
        title: "Changed outside expected scope",
        detail: `${file.path} does not match any expected task path.`,
        severity: "warning",
        confidence: "deterministic",
        blocking: false,
        location: { path: file.path },
        evidence: [{ kind: "observed", summary: `Expected one of: ${task.expectedPaths.join(", ")}` }],
        remediation: { summary: "Review whether this file belongs to the task, then revert it or expand the task scope explicitly." },
      }));
    }
  }
  for (const file of manifest.files.filter((candidate) => matchesAny(candidate.path, task.avoidedPaths))) {
    findings.push(finding({
      ruleId: "scope.forbidden",
      title: "Avoided path changed",
      detail: `${file.path} matches a path explicitly excluded from this task.`,
      severity: "error",
      confidence: "deterministic",
      blocking: true,
      location: { path: file.path },
      evidence: [{ kind: "observed", summary: `Avoided paths: ${task.avoidedPaths.join(", ")}` }],
      remediation: { summary: "Revert the unrelated change or start a new task with an intentional scope." },
    }));
  }
  return findings;
}

function secretFindings(manifest: ChangeManifest): Finding[] {
  const findings: Finding[] = [];
  let currentPath: string | undefined;
  let currentLine = 0;
  for (const line of manifest.patch.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentPath = line.slice(6);
      currentLine = 0;
      continue;
    }
    const hunk = /^@@ -[^ ]+ \+(\d+)/.exec(line);
    if (hunk) {
      currentLine = Number(hunk[1]) - 1;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentLine += 1;
      for (const match of secretMatches(line.slice(1))) {
        findings.push(finding({
          ruleId: `secret.${match.detector}`,
          title: "Likely secret added",
          detail: `A ${match.detector.replaceAll("-", " ")} pattern appears in an added line. The value has been masked.`,
          severity: "error",
          confidence: "deterministic",
          blocking: true,
          ...(currentPath ? { location: { path: currentPath, line: currentLine } } : {}),
          evidence: [{ kind: "observed", summary: `Detector: ${match.detector}` }],
          remediation: { summary: "Remove and rotate the credential, then use an environment variable or secret manager." },
        }));
      }
    } else if (!line.startsWith("-")) {
      currentLine += 1;
    }
  }
  return findings;
}

async function contractFinding(root: string, manifest: ChangeManifest, contract: ContractConfig): Promise<Finding[]> {
  if (!manifest.files.some((file) => matchesAny(file.path, contract.when.changed))) return [];
  const findings: Finding[] = [];
  const changedPaths = manifest.files.map((file) => file.path);
  if (contract.requireChanged && !changedPaths.some((path) => matchesAny(path, contract.requireChanged!))) {
    findings.push(finding({
      ruleId: `contract.${contract.id}.companion`,
      title: contract.label,
      detail: `A companion change is required in: ${contract.requireChanged.join(", ")}.`,
      severity: contract.blocking ? "error" : "warning",
      confidence: "deterministic",
      blocking: contract.blocking,
      evidence: [{ kind: "observed", summary: `Triggered by: ${contract.when.changed.join(", ")}` }],
      remediation: { summary: "Add the required companion change or update the repository contract intentionally." },
    }));
  }
  const forbidden = contract.forbidChanged ? changedPaths.filter((path) => matchesAny(path, contract.forbidChanged!)) : [];
  for (const path of forbidden) {
    findings.push(finding({
      ruleId: `contract.${contract.id}.forbidden`,
      title: contract.label,
      detail: `${path} is forbidden by this repository contract.`,
      severity: contract.blocking ? "error" : "warning",
      confidence: "deterministic",
      blocking: contract.blocking,
      location: { path },
      evidence: [{ kind: "observed", summary: `Forbidden patterns: ${contract.forbidChanged!.join(", ")}` }],
      remediation: { summary: "Revert the file or update the contract through an explicit policy change." },
    }));
  }
  if (contract.requireText) {
    const matchingFiles = changedPaths.filter((path) => picomatch.isMatch(path, contract.requireText!.path, { dot: true }));
    for (const path of matchingFiles) {
      let content = "";
      try {
        const absolute = join(root, path);
        const fileStat = await lstat(absolute);
        if (fileStat.isSymbolicLink()) throw new Error("Text contracts do not follow symbolic links.");
        const [realRoot, realFile] = await Promise.all([realpath(root), realpath(absolute)]);
        if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${sep}`)) throw new Error("Text contract path leaves the repository.");
        content = await readFile(realFile, "utf8");
      } catch {
        // A deleted or binary file cannot satisfy a text contract.
      }
      const missing = contract.requireText.values.filter((value) => !content.includes(value));
      if (missing.length > 0) {
        findings.push(finding({
          ruleId: `contract.${contract.id}.text`,
          title: contract.label,
          detail: `${path} is missing required text: ${missing.join(", ")}.`,
          severity: contract.blocking ? "error" : "warning",
          confidence: "deterministic",
          blocking: contract.blocking,
          location: { path },
          evidence: [{ kind: "observed", summary: `Required by contract ${contract.id}` }],
          remediation: { summary: "Restore the required text or change the repository contract intentionally." },
        }));
      }
    }
  }
  return findings;
}

export async function analyze(root: string, manifest: ChangeManifest, config: PreflightConfig, task?: TaskIntent): Promise<Finding[]> {
  const findings = [...scopeFindings(manifest, task), ...secretFindings(manifest)];
  const dependencyFiles = manifest.files.filter((file) => file.surfaces.includes("dependency"));
  if (dependencyFiles.length > 0) {
    findings.push(finding({
      ruleId: "dependency.manifest-changed",
      title: "Dependency material changed",
      detail: `${dependencyFiles.map((file) => file.path).join(", ")} changed. Review additions, removals, and lockfile consistency.`,
      severity: "warning",
      confidence: "deterministic",
      blocking: false,
      evidence: dependencyFiles.map((file) => ({ kind: "observed" as const, summary: file.path })),
      remediation: { summary: "Inspect the dependency diff and confirm the lockfile was produced by the expected package manager." },
    }));
  }
  const sourceChanged = manifest.files.some((file) => !file.surfaces.some((surface) => ["tests", "documentation", "generated"].includes(surface)));
  const testsChanged = manifest.files.some((file) => file.surfaces.includes("tests"));
  if (sourceChanged && !testsChanged) {
    findings.push(finding({
      ruleId: "evidence.no-test-change",
      title: "No test file changed",
      detail: "Implementation files changed without a related test-file change. Existing tests may still provide coverage, so this is not a failure.",
      severity: "warning",
      confidence: "inferred",
      blocking: false,
      evidence: [{ kind: "inferred", summary: "Path classification found source changes and no test-path changes." }],
      remediation: { summary: "Run the selected tests and consider adding a focused regression test for the changed behavior." },
    }));
  }
  for (const contract of config.contracts) findings.push(...await contractFinding(root, manifest, contract));
  return findings;
}
