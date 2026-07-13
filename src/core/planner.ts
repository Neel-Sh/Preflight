import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { ChangeManifest, PlannedCheck, PreflightConfig } from "./types.js";
import { matchesAny } from "./classify.js";
import { parseDuration } from "./utils.js";

export function planChecks(root: string, manifest: ChangeManifest, config: PreflightConfig): PlannedCheck[] {
  const changedPaths = manifest.files.map((file) => file.path);
  const surfaces = new Set(manifest.files.flatMap((file) => file.surfaces));
  const plans: PlannedCheck[] = [];
  for (const check of config.checks) {
    const reasons: string[] = [];
    if (check.when?.changed) {
      const matched = changedPaths.filter((path) => matchesAny(path, check.when!.changed!));
      if (matched.length > 0) reasons.push(`changed: ${matched.slice(0, 3).join(", ")}${matched.length > 3 ? ` +${matched.length - 3}` : ""}`);
    }
    if (check.when?.surfaces) {
      const matched = check.when.surfaces.filter((surface) => surfaces.has(surface));
      if (matched.length > 0) reasons.push(`surface: ${matched.join(", ")}`);
    }
    const hasCondition = Boolean(check.when?.changed?.length || check.when?.surfaces?.length);
    if (hasCondition && reasons.length === 0) continue;
    if (!hasCondition) reasons.push("always configured");

    const cwd = realpathSync(resolve(root, check.cwd ?? "."));
    const realRoot = realpathSync(root);
    if (cwd !== realRoot && !cwd.startsWith(`${realRoot}${sep}`)) throw new Error(`Check '${check.id}' has a working directory outside the repository.`);
    plans.push({
      id: check.id,
      label: check.label,
      command: check.run,
      cwd,
      timeoutMs: parseDuration(check.timeout),
      blocking: check.blocking,
      reason: reasons,
      proves: check.proves,
    });
  }
  return plans;
}
