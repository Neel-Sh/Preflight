import { existsSync } from "node:fs";
import { access, appendFile, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CheckConfig, PreflightConfig } from "../core/types.js";
import { findRepositoryRoot } from "../core/git.js";
import { runProcess } from "../core/process.js";
import { serializeConfig } from "../core/config.js";
import { writeTextAtomic } from "../core/utils.js";

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

function packageManager(root: string): string {
  if (requireExists(root, "pnpm-lock.yaml")) return "pnpm";
  if (requireExists(root, "yarn.lock")) return "yarn";
  if (requireExists(root, "bun.lock") || requireExists(root, "bun.lockb")) return "bun";
  return "npm";
}

function requireExists(root: string, name: string): boolean {
  return existsSync(join(root, name));
}

async function javascriptChecks(root: string): Promise<CheckConfig[]> {
  const packagePath = join(root, "package.json");
  if (!await exists(packagePath)) return [];
  const pkg = JSON.parse(await readFile(packagePath, "utf8")) as { scripts?: Record<string, string> };
  const manager = packageManager(root);
  const checks: CheckConfig[] = [];
  const definitions: Array<[string, string, string, boolean]> = [
    ["typecheck", "Type check", "2m", true],
    ["lint", "Lint", "2m", true],
    ["test", "Tests", "5m", true],
    ["build", "Build", "10m", true],
  ];
  for (const [script, label, timeout, blocking] of definitions) {
    if (!pkg.scripts?.[script]) continue;
    checks.push({
      id: script,
      label,
      when: { changed: ["**/*.{js,jsx,mjs,cjs,ts,tsx,json}", "package.json", "*lock*"] },
      run: [manager, "run", script],
      timeout,
      blocking,
      proves: [],
    });
  }
  return checks;
}

async function swiftChecks(root: string): Promise<CheckConfig[]> {
  if (await exists(join(root, "Package.swift"))) {
    return [{ id: "swift-test", label: "Swift tests", when: { changed: ["**/*.swift", "Package.swift", "Package.resolved"] }, run: ["swift", "test"], timeout: "10m", blocking: true, proves: [] }];
  }
  const entries = await readdir(root, { withFileTypes: true });
  const workspace = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".xcworkspace"));
  const project = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".xcodeproj"));
  const container = workspace ?? project;
  if (!container) return [];
  const kind = container.name.endsWith(".xcworkspace") ? "-workspace" : "-project";
  const listed = await runProcess("xcodebuild", [kind, container.name, "-list", "-json"], { cwd: root, timeoutMs: 30_000 });
  if (listed.exitCode !== 0) return [];
  let schemes: string[] = [];
  try {
    const parsed = JSON.parse(listed.stdout.toString("utf8")) as { project?: { schemes?: string[] }; workspace?: { schemes?: string[] } };
    schemes = parsed.project?.schemes ?? parsed.workspace?.schemes ?? [];
  } catch { return []; }
  const preferred = schemes.find((scheme) => scheme === basename(container.name, kind === "-project" ? ".xcodeproj" : ".xcworkspace")) ?? schemes[0];
  if (!preferred) return [];
  const projectText = project ? await readFile(join(root, project.name, "project.pbxproj"), "utf8").catch(() => "") : "";
  const destination = /iphoneos|iphonesimulator|TARGETED_DEVICE_FAMILY/.test(projectText) ? "generic/platform=iOS Simulator" : "platform=macOS";
  return [{
    id: "xcode-build",
    label: `${preferred} build`,
    when: { changed: ["**/*.swift", "**/*.{plist,entitlements,xcprivacy}", "**/*.pbxproj", "Package.resolved"] },
    run: ["xcodebuild", kind, container.name, "-scheme", preferred, "-configuration", "Debug", "-destination", destination, "CODE_SIGNING_ALLOWED=NO", "build"],
    timeout: "15m",
    blocking: true,
    proves: [],
  }];
}

async function ensureIgnored(root: string): Promise<void> {
  const path = join(root, ".gitignore");
  const content = await readFile(path, "utf8").catch(() => "");
  const lines = content.split(/\r?\n/);
  if (lines.includes(".preflight/")) return;
  const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  await appendFile(path, `${prefix}.preflight/\n`, "utf8");
}

export async function initCommand(cwd = process.cwd()): Promise<{ root: string; config: PreflightConfig; detected: string[] }> {
  const root = await findRepositoryRoot(cwd);
  const configPath = join(root, ".preflight.yml");
  if (await exists(configPath) || await exists(join(root, ".preflight.yaml"))) throw new Error("A Preflight configuration already exists in this repository.");
  const jsChecks = await javascriptChecks(root);
  const swift = await swiftChecks(root);
  const firebase = await exists(join(root, "firebase.json"));
  const config: PreflightConfig = {
    version: 1,
    includeUntracked: true,
    concurrency: 2,
    criticalPaths: firebase ? ["firestore.rules", "firestore.indexes.json", ".firebaserc", "firebase.json"] : [],
    surfaces: [],
    checks: [...jsChecks, ...swift],
    contracts: [],
  };
  await writeTextAtomic(configPath, serializeConfig(config));
  await ensureIgnored(root);
  const detected = [
    ...(jsChecks.length ? ["JavaScript/TypeScript"] : []),
    ...(swift.length ? ["Swift/Xcode"] : []),
    ...(firebase ? ["Firebase"] : []),
  ];
  return { root, config, detected };
}
