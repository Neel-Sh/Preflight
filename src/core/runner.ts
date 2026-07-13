import type { CheckResult, PlannedCheck } from "./types.js";
import { runProcess } from "./process.js";
import { redact } from "./redaction.js";
import { sha256 } from "./utils.js";

export interface RunChecksOptions {
  concurrency: number;
  signal?: AbortSignal;
  onState?: (check: PlannedCheck, state: "running" | "finished", result?: CheckResult) => void;
}

async function executeCheck(check: PlannedCheck, options: RunChecksOptions): Promise<CheckResult> {
  const started = new Date();
  options.onState?.(check, "running");
  try {
    const result = await runProcess(check.command[0]!, check.command.slice(1), {
      cwd: check.cwd,
      timeoutMs: check.timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
      maxOutputBytes: 2 * 1024 * 1024,
    });
    const outputTruncated = result.stdoutTruncated || result.stderrTruncated;
    const stdout = redact(`${result.stdout.toString("utf8")}${result.stdoutTruncated ? "\n[stdout truncated by Preflight]" : ""}`);
    const stderr = redact(`${result.stderr.toString("utf8")}${result.stderrTruncated ? "\n[stderr truncated by Preflight]" : ""}`);
    const finished = new Date();
    const state = result.timedOut ? "timed-out" : result.cancelled ? "cancelled" : result.exitCode === 0 ? "passed" : "failed";
    const checkResult: CheckResult = {
      ...check,
      state,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
      exitCode: result.exitCode,
      signal: result.signal,
      stdout,
      stderr,
      outputDigest: sha256(`${stdout}\n${stderr}`),
      outputTruncated,
    };
    options.onState?.(check, "finished", checkResult);
    return checkResult;
  } catch (error) {
    const finished = new Date();
    const stderr = redact(error instanceof Error ? error.message : String(error));
    const checkResult: CheckResult = {
      ...check,
      state: options.signal?.aborted ? "cancelled" : "failed",
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
      exitCode: null,
      signal: null,
      stdout: "",
      stderr,
      outputDigest: sha256(stderr),
    };
    options.onState?.(check, "finished", checkResult);
    return checkResult;
  }
}

export async function runChecks(checks: PlannedCheck[], options: RunChecksOptions): Promise<CheckResult[]> {
  const results = new Array<CheckResult>(checks.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < checks.length && !options.signal?.aborted) {
      const index = cursor++;
      const check = checks[index];
      if (!check) return;
      results[index] = await executeCheck(check, options);
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, checks.length) }, () => worker()));
  for (let index = 0; index < checks.length; index += 1) {
    if (!results[index]) {
      const check = checks[index]!;
      results[index] = { ...check, state: "cancelled", stdout: "", stderr: "", exitCode: null, signal: null };
    }
  }
  return results;
}
