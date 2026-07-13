import type { TaskIntent } from "../core/types.js";
import { findRepositoryRoot, getGitContext, isDirty } from "../core/git.js";
import { saveTask } from "../core/storage.js";

export interface StartOptions {
  expect?: string[];
  avoid?: string[];
  issue?: string;
}

export async function startCommand(intent: string, options: StartOptions, cwd = process.cwd()): Promise<TaskIntent> {
  const root = await findRepositoryRoot(cwd);
  const context = await getGitContext(root);
  if (!context.headSha) throw new Error("Create an initial commit before starting a Preflight task.");
  if (await isDirty(root)) throw new Error("The working tree is not clean. Commit, stash, or discard existing changes before `preflight start` so the task baseline is unambiguous.");
  const task: TaskIntent = {
    intent: intent.trim(),
    startedAt: new Date().toISOString(),
    startHeadSha: context.headSha,
    startBranch: context.branch,
    expectedPaths: options.expect ?? [],
    avoidedPaths: options.avoid ?? [],
    ...(options.issue ? { issue: options.issue } : {}),
  };
  await saveTask(root, task);
  return task;
}
