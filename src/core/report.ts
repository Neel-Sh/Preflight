import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CheckResult, PreflightRun } from "./types.js";
import { redact } from "./redaction.js";
import { formatDuration, writeJsonAtomic, writeTextAtomic } from "./utils.js";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function statusClass(value: string): string {
  return ["ready", "passed", "verified"].includes(value) ? "good" : ["blocked", "failed", "timed-out"].includes(value) ? "bad" : "warn";
}

function checkHtml(check: CheckResult): string {
  const output = [check.stdout, check.stderr].filter(Boolean).join("\n").trim();
  return `<article class="check">
    <div class="check-head"><span class="dot ${statusClass(check.state)}"></span><strong>${escapeHtml(check.label)}</strong><span class="pill">${escapeHtml(check.state)}</span><span class="muted">${check.durationMs === undefined ? "" : formatDuration(check.durationMs)}</span></div>
    <code>${escapeHtml(check.command.join(" "))}</code>
    ${output ? `<details><summary>Command output</summary><pre>${escapeHtml(output)}</pre></details>` : ""}
  </article>`;
}

export function renderHtml(run: PreflightRun): string {
  const surfaces = [...new Set(run.change.files.flatMap((file) => file.surfaces))];
  const findings = run.findings.map((finding) => `<article class="finding ${finding.blocking ? "blocking" : ""}">
    <div><span class="dot ${finding.blocking ? "bad" : "warn"}"></span><strong>${escapeHtml(finding.title)}</strong>${finding.location ? `<code>${escapeHtml(finding.location.path)}${finding.location.line ? `:${finding.location.line}` : ""}</code>` : ""}</div>
    <p>${escapeHtml(finding.detail)}</p>
    <small>${escapeHtml(finding.confidence)} · ${escapeHtml(finding.ruleId)}</small>
  </article>`).join("");
  const risk = run.risk.signals.map((signal) => `<li><span>+${signal.weight}</span><strong>${escapeHtml(signal.label)}</strong><small>${escapeHtml(signal.evidence.slice(0, 3).join(", "))}</small></li>`).join("");
  const files = run.change.files.map((file) => `<tr><td><span class="file-status">${escapeHtml(file.status[0]!.toUpperCase())}</span></td><td><code>${escapeHtml(file.path)}</code></td><td class="add">+${file.added ?? "–"}</td><td class="remove">−${file.removed ?? "–"}</td><td>${file.surfaces.map((surface) => `<span class="tag">${escapeHtml(surface)}</span>`).join(" ")}</td></tr>`).join("");
  const scenarios = run.scenarios.map((scenario) => `<li><span class="dot ${statusClass(scenario.state)}"></span><strong>${escapeHtml(scenario.label)}</strong><small>${escapeHtml(scenario.state)}</small></li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preflight · ${escapeHtml(run.outcome)}</title>
<style>
:root{color-scheme:dark;--bg:#101311;--panel:#171b18;--panel2:#1d221f;--line:#2b322d;--text:#f1f4f2;--muted:#96a099;--green:#6ee7a0;--amber:#f5c76b;--red:#ff7b72;--cyan:#68d5df}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% -10%,#1d2b24 0,transparent 35%),var(--bg);color:var(--text);font:14px/1.55 Inter,ui-sans-serif,system-ui,sans-serif}main{width:min(1120px,calc(100% - 32px));margin:48px auto 80px}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:34px}.brand{font-weight:800;letter-spacing:.14em}.brand b{color:var(--cyan);margin-right:8px}.receipt{font:12px ui-monospace,monospace;color:var(--muted)}.hero{display:grid;grid-template-columns:1fr auto;gap:32px;align-items:end;padding:30px;border:1px solid var(--line);background:linear-gradient(135deg,var(--panel),#131715);border-radius:16px}.eyebrow{text-transform:uppercase;letter-spacing:.15em;color:var(--muted);font-size:11px}.outcome{font-size:40px;line-height:1;margin:10px 0 14px;text-transform:uppercase}.outcome.good{color:var(--green)}.outcome.bad{color:var(--red)}.outcome.warn{color:var(--amber)}.intent{font-size:17px;color:#cbd2cd;margin:0}.risk-score{text-align:right}.risk-score strong{display:block;font-size:46px}.risk-score span{color:var(--muted);text-transform:capitalize}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:14px 0 30px}.stat{padding:18px;background:var(--panel);border:1px solid var(--line);border-radius:12px}.stat strong{display:block;font-size:22px}.stat span{color:var(--muted);font-size:12px}.grid{display:grid;grid-template-columns:1.25fr .75fr;gap:18px}.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px;margin-bottom:18px}.card h2{margin:0 0 18px;font-size:15px;letter-spacing:.04em}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--muted);margin-right:10px}.dot.good{background:var(--green);box-shadow:0 0 12px #6ee7a055}.dot.warn{background:var(--amber)}.dot.bad{background:var(--red)}.finding{padding:14px 0;border-top:1px solid var(--line)}.finding:first-of-type{border-top:0}.finding code{margin-left:10px;color:var(--muted)}.finding p{margin:7px 0 2px;color:#c9d0cb}.finding small,.muted,small{color:var(--muted)}.check{padding:14px 0;border-top:1px solid var(--line)}.check:first-of-type{border-top:0}.check-head{display:flex;align-items:center;gap:8px}.check-head .dot{margin-right:2px}.pill,.tag{padding:2px 7px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:11px}.check>code{display:block;color:var(--cyan);margin:7px 0 0 19px}details{margin:10px 0 0 19px}pre{overflow:auto;max-height:320px;padding:14px;background:#0b0e0c;border-radius:8px;color:#cbd2cd}ul{list-style:none;padding:0;margin:0}.risk-list li,.scenario-list li{display:grid;grid-template-columns:38px 1fr;gap:2px 10px;padding:10px 0;border-top:1px solid var(--line)}.risk-list li:first-child,.scenario-list li:first-child{border:0}.risk-list li span{color:var(--amber);font-family:ui-monospace,monospace}.risk-list li small{grid-column:2}.scenario-list li{grid-template-columns:18px 1fr auto}.scenario-list .dot{margin-top:6px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-top:1px solid var(--line)}th{color:var(--muted);font-size:11px;text-transform:uppercase}.file-status{font-family:ui-monospace,monospace;color:var(--cyan)}.add{color:var(--green)}.remove{color:var(--red)}.footer{margin-top:30px;color:var(--muted);font-size:12px}@media(max-width:760px){.hero,.grid{grid-template-columns:1fr}.risk-score{text-align:left}.stats{grid-template-columns:repeat(2,1fr)}.outcome{font-size:31px}.card{overflow:auto}}
</style></head><body><main>
<div class="top"><div class="brand"><b>◆</b>PREFLIGHT</div><div class="receipt">${escapeHtml(run.id)}</div></div>
<section class="hero"><div><div class="eyebrow">${escapeHtml(run.repository.branch)} · ${escapeHtml(run.change.scope)}</div><h1 class="outcome ${statusClass(run.outcome)}">${escapeHtml(run.outcome.replace("-", " "))}</h1><p class="intent">${escapeHtml(run.intent?.intent ?? "Repository change evidence")}</p></div><div class="risk-score"><strong>${run.risk.score}</strong><span>${escapeHtml(run.risk.level)} risk</span></div></section>
<section class="stats"><div class="stat"><strong>${run.change.files.length}</strong><span>files changed</span></div><div class="stat"><strong class="add">+${run.change.added}</strong><span>lines added</span></div><div class="stat"><strong class="remove">−${run.change.removed}</strong><span>lines removed</span></div><div class="stat"><strong>${run.checks.filter((check) => check.state === "passed").length}/${run.checks.length}</strong><span>checks passed</span></div></section>
<div class="grid"><div><section class="card"><h2>Findings</h2>${findings || '<p class="muted">No findings.</p>'}</section><section class="card"><h2>Executed checks</h2>${run.checks.map(checkHtml).join("") || '<p class="muted">No commands executed.</p>'}</section></div>
<aside><section class="card"><h2>Affected surfaces</h2><p>${surfaces.map((surface) => `<span class="tag">${escapeHtml(surface)}</span>`).join(" ") || '<span class="muted">None classified</span>'}</p></section><section class="card"><h2>Evidence scenarios</h2><ul class="scenario-list">${scenarios || '<li class="muted">No scenarios configured.</li>'}</ul></section><section class="card"><h2>Risk calculation</h2><ul class="risk-list">${risk || '<li class="muted">No risk signals.</li>'}</ul></section></aside></div>
<section class="card"><h2>Changed files</h2><table><thead><tr><th></th><th>Path</th><th>Added</th><th>Removed</th><th>Surfaces</th></tr></thead><tbody>${files}</tbody></table></section>
<div class="footer">Workspace ${escapeHtml(run.change.fingerprint.slice(0, 16))} · Policy ${escapeHtml(run.executionPolicyHash.slice(0, 16))} · ${escapeHtml(run.finishedAt)} · Source and command output remained local.</div>
</main></body></html>`;
}

export async function writeReports(run: PreflightRun, outputDirectory = run.reportDirectory): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  await writeJsonAtomic(join(outputDirectory, "run.json"), run);
  await writeTextAtomic(join(outputDirectory, "report.html"), renderHtml(run));
  const logs = join(outputDirectory, "logs");
  await mkdir(logs, { recursive: true });
  for (const check of run.checks) {
    const content = redact([check.stdout, check.stderr].filter(Boolean).join("\n"));
    await writeFile(join(logs, `${check.id}.log`), content, "utf8");
  }
}
