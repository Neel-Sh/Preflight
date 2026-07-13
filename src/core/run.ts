import { confirm, isCancel } from "@clack/prompts";
import { relative, join } from "node:path";
import type { CheckResult, EvidenceScenario, Finding, Outcome, PreflightRun, ScopeMode } from "./types.js";
import { loadConfig } from "./config.js";
import { analyze } from "./analyze.js";
import { assessRisk, classifyChanges } from "./classify.js";
import { collectChanges, findRepositoryRoot } from "./git.js";
import { planChecks } from "./planner.js";
import { runChecks } from "./runner.js";
import { writeReports } from "./report.js";
import { loadTask, loadTrust, preflightDirectory, saveTrust } from "./storage.js";
import { executionPolicyHash } from "./trust.js";
import { createRunId, sha256 } from "./utils.js";

export interface CheckWorkflowOptions {
  cwd: string;
  scope?: ScopeMode;
  quick: boolean;
  trustConfig: boolean;
  json: boolean;
  intent?: string;
  expectedPaths?: string[];
  avoidedPaths?: string[];
  onPlan?: Parameters<typeof runChecks>[1]["onState"];
  onPrepared?: (prepared: { manifest: Awaited<ReturnType<typeof collectChanges>>["manifest"]; risk: ReturnType<typeof assessRisk>; checks: ReturnType<typeof planChecks> }) => void;
}

async function ensureTrusted(root: string, configHash: string, policyHash: string, remoteHash: string | undefined, commands: string[][], trustConfig: boolean, json: boolean): Promise<void> {
  if (commands.length === 0) return;
  const trust = await loadTrust(root);
  if (trust?.configHash === configHash && trust.executionPolicyHash === policyHash && trust.repositoryRoot === root && trust.remoteHash === remoteHash) return;

  if (!trustConfig) {
    if (json || !process.stdin.isTTY) throw new Error("Repository commands are not trusted. Review .preflight.yml, then rerun with --trust-config.");
    const answer = await confirm({
      message: `Trust and run ${commands.length} configured ${commands.length === 1 ? "command" : "commands"}?`,
      initialValue: false,
    });
    if (isCancel(answer) || !answer) throw new Error("Configuration was not trusted; no repository commands were run.");
  }
  await saveTrust(root, {
    schemaVersion: 1,
    repositoryRoot: root,
    ...(remoteHash ? { remoteHash } : {}),
    configHash,
    executionPolicyHash: policyHash,
    trustedAt: new Date().toISOString(),
  });
}

function scenarioModel(checks: CheckResult[], findings: Finding[], planned: ReturnType<typeof planChecks>, quick: boolean): EvidenceScenario[] {
  const scenarios = new Map<string, EvidenceScenario>();
  for (const check of planned) {
    for (const label of check.proves) scenarios.set(`${check.id}:${label}`, { id: `${check.id}:${label}`, label, state: "missing", source: check.id });
  }
  for (const check of checks) {
    for (const label of check.proves) {
      scenarios.set(`${check.id}:${label}`, {
        id: `${check.id}:${label}`,
        label,
        state: check.state === "passed" ? "verified" : "failed",
        source: check.id,
      });
    }
  }
  if (findings.some((finding) => finding.ruleId === "evidence.no-test-change")) {
    scenarios.set("focused-regression", { id: "focused-regression", label: "Focused regression coverage for the changed behavior", state: "missing" });
  }
  if (quick && planned.length > 0 && scenarios.size === 0) {
    scenarios.set("configured-checks", { id: "configured-checks", label: "Configured checks executed against this change", state: "missing" });
  }
  return [...scenarios.values()];
}

function decideOutcome(findings: Finding[], checks: CheckResult[], scenarios: EvidenceScenario[], stale: boolean, cancelled: boolean): Outcome {
  if (stale) return "stale";
  if (cancelled) return "cancelled";
  if (findings.some((finding) => finding.blocking) || checks.some((check) => check.blocking && check.state !== "passed")) return "blocked";
  if (checks.some((check) => check.state !== "passed") || scenarios.some((scenario) => ["missing", "failed"].includes(scenario.state)) || findings.some((finding) => finding.ruleId === "scope.outside-expected")) return "needs-evidence";
  return "ready";
}

export async function executeCheckWorkflow(options: CheckWorkflowOptions): Promise<PreflightRun> {
  const startedAt = new Date().toISOString();
  const root = await findRepositoryRoot(options.cwd);
  const loaded = await loadConfig(root);
  const storedTask = await loadTask(root);
  const scope = options.scope ?? (storedTask ? "task" : "branch");
  if (scope === "task" && !storedTask) throw new Error("No active task. Run `preflight start <intent>` or use --branch.");

  const collected = await collectChanges(root, scope, loaded.config, storedTask ?? undefined);
  const task = options.intent ? {
    intent: options.intent,
    startedAt,
    startHeadSha: collected.repository.mergeBaseSha,
    startBranch: collected.repository.branch,
    expectedPaths: options.expectedPaths ?? [],
    avoidedPaths: options.avoidedPaths ?? [],
  } : storedTask;
  classifyChanges(collected.manifest, loaded.config);
  const risk = assessRisk(collected.manifest, loaded.config);
  const findings = await analyze(root, collected.manifest, loaded.config, task ?? undefined);
  const planned = planChecks(root, collected.manifest, loaded.config);
  const policyHash = await executionPolicyHash(root, loaded.hash, planned);
  options.onPrepared?.({ manifest: collected.manifest, risk, checks: planned });

  if (!options.quick) await ensureTrusted(root, loaded.hash, policyHash, collected.repository.remoteHash, planned.map((check) => check.command), options.trustConfig, options.json);

  const controller = new AbortController();
  const onInterrupt = () => controller.abort();
  process.once("SIGINT", onInterrupt);
  let checks: CheckResult[] = [];
  try {
    if (!options.quick) {
      checks = await runChecks(planned, {
        concurrency: loaded.config.concurrency,
        signal: controller.signal,
        ...(options.onPlan ? { onState: options.onPlan } : {}),
      });
    }
  } finally {
    process.removeListener("SIGINT", onInterrupt);
  }

  const after = await collectChanges(root, scope, loaded.config, storedTask ?? undefined);
  const stale = after.manifest.fingerprint !== collected.manifest.fingerprint;
  const scenarios = scenarioModel(checks, findings, planned, options.quick);
  const outcome = decideOutcome(findings, checks, scenarios, stale, controller.signal.aborted);
  const id = createRunId();
  const reportDirectory = join(preflightDirectory(root), "runs", id);
  const { patch: _patch, ...safeChange } = collected.manifest;
  const run: PreflightRun = {
    schemaVersion: 1,
    id,
    startedAt,
    finishedAt: new Date().toISOString(),
    repository: {
      rootHash: sha256(collected.repository.root),
      branch: collected.repository.branch,
      headSha: collected.repository.headSha,
      ...(collected.repository.remoteHash ? { remoteHash: collected.repository.remoteHash } : {}),
      baseRef: collected.repository.baseRef,
      mergeBaseSha: collected.repository.mergeBaseSha,
      dirty: collected.repository.dirty,
    },
    ...(task ? { intent: task } : {}),
    change: safeChange,
    preRunFingerprint: collected.manifest.fingerprint,
    postRunFingerprint: after.manifest.fingerprint,
    configHash: loaded.hash,
    executionPolicyHash: policyHash,
    risk,
    findings,
    checks,
    scenarios,
    outcome,
    reportDirectory: relative(root, reportDirectory),
  };
  const absoluteReportDirectory = reportDirectory;
  await writeReports(run, absoluteReportDirectory);
  return run;
}

export function exitCodeFor(run: PreflightRun, strict: boolean): number {
  if (run.outcome === "ready") return 0;
  if (run.outcome === "needs-evidence") return strict ? 2 : 0;
  if (run.outcome === "cancelled") return 130;
  return 1;
}
