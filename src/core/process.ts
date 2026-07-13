import { spawn } from "node:child_process";

export interface ProcessResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface ProcessOptions {
  cwd: string;
  input?: string | Buffer;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
}

export function runProcess(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 0;
    const maxOutput = options.maxOutputBytes ?? 4 * 1024 * 1024;
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
      signal: controller.signal,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });

    const abort = (reason: "timeout" | "cancel") => {
      if (settled || controller.signal.aborted) return;
      timedOut = reason === "timeout";
      cancelled = reason === "cancel";
      controller.abort();
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 1_500).unref();
    };

    const timer = timeoutMs > 0 ? setTimeout(() => abort("timeout"), timeoutMs) : undefined;
    timer?.unref();

    const externalAbort = () => abort("cancel");
    options.signal?.addEventListener("abort", externalAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBytes >= maxOutput) { stdoutTruncated = true; return; }
      const remaining = maxOutput - stdoutBytes;
      const kept = chunk.subarray(0, remaining);
      if (kept.length < chunk.length) stdoutTruncated = true;
      stdout.push(kept);
      stdoutBytes += kept.length;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes >= maxOutput) { stderrTruncated = true; return; }
      const remaining = maxOutput - stderrBytes;
      const kept = chunk.subarray(0, remaining);
      if (kept.length < chunk.length) stderrTruncated = true;
      stderr.push(kept);
      stderrBytes += kept.length;
    });

    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }

    child.on("error", (error) => {
      if (controller.signal.aborted) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", externalAbort);
      reject(error);
    });

    child.on("close", (exitCode, signal) => {
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", externalAbort);
      resolve({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        exitCode,
        signal,
        timedOut,
        cancelled,
        stdoutTruncated,
        stderrTruncated,
      });
    });
  });
}

export async function runText(command: string, args: string[], options: ProcessOptions): Promise<string> {
  const result = await runProcess(command, args, options);
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString("utf8").trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ` with exit code ${result.exitCode}`}`);
  }
  return result.stdout.toString("utf8");
}
