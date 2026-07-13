import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TaskIntent } from "./types.js";
import { writeJsonAtomic } from "./utils.js";

export interface TrustRecord {
  schemaVersion: 1;
  repositoryRoot: string;
  remoteHash?: string;
  configHash: string;
  executionPolicyHash: string;
  trustedAt: string;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function preflightDirectory(root: string): string {
  return join(root, ".preflight");
}

export async function loadTask(root: string): Promise<TaskIntent | null> {
  return readJson<TaskIntent>(join(preflightDirectory(root), "current-task.json"));
}

export async function saveTask(root: string, task: TaskIntent): Promise<void> {
  await writeJsonAtomic(join(preflightDirectory(root), "current-task.json"), task);
}

export async function loadTrust(root: string): Promise<TrustRecord | null> {
  return readJson<TrustRecord>(join(preflightDirectory(root), "trust.json"));
}

export async function saveTrust(root: string, trust: TrustRecord): Promise<void> {
  await writeJsonAtomic(join(preflightDirectory(root), "trust.json"), trust);
}
