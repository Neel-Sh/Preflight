import { createHash, randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function shortHash(value: string, length = 10): string {
  return sha256(value).slice(0, length);
}

export function createRunId(date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextAtomic(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  await writeFile(temporary, value, { encoding: "utf8", flush: true });
  await rename(temporary, path);
}

export function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration '${value}'. Use values such as 500ms, 30s, 5m, or 1h.`);
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "ms" ? 1 : unit === "s" ? 1_000 : unit === "m" ? 60_000 : 3_600_000;
  return amount * multiplier;
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1_000);
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

export function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
