import pc from "picocolors";
import type { ChangeManifest, CheckResult, Finding, Outcome, PlannedCheck, PreflightRun, RiskAssessment } from "./types.js";
import { formatDuration, plural, truncate } from "./utils.js";

export interface TerminalOptions {
  plain?: boolean;
}

function painter(plain = false) {
  const paint = <T extends string>(fn: (value: string) => string, value: T): string => plain ? value : fn(value);
  return {
    bold: (value: string) => paint(pc.bold, value),
    dim: (value: string) => paint(pc.dim, value),
    cyan: (value: string) => paint(pc.cyan, value),
    green: (value: string) => paint(pc.green, value),
    yellow: (value: string) => paint(pc.yellow, value),
    red: (value: string) => paint(pc.red, value),
    magenta: (value: string) => paint(pc.magenta, value),
  };
}

export function banner(options: TerminalOptions = {}): string {
  const c = painter(options.plain);
  return `${c.cyan("◆")} ${c.bold("PREFLIGHT")} ${c.dim("local evidence gate")}`;
}

export function renderPlan(manifest: ChangeManifest, risk: RiskAssessment, checks: PlannedCheck[], options: TerminalOptions = {}): string {
  const c = painter(options.plain);
  const surfaces = [...new Set(manifest.files.flatMap((file) => file.surfaces))].filter((surface) => !["tests", "documentation"].includes(surface));
  const lines = [
    banner(options),
    "",
    `${c.bold("Scope")}  ${plural(manifest.files.length, "file")}  ${c.green(`+${manifest.added}`)} ${c.red(`−${manifest.removed}`)}  ${c.dim(manifest.scope)}`,
    `${c.bold("Risk")}   ${riskLabel(risk, options)}${surfaces.length ? `  ${c.dim(surfaces.join(" · "))}` : ""}`,
  ];
  if (checks.length > 0) {
    lines.push("", c.bold("Selected checks"));
    for (const check of checks) {
      lines.push(`  ${c.cyan("○")} ${check.label}  ${c.dim(`≤ ${formatDuration(check.timeoutMs)}`)}`);
      lines.push(`    ${c.dim(check.reason.join(" · "))}`);
    }
  } else {
    lines.push("", `${c.dim("No configured commands match this change.")}`);
  }
  return lines.join("\n");
}

export function renderCheckCompletion(result: CheckResult, options: TerminalOptions = {}): string {
  const c = painter(options.plain);
  const symbol = result.state === "passed" ? c.green("✓") : result.state === "cancelled" ? c.yellow("!") : c.red("×");
  const state = result.state === "passed" ? c.green("passed") : result.state === "timed-out" ? c.red("timed out") : result.state === "cancelled" ? c.yellow("cancelled") : c.red("failed");
  return `  ${symbol} ${result.label}  ${state}${result.durationMs === undefined ? "" : `  ${c.dim(formatDuration(result.durationMs))}`}`;
}

function outcomeStyle(outcome: Outcome, options: TerminalOptions): { symbol: string; label: string } {
  const c = painter(options.plain);
  if (outcome === "ready") return { symbol: c.green("✓"), label: c.green(c.bold("READY")) };
  if (outcome === "blocked") return { symbol: c.red("×"), label: c.red(c.bold("BLOCKED")) };
  if (outcome === "stale") return { symbol: c.magenta("↻"), label: c.magenta(c.bold("STALE")) };
  if (outcome === "cancelled") return { symbol: c.yellow("!"), label: c.yellow(c.bold("CANCELLED")) };
  return { symbol: c.yellow("!"), label: c.yellow(c.bold("NEEDS EVIDENCE")) };
}

function riskLabel(risk: RiskAssessment, options: TerminalOptions): string {
  const c = painter(options.plain);
  const value = `${risk.score} · ${risk.level[0]!.toUpperCase()}${risk.level.slice(1)}`;
  if (risk.level === "critical") return c.red(value);
  if (risk.level === "high" || risk.level === "moderate") return c.yellow(value);
  return c.green(value);
}

function findingLine(finding: Finding, options: TerminalOptions): string {
  const c = painter(options.plain);
  const symbol = finding.blocking ? c.red("×") : c.yellow("!");
  const location = finding.location ? c.dim(`  ${finding.location.path}${finding.location.line ? `:${finding.location.line}` : ""}`) : "";
  return `  ${symbol} ${finding.title}${location}\n    ${c.dim(truncate(finding.detail, 110))}`;
}

export function renderRun(run: PreflightRun, options: TerminalOptions = {}): string {
  const c = painter(options.plain);
  const state = outcomeStyle(run.outcome, options);
  const lines = [
    "",
    `${state.symbol} ${state.label}  ${c.dim(run.repository.branch)}  ${riskLabel(run.risk, options)}`,
    "",
  ];
  if (run.intent) lines.push(c.bold("Intent"), `  ${run.intent.intent}`, "");
  lines.push(c.bold("Scope"), `  ${plural(run.change.files.length, "file")}  ${c.green(`+${run.change.added}`)} ${c.red(`−${run.change.removed}`)}  ${c.dim(run.change.scope)}`);
  const surfaces = [...new Set(run.change.files.flatMap((file) => file.surfaces))];
  if (surfaces.length) lines.push(`  ${c.dim(surfaces.join(" · "))}`);

  const blockers = run.findings.filter((finding) => finding.blocking);
  const warnings = run.findings.filter((finding) => !finding.blocking);
  if (blockers.length) lines.push("", c.bold("Blockers"), ...blockers.map((item) => findingLine(item, options)));
  if (warnings.length) lines.push("", c.bold("Warnings"), ...warnings.map((item) => findingLine(item, options)));

  const passed = run.checks.filter((check) => check.state === "passed");
  if (passed.length) lines.push("", c.bold("Verified execution"), ...passed.map((check) => `  ${c.green("✓")} ${check.label}  ${c.dim(check.durationMs === undefined ? "" : formatDuration(check.durationMs))}`));
  const failed = run.checks.filter((check) => check.state !== "passed");
  if (failed.length) lines.push("", c.bold("Check failures"), ...failed.map((check) => `  ${c.red("×")} ${check.label}  ${c.dim(check.state)}`));

  const demonstrated = run.scenarios.filter((scenario) => scenario.state === "verified");
  const missing = run.scenarios.filter((scenario) => scenario.state === "missing" || scenario.state === "failed");
  if (demonstrated.length) lines.push("", c.bold("Demonstrated"), ...demonstrated.map((scenario) => `  ${c.green("✓")} ${scenario.label}`));
  if (missing.length) lines.push("", c.bold("Not demonstrated"), ...missing.map((scenario) => `  ${c.yellow("○")} ${scenario.label}`));

  if (run.outcome === "stale") {
    lines.push("", c.magenta("The workspace changed while checks were running. This receipt does not describe the current code."), `  ${c.bold("Run again:")} preflight check --${run.change.scope}`);
  } else {
    const next = nextAction(run);
    if (next) lines.push("", c.bold("Next best action"), `  ${next}`);
  }
  lines.push("", c.bold("Receipt"), `  ${c.dim(run.change.fingerprint.slice(0, 12))}  ${run.reportDirectory}/report.html`);
  return lines.join("\n");
}

function nextAction(run: PreflightRun): string | null {
  if (run.outcome === "ready") return "git push";
  const blocker = run.findings.find((finding) => finding.blocking && finding.remediation);
  if (blocker?.remediation) return blocker.remediation.command?.join(" ") ?? blocker.remediation.summary;
  const failed = run.checks.find((check) => check.state !== "passed");
  if (failed) return failed.command.join(" ");
  const warning = run.findings.find((finding) => finding.remediation);
  if (warning?.remediation) return warning.remediation.command?.join(" ") ?? warning.remediation.summary;
  return null;
}
