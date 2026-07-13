import { Command, Option } from "commander";
import pc from "picocolors";
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";
import { executeCheckWorkflow, exitCodeFor } from "./core/run.js";
import type { ScopeMode } from "./core/types.js";
import { banner, renderCheckCompletion, renderPlan, renderRun } from "./core/terminal.js";
import { errorMessage } from "./core/utils.js";

const program = new Command();
program
  .name("preflight")
  .description("A local evidence gate for human- and agent-written code.")
  .version("0.1.0")
  .showHelpAfterError();

program.command("init")
  .description("Detect repository tooling and create .preflight.yml")
  .action(async () => {
    const result = await initCommand();
    console.log(banner());
    console.log("");
    console.log(`${pc.green("✓")} Created .preflight.yml`);
    console.log(`${pc.green("✓")} Added .preflight/ to .gitignore`);
    console.log(`${pc.cyan("◆")} Detected ${result.detected.length ? result.detected.join(" · ") : "a generic Git repository"}`);
    console.log("");
    console.log(pc.dim("Review the generated commands. The first check will ask you to trust them."));
  });

program.command("start")
  .description("Record a clean task baseline and its intent")
  .argument("<intent>", "plain-language description of the intended change")
  .option("--expect <glob...>", "paths expected to change")
  .option("--avoid <glob...>", "paths that must not change")
  .option("--issue <reference>", "issue or task reference")
  .action(async (intent: string, options: { expect?: string[]; avoid?: string[]; issue?: string }) => {
    const task = await startCommand(intent, options);
    console.log(banner());
    console.log("");
    console.log(`${pc.green("✓")} Task baseline recorded at ${pc.dim(task.startHeadSha.slice(0, 10))}`);
    console.log(`  ${task.intent}`);
    if (task.expectedPaths.length) console.log(`  ${pc.dim(`Expected: ${task.expectedPaths.join(", ")}`)}`);
    if (task.avoidedPaths.length) console.log(`  ${pc.dim(`Avoid: ${task.avoidedPaths.join(", ")}`)}`);
  });

program.command("check")
  .description("Inspect the change, run relevant checks, and produce an evidence receipt")
  .addOption(new Option("--scope <scope>", "change scope").choices(["staged", "worktree", "branch", "task"]))
  .option("--staged", "inspect only staged changes")
  .option("--worktree", "inspect unstaged and untracked changes")
  .option("--branch", "inspect changes since the base branch")
  .option("--task", "inspect changes since preflight start")
  .option("--quick", "inspect without running configured commands", false)
  .option("--intent <text>", "analyze against a one-off intent without starting a task")
  .option("--expect <glob...>", "expected paths for a one-off intent")
  .option("--avoid <glob...>", "avoided paths for a one-off intent")
  .option("--trust-config", "trust the current repository configuration", false)
  .option("--json", "print the machine-readable run result", false)
  .option("--plain", "disable color and decorative terminal output", false)
  .option("--strict", "exit 2 when evidence is still missing", false)
  .action(async (options: { scope?: ScopeMode; staged?: boolean; worktree?: boolean; branch?: boolean; task?: boolean; quick: boolean; intent?: string; expect?: string[]; avoid?: string[]; trustConfig: boolean; json: boolean; plain: boolean; strict: boolean }) => {
    const flags = [[options.staged, "staged"], [options.worktree, "worktree"], [options.branch, "branch"], [options.task, "task"]].filter(([enabled]) => enabled) as Array<[boolean, ScopeMode]>;
    if (flags.length > 1 || (options.scope && flags.length)) throw new Error("Choose only one scope: --staged, --worktree, --branch, --task, or --scope.");
    if (!options.intent && (options.expect?.length || options.avoid?.length)) throw new Error("--expect and --avoid require --intent when used with `preflight check`.");
    const scope = options.scope ?? flags[0]?.[1];
    const workflowOptions = {
      cwd: process.cwd(),
      ...(scope ? { scope } : {}),
      quick: options.quick,
      trustConfig: options.trustConfig,
      json: options.json,
      ...(options.intent ? { intent: options.intent, expectedPaths: options.expect ?? [], avoidedPaths: options.avoid ?? [] } : {}),
      ...(!options.json ? {
        onPrepared: ({ manifest, risk, checks }: Parameters<NonNullable<Parameters<typeof executeCheckWorkflow>[0]["onPrepared"]>>[0]) => {
          console.log(renderPlan(manifest, risk, checks, { plain: options.plain }));
          if (!options.quick && checks.length) console.log("\nRunning checks");
        },
        onPlan: (_check: Parameters<NonNullable<Parameters<typeof executeCheckWorkflow>[0]["onPlan"]>>[0], state: "running" | "finished", result?: Parameters<NonNullable<Parameters<typeof executeCheckWorkflow>[0]["onPlan"]>>[2]) => {
          if (state === "finished" && result) console.log(renderCheckCompletion(result, { plain: options.plain }));
        },
      } : {}),
    } satisfies Parameters<typeof executeCheckWorkflow>[0];
    const run = await executeCheckWorkflow(workflowOptions);
    if (options.json) console.log(JSON.stringify(run, null, 2));
    else console.log(renderRun(run, { plain: options.plain }));
    process.exitCode = exitCodeFor(run, options.strict);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`${pc.red("×")} ${errorMessage(error)}`);
  process.exitCode = 4;
});
