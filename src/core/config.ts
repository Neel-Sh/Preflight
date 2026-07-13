import { cpus } from "node:os";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import type { PreflightConfig } from "./types.js";
import { sha256 } from "./utils.js";

const whenSchema = z.object({
  changed: z.array(z.string().min(1)).optional(),
  surfaces: z.array(z.string().min(1)).optional(),
}).strict();

const configSchema = z.object({
  version: z.literal(1),
  baseBranch: z.string().min(1).optional(),
  includeUntracked: z.boolean().default(true),
  concurrency: z.number().int().min(1).max(16).default(Math.max(1, Math.min(4, Math.floor(cpus().length / 2)))),
  criticalPaths: z.array(z.string().min(1)).default([]),
  surfaces: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    paths: z.array(z.string().min(1)).min(1),
    risk: z.number().int().min(0).max(100).default(0),
  }).strict()).default([]),
  checks: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    label: z.string().min(1),
    when: whenSchema.optional(),
    run: z.array(z.string()).min(1),
    cwd: z.string().min(1).optional(),
    timeout: z.string().regex(/^\d+(?:\.\d+)?(?:ms|s|m|h)$/).default("5m"),
    blocking: z.boolean().default(true),
    proves: z.array(z.string().min(1)).default([]),
  }).strict()).default([]),
  contracts: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    label: z.string().min(1),
    when: z.object({ changed: z.array(z.string().min(1)).min(1) }).strict(),
    requireChanged: z.array(z.string().min(1)).optional(),
    forbidChanged: z.array(z.string().min(1)).optional(),
    requireText: z.object({ path: z.string().min(1), values: z.array(z.string()).min(1) }).strict().optional(),
    blocking: z.boolean().default(true),
  }).strict()).default([]),
}).strict();

export interface LoadedConfig {
  config: PreflightConfig;
  path: string | null;
  hash: string;
  raw: string;
}

const DEFAULT_CONFIG: PreflightConfig = {
  version: 1,
  includeUntracked: true,
  concurrency: 2,
  criticalPaths: [],
  surfaces: [],
  checks: [],
  contracts: [],
};

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Try the next supported filename.
    }
  }
  return null;
}

export async function loadConfig(root: string): Promise<LoadedConfig> {
  const path = await firstExisting([join(root, ".preflight.yml"), join(root, ".preflight.yaml")]);
  if (!path) {
    const raw = stringifyYaml(DEFAULT_CONFIG);
    return { config: DEFAULT_CONFIG, path: null, raw, hash: sha256(raw) };
  }

  const raw = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new Error(`Could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  ${issue.path.join(".") || "config"}: ${issue.message}`).join("\n");
    throw new Error(`Invalid Preflight configuration:\n${issues}`);
  }
  return { config: result.data as PreflightConfig, path, raw, hash: sha256(raw) };
}

export function serializeConfig(config: PreflightConfig): string {
  return stringifyYaml(config, { lineWidth: 110 });
}
