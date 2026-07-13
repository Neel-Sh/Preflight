import { basename, join, relative, sep } from "node:path";
import { readFile, realpath } from "node:fs/promises";
import type { PlannedCheck } from "./types.js";
import { sha256 } from "./utils.js";

async function safeFileDigest(root: string, path: string, transform?: (content: string) => string): Promise<string | null> {
  try {
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(path)]);
    if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${sep}`)) return null;
    const content = await readFile(realFile, "utf8");
    return `${relative(realRoot, realFile)}:${sha256(transform ? transform(content) : content)}`;
  } catch {
    return null;
  }
}

function packageScripts(content: string): string {
  try {
    const parsed = JSON.parse(content) as { scripts?: unknown };
    return JSON.stringify(parsed.scripts ?? {});
  } catch {
    return content;
  }
}

export async function executionPolicyHash(root: string, configHash: string, checks: PlannedCheck[]): Promise<string> {
  const inputs = [configHash];
  for (const check of checks) {
    const command = basename(check.command[0] ?? "");
    if (["npm", "pnpm", "yarn", "bun"].includes(command)) {
      const digest = await safeFileDigest(root, join(check.cwd, "package.json"), packageScripts);
      if (digest) inputs.push(digest);
    }
    if (command === "make") {
      const digest = await safeFileDigest(root, join(check.cwd, "Makefile"));
      if (digest) inputs.push(digest);
    }
    if (command === "swift") {
      const digest = await safeFileDigest(root, join(check.cwd, "Package.swift"));
      if (digest) inputs.push(digest);
    }
    if (["node", "python", "python3", "ruby", "bash", "sh", "zsh", "deno", "bun"].includes(command)) {
      const candidate = check.command.slice(1).find((argument) => !argument.startsWith("-") && !argument.includes("="));
      if (candidate) {
        const digest = await safeFileDigest(root, join(check.cwd, candidate));
        if (digest) inputs.push(digest);
      }
    }
  }
  return sha256([...new Set(inputs)].sort().join("\n"));
}
