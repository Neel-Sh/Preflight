# Preflight MVP

> A local evidence gate for human- and agent-written code. Know what changed, what could break, and what has actually been proven before you push.

## 1. Product summary

Preflight is a local-first developer tool that runs before a commit, push, or pull request. It reads the developer's stated intent, inspects the Git diff, estimates the change's blast radius, chooses the checks that matter, runs them, and produces an evidence-backed report.

The product should answer five questions quickly:

1. What changed?
2. Does the implementation match the stated intent?
3. What product or system surfaces could this affect?
4. What has actually been verified?
5. What remains unproven before this is safe to ship?

Preflight is not another generic linter or AI reviewer. Linters find language-level problems. CI runs a fixed set of jobs after code is pushed. AI reviewers often produce broad, low-confidence advice. Preflight should sit earlier in the workflow and combine deterministic inspection, repository-specific policy, targeted execution, and clearly labelled optional inference.

The core promise is:

> Do not tell me the change works. Show me the evidence and the gaps.

## 2. Why this is useful now

Coding agents can produce large, plausible changes quickly, but developers still need to answer whether an agent changed unrelated code, skipped an important scenario, weakened a test, used the wrong environment, or claimed to run checks it did not run.

Existing GitHub protections are useful but mostly operate at pull-request or merge time: required status checks, dependency review, code scanning, code quality, coverage thresholds, and rulesets. Preflight complements those systems by providing fast local feedback before the developer spends time waiting for CI.

The initial audience is an individual developer who:

- Uses coding agents regularly.
- Switches between several repositories and stacks.
- Wants fast confidence without running every test every time.
- Cares about secrets, production environments, migrations, permissions, authentication, payments, and other high-risk surfaces.
- Wants a report that distinguishes verified facts from suggestions.

## 3. Product principles

### 3.1 Evidence before opinion

Every finding must point to evidence: a changed path, diff hunk, command output, dependency change, rule, or explicit inference. Avoid comments such as "this may be problematic" without explaining why.

### 3.2 Deterministic blockers

AI may summarize changes, compare intent with implementation, or suggest missing scenarios. It must not be the sole reason a run is blocked. Blocking findings should come from deterministic rules such as:

- A configured command failed.
- A forbidden file changed.
- A required file or string is missing.
- A secret pattern was detected.
- A migration lacks a required companion artifact.
- A protected dependency or permission changed.

### 3.3 Missing evidence is not the same as failure

Preflight should use three top-level outcomes:

- **Ready:** required evidence exists and no blockers were found.
- **Needs evidence:** nothing is known to be broken, but important scenarios remain unverified.
- **Blocked:** a deterministic policy or required check failed.

### 3.4 Local-first and private by default

The MVP should work without an account, backend, telemetry, or API key. Source code and command output stay on the developer's machine. AI features must be optional, clearly disclosed, and provider-agnostic.

### 3.5 Fast enough to run repeatedly

Repository inspection should finish in under one second for a normal project before external commands begin. Checks should be selected by the diff, run concurrently where safe, cache results, and show an estimate before expensive work starts.

### 3.6 Explain the score

If Preflight shows a risk score, the complete calculation must be visible. The score is a prioritization aid, not a magical judgment.

## 4. Core workflow

### 4.1 Record intent

At the beginning of a task:

```bash
preflight start "Fix mailbox reconnection without changing sign-in"
```

This stores a small task record locally:

- Intent text.
- Starting commit.
- Starting branch.
- Timestamp.
- Optional expected and forbidden scopes.

Useful options:

```bash
preflight start "Add export to CSV" \
  --expect "src/export/**" \
  --avoid "src/auth/**" \
  --issue "#421"
```

The developer can also skip `start` and provide intent during the check:

```bash
preflight check --intent "Fix mailbox reconnection"
```

### 4.2 Run Preflight

```bash
preflight check
```

Preflight should:

1. Identify the repository root, current branch, base branch, merge base, and working-tree state.
2. Collect staged, unstaged, committed, renamed, deleted, and untracked changes in scope.
3. Classify the changed paths and diff hunks.
4. Compare the change with the stated intent.
5. Estimate affected surfaces and risk.
6. Build a targeted check plan.
7. Ask for confirmation if the repository configuration has not been trusted.
8. Run checks with timeouts, cancellation, output redaction, and bounded concurrency.
9. Produce terminal, JSON, and HTML results.
10. Exit with a documented status code.

### 4.3 Review the result

Example terminal output:

```text
PREFLIGHT  feature/mailbox-reconnect  7a91c4e

NEEDS EVIDENCE                                    Risk 72 · High

Intent
  Fix mailbox reconnection without changing sign-in.

Scope
  6 files changed  +184 −61
  Auth · Mailbox · Firebase configuration

Blockers
  None

Warnings
  ! AuthView.swift changed outside the expected scope
  ! A Firestore query changed but indexes were not checked
  ! No test exercises offline → online reconnection

Verified
  ✓ App builds                                  38.2s
  ✓ Mailbox unit tests                          12.4s
  ✓ No likely secrets detected                   0.1s

Not demonstrated
  ○ Existing mailbox survives token refresh
  ○ App launches with an expired credential
  ○ Firestore query succeeds against the emulator

Risk calculation
  +25 Authentication/session code changed
  +15 Remote data query changed
  +12 No related test changed
  +10 File historically associated with regressions
  +10 Change crossed configured scope

Next best action
  pnpm preflight:mailbox-emulator

Report: .preflight/runs/2026-07-13T144210Z-7a91c4e/report.html
```

### 4.4 Re-run only what changed

```bash
preflight check --since-last-run
```

Preflight should reuse results whose cache inputs are unchanged and prominently label cached evidence.

## 5. MVP feature set

### 5.1 Repository and diff collector

Use the installed `git` executable rather than reimplementing Git behavior or depending on a Git abstraction library. Invoke it without a shell and parse machine-readable, NUL-delimited output.

The collector should determine:

- Repository root.
- Current branch and HEAD SHA.
- Default/base branch, with configuration override.
- Merge base between base and HEAD.
- Staged and unstaged changes.
- Commits since the merge base.
- File status, including adds, modifications, deletes, copies, and renames.
- Added and removed line counts.
- Binary files and submodules.
- Untracked files, optionally included.

Important commands include:

```bash
git rev-parse --show-toplevel
git rev-parse HEAD
git merge-base HEAD origin/main
git diff --name-status -z <merge-base>
git diff --numstat -z <merge-base>
git diff --unified=3 --no-ext-diff <merge-base>
git status --porcelain=v2 -z
git log --format=%H%x00%s%x00 --name-only -z <merge-base>..HEAD
```

Do not parse human-formatted Git output. Preserve unusual filenames by using `-z` where supported. Put a configurable size limit on full patch collection and avoid loading large binary files.

### 5.2 Change classifier

The first classifier should be deterministic and path-driven. It maps changed files to product surfaces and risk tags.

Built-in tags:

- `authentication`
- `authorization`
- `payments`
- `database`
- `migration`
- `api-contract`
- `dependency`
- `infrastructure`
- `permissions`
- `privacy`
- `configuration`
- `user-interface`
- `tests`
- `documentation`
- `generated`

Signals can come from:

- File globs.
- Filenames such as `Info.plist`, `AndroidManifest.xml`, `firestore.rules`, migration directories, lockfiles, workflow files, entitlements, and API schemas.
- Diff content such as new environment keys, public API declarations, permission strings, route definitions, or schema changes.
- Repository configuration.

MVP classification should be easy to extend through analyzer plugins rather than one large conditional statement.

### 5.3 Intent and scope analysis

The deterministic MVP should support:

- Expected path globs.
- Forbidden path globs.
- Intent keywords mapped to surface tags.
- Detection of unrelated top-level directories.
- Added dependencies that were not mentioned in the intent.
- Large scope growth compared with the task's starting point.

Example:

```yaml
intent:
  keywords:
    mailbox:
      expectedTags: [authentication, database]
      expectedPaths:
        - "**/*Mailbox*"
        - "**/*Session*"
```

Optional AI analysis can later receive a redacted change manifest, intent, filenames, and selected hunks. Its output must be structured and labelled as inference:

```json
{
  "summary": "The change adds mailbox reconnection and also modifies sign-in copy.",
  "scopeDrift": [
    {
      "path": "Views/Auth/AuthView.swift",
      "reason": "The stated task excludes sign-in changes.",
      "confidence": 0.91
    }
  ],
  "suggestedScenarios": [
    "Reconnect after network restoration",
    "Reconnect with an expired credential"
  ]
}
```

AI findings should never silently become blockers.

### 5.4 Transparent risk engine

Risk is calculated from additive, inspectable signals and capped at 100. Initial default weights:

| Signal | Weight |
|---|---:|
| Payments or production data migration changed | +30 |
| Authentication or authorization changed | +25 |
| Permissions, entitlements, or infrastructure changed | +20 |
| Public API or database schema changed | +18 |
| Remote query or security rule changed | +15 |
| No related test changed | +12 |
| New runtime dependency | +10 |
| High-churn or frequently reverted file | +10 |
| Change crossed explicit scope | +10 |
| Generated output dominates the diff | +5 |
| Focused regression test added and passed | −8 |
| Required contract scenario passed | −10 |

Suggested bands:

- 0–24: Low
- 25–49: Moderate
- 50–74: High
- 75–100: Critical

Risk and readiness are separate. A high-risk change can be Ready if it has strong evidence. A low-risk change can be Blocked if a deterministic requirement fails.

Repositories must be able to override weights and define critical paths.

### 5.5 Check planner

The planner converts change tags and file globs into commands and policy checks. It should run only relevant checks unless the user requests the full suite.

Example `.preflight.yml`:

```yaml
version: 1

baseBranch: origin/main

risk:
  criticalPaths:
    - "Sources/Auth/**"
    - "Sources/Payments/**"
    - "firestore.rules"
    - "migrations/**"

checks:
  - id: format
    label: Formatting
    when:
      changed: ["**/*.ts", "**/*.tsx"]
    run: ["pnpm", "prettier", "--check", "."]
    timeout: 60s
    blocking: true

  - id: auth-tests
    label: Authentication tests
    when:
      changed:
        - "src/auth/**"
        - "src/session/**"
    run: ["pnpm", "vitest", "run", "src/auth"]
    timeout: 5m
    blocking: true

  - id: firebase-emulator
    label: Firestore emulator contract
    when:
      changed:
        - "firestore.rules"
        - "firestore.indexes.json"
        - "src/data/**"
    run: ["npx", "firebase", "emulators:exec", "pnpm test:rules"]
    timeout: 10m
    blocking: false

contracts:
  - id: auth-legal-links
    label: Sign-in legal links remain present
    when:
      changed: ["**/AuthView.swift"]
    requireText:
      path: "**/AuthView.swift"
      values:
        - "Terms of Use"
        - "Privacy Policy"
```

Planner behavior:

- Explain why every check was selected.
- Show estimated time using previous runs.
- Use bounded parallelism, defaulting to half the available CPU count with a conservative maximum.
- Support exclusive groups for commands that cannot run concurrently.
- Support per-check working directories for monorepos.
- Apply timeouts and allow `Ctrl-C` cancellation.
- Preserve complete logs while showing concise live output.
- Mark skipped, cached, cancelled, timed out, passed, and failed distinctly.

### 5.6 Contract engine

Contracts encode repository knowledge that ordinary linters do not know. MVP contract types:

- Required or forbidden paths.
- Required or forbidden text.
- Maximum file or diff size.
- Companion file required when a pattern changes.
- Command must pass.
- Dependency allowlist/denylist.
- Environment key added to source must exist in `.env.example`.

Future contract types:

- OpenAPI backward compatibility.
- Database migration and rollback pairing.
- Screenshot comparison.
- Performance budget.
- Coverage delta.
- Public symbol compatibility.
- Permission and entitlement review.

### 5.7 Secret and privacy analyzer

The MVP needs a lightweight local secret scan before saving reports. Detect likely:

- Private keys.
- Common API-token prefixes.
- High-entropy assignments in configuration files.
- `.env` files accidentally added to Git.
- Credentials embedded in URLs.
- Cloud service account material.

Avoid displaying the full suspected secret. Show only a masked prefix, path, line, detector, and remediation.

Full patches and command output should not be persisted by default. Save structured findings, diff statistics, selected redacted evidence, and logs after redaction. Add an explicit `artifacts.storePatch: true` option for developers who want complete local reports.

### 5.8 Evidence and missing-proof model

Each check produces evidence; analyzers can also declare expected evidence. A scenario can be:

- `verified`
- `failed`
- `missing`
- `not-applicable`
- `waived`

Waivers require a reason and can optionally expire:

```bash
preflight waive mailbox-offline-scenario \
  --reason "Covered manually on device" \
  --expires 2026-07-20
```

Do not let a waiver erase the original finding. Show who or what waived it, when, and why.

### 5.9 Reports

Every run creates a machine-readable manifest plus a local HTML report:

```text
.preflight/
├── current-task.json
├── trust.json
├── cache/
└── runs/
    └── 2026-07-13T144210Z-7a91c4e/
        ├── run.json
        ├── report.html
        ├── results.sarif
        └── logs/
```

Recommended `run.json` shape:

```ts
type PreflightRun = {
  schemaVersion: 1;
  id: string;
  startedAt: string;
  finishedAt?: string;
  repository: {
    rootHash: string;
    remote?: string;
    branch: string;
    headSha: string;
    baseRef: string;
    mergeBaseSha: string;
    dirty: boolean;
  };
  intent?: TaskIntent;
  change: ChangeManifest;
  risk: RiskAssessment;
  findings: Finding[];
  checks: CheckResult[];
  scenarios: EvidenceScenario[];
  outcome: "ready" | "needs-evidence" | "blocked" | "cancelled";
};
```

Stable finding IDs are important for caching, waivers, GitHub annotations, and tracking recurring issues.

```ts
type Finding = {
  id: string;
  ruleId: string;
  title: string;
  detail: string;
  severity: "info" | "warning" | "error";
  confidence: "deterministic" | "high" | "medium" | "low";
  blocking: boolean;
  location?: { path: string; line?: number; column?: number };
  evidence: Array<{ kind: string; summary: string; reference?: string }>;
  remediation?: { summary: string; command?: string[] };
};
```

## 6. The coolest differentiating features

These features should follow the MVP rather than delay it, but the architecture should leave room for them.

### 6.1 Claim verification for coding agents

Compare an agent's completion claims with evidence:

```text
Agent claimed: "All tests pass."
Observed: Only 4 of 27 test targets were executed.

Agent claimed: "No authentication behavior changed."
Observed: AuthView.swift and SessionViewModel.swift changed.
```

Inputs can come from an explicitly supplied summary file, clipboard paste, or supported local agent transcript adapters. Never silently scrape unrelated conversations.

### 6.2 Live watch mode

```bash
preflight watch
```

Watch the working tree while a human or agent edits it. Display a calm timeline of meaningful state changes rather than every filesystem event:

```text
10:42  Session handling modified              Risk 34 → 52
10:44  Runtime dependency added               Risk 52 → 62
10:46  Focused regression test added          Risk 62 → 54
10:47  Authentication tests passed            Evidence improved
```

Potential controls:

- Notify when protected paths change.
- Create opt-in Git checkpoint commits or stash-like snapshots.
- Detect deleted or weakened tests.
- Detect scope expansion.
- Notify when an agent appears idle or has finished.

### 6.3 Blast-radius graph

Show relationships among changed files, importers, tests, routes, schemas, and historically coupled files. Start with imports and test references. Add syntax-aware analysis with Tree-sitter later.

The graph must answer a question, not just look impressive. Default to the affected product surfaces and hide low-value dependency nodes. Let the developer expand details progressively.

### 6.4 Historical fragility

Use local Git history to identify:

- High-churn files.
- Files commonly changed together.
- Previous reverts.
- Fix commits touching the same area.
- Tests that usually accompany the changed code.

Example:

```text
SessionViewModel.swift
  Changed in 11 of the last 20 bug-fix commits
  Reverted twice in 90 days
  Usually changes with GmailService.swift
  GmailService.swift is untouched in this change
```

This is inference and should be labelled accordingly, but it is grounded in repository history rather than generic language-model advice.

### 6.5 Before-and-after budgets

Compare the feature branch with its base for:

- Bundle or binary size.
- Build and test duration.
- Code coverage.
- API and database schemas.
- Dependencies and licences.
- Environment keys.
- Permissions and entitlements.
- Screenshots.
- Memory and CPU usage for configured scenarios.

### 6.6 Proof scenarios

Projects can define small executable user journeys:

```yaml
scenarios:
  - id: sign-in-expired-token
    label: Expired token returns to sign-in safely
    when:
      tags: [authentication]
    run: ["pnpm", "playwright", "test", "expired-token.spec.ts"]
    artifacts:
      - "test-results/**/*.png"
      - "test-results/**/*.webm"
```

The HTML report can show screenshots, videos, console errors, network failures, and the exact commit tested.

### 6.7 Last-green comparison

Instead of comparing only with `main`, allow:

```bash
preflight check --since-last-green
```

This makes it easy to answer which edits introduced a new failure during a long agent session.

## 7. Recommended implementation

### 7.1 MVP stack

Use TypeScript and Node.js for the first implementation:

- **Runtime:** current Node.js LTS.
- **Package manager:** `pnpm`.
- **CLI parsing:** `commander` or `citty`.
- **Configuration validation:** `zod`.
- **YAML:** `yaml`.
- **Process execution:** Node `child_process.spawn`/`execFile`, or `execa` as a thin ergonomic wrapper.
- **Glob matching:** `picomatch`.
- **Terminal UI:** `@clack/prompts` plus a small custom renderer; avoid a full React terminal UI until interaction requires it.
- **Build:** `tsup` or `esbuild`.
- **Tests:** `vitest`.
- **HTML report:** static HTML generated from a typed view model; Preact/Vite is optional if interaction grows.
- **Storage:** JSON files for the MVP; SQLite only when history queries and cross-run analytics justify it.

Reasons for this choice:

- Fast iteration and a rich ecosystem for parsers and developer tooling.
- Cross-platform support.
- Easy npm installation.
- The performance-critical work is mostly delegated to Git and project-specific tools.
- A future Rust core or standalone native binary remains possible without making the first version expensive.

Do not begin with Electron or a desktop application. The CLI is the daily workflow. The HTML report supplies a polished visual surface without requiring a persistent app.

### 7.2 Suggested package architecture

```text
preflight/
├── MVP.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── packages/
│   ├── cli/
│   │   └── src/
│   │       ├── commands/
│   │       ├── terminal/
│   │       └── index.ts
│   ├── core/
│   │   └── src/
│   │       ├── git/
│   │       ├── intent/
│   │       ├── planner/
│   │       ├── runner/
│   │       ├── risk/
│   │       ├── contracts/
│   │       ├── reports/
│   │       ├── redaction/
│   │       └── model/
│   ├── analyzers/
│   │   └── src/
│   │       ├── secrets.ts
│   │       ├── dependencies.ts
│   │       ├── migrations.ts
│   │       ├── permissions.ts
│   │       └── tests.ts
│   ├── packs/
│   │   └── src/
│   │       ├── javascript.ts
│   │       ├── swift.ts
│   │       └── firebase.ts
│   └── report/
│       └── src/
├── fixtures/
│   ├── javascript-app/
│   ├── swift-app/
│   └── risky-diff/
└── docs/
```

Keep packages in one repository but do not over-abstract the first implementation. The important boundaries are:

```text
Git collector
    ↓
Change manifest
    ↓
Analyzers + intent comparison
    ↓
Findings + risk signals
    ↓
Check planner
    ↓
Command runner
    ↓
Evidence model
    ↓
Terminal / JSON / HTML / SARIF renderers
```

### 7.3 Analyzer interface

```ts
type AnalyzerContext = {
  config: PreflightConfig;
  repository: RepositoryState;
  change: ChangeManifest;
  intent?: TaskIntent;
};

interface Analyzer {
  id: string;
  analyze(context: AnalyzerContext): Promise<{
    findings: Finding[];
    riskSignals: RiskSignal[];
    expectedEvidence: EvidenceScenario[];
  }>;
}
```

Analyzers must not mutate the repository. Commands that modify files should be separate explicit actions and never run automatically during `check`.

### 7.4 Safe command runner

Run commands as executable-plus-argument arrays with `shell: false`. This reduces quoting bugs and injection risk. Support shell strings only behind an explicit configuration option and warning.

The runner should provide:

- `cwd` scoped to the repository or declared workspace.
- Sanitized environment inheritance.
- `AbortController` cancellation.
- Graceful termination followed by forced termination after a short timeout.
- Maximum captured output size.
- Streaming output to log files with redaction.
- Per-command timeouts.
- Concurrency groups.
- Stable exit classification.

### 7.5 Trust model

A repository can put arbitrary commands in `.preflight.yml`, so cloned repositories must be considered untrusted.

On the first run, show the commands Preflight wants to execute and ask the user to trust the configuration. Save a trust record based on:

- Canonical repository path.
- Repository remote.
- Hash of `.preflight.yml` and included policy files.

If those files change, request trust again. In CI, require an explicit `--trust-config` flag or environment variable. Never auto-run repository commands merely because a folder was opened.

### 7.6 Cache design

Build a cache key from:

- Check ID and normalized command.
- Working directory.
- Relevant changed-file hashes.
- Lockfile hash when dependencies matter.
- Environment keys explicitly declared as cache inputs.
- Tool versions.
- Preflight configuration hash.

Do not key only on HEAD because Preflight is designed to inspect dirty working trees.

## 8. Stack-specific packs

### 8.1 JavaScript and TypeScript

Detect:

- `package.json` scripts.
- Package manager from the lockfile.
- Runtime dependency additions and removals.
- Changes to environment-variable access.
- Public exports and route files.
- Test files related by path and import graph.
- Framework build configuration.

Suggested commands should prefer existing repository scripts rather than inventing new ones.

### 8.2 Swift and Apple platforms

Detect:

- Xcode projects and workspaces.
- Schemes with `xcodebuild -list`.
- `Info.plist`, entitlements, privacy manifests, signing configuration, and package changes.
- Public Swift declarations and concurrency-sensitive files.
- XCTest targets related to changed sources.

Useful local tools include `xcodebuild`, `xcrun`, `plutil`, and optionally project-provided SwiftLint/SwiftFormat commands. Keep scheme and destination configuration explicit because automatic selection can run the wrong target or simulator.

### 8.3 Firebase

Detect:

- `.firebaserc` aliases and the active project.
- `firebase.json` changes.
- Firestore rules and indexes.
- Functions runtime and dependency changes.
- Emulator test commands.
- A mismatch between expected local, staging, and production project identifiers.

Preflight should never deploy. It may report the configured target and require the developer to verify it.

### 8.4 API and database projects

Detect:

- OpenAPI documents.
- Generated client code.
- Migration files.
- ORM schema changes.
- Public endpoint additions/removals.
- Rollback and compatibility artifacts.

Future analyzers can compare OpenAPI documents and database schemas between the merge base and working tree.

## 9. Terminal and report UX

### 9.1 Terminal hierarchy

The first screen should be understandable in five seconds:

1. Outcome.
2. Risk and why.
3. Blockers.
4. Verified evidence.
5. Missing evidence.
6. Next best action.

Do not begin with a long list of passed linters. Collapse successful detail and expand failures.

### 9.2 Language

Use factual labels:

- "Not demonstrated" instead of "probably broken."
- "Changed outside configured scope" instead of "AI made an unrelated change."
- "Command was not run" instead of "test missing" when the distinction matters.
- "Inferred" on every non-deterministic suggestion.

Avoid aviation jokes throughout the interface. The name is enough. A restrained checklist metaphor can work, but the product should feel like a serious developer tool.

### 9.3 Color and accessibility

- Never encode status through color alone.
- Use symbols and words: `✓ Passed`, `! Warning`, `× Blocked`, `○ Missing`.
- Respect `NO_COLOR`.
- Provide `--json` and `--plain` modes.
- Keep output usable on narrow terminals.
- Avoid animated spinners when output is redirected.
- Show elapsed time on slow checks.

### 9.4 HTML report layout

Recommended sections:

1. Sticky header with outcome, risk, branch, and commit.
2. Intent and scope-drift summary.
3. Blockers and next action.
4. Affected surfaces.
5. Verified versus missing evidence.
6. Findings grouped by severity and surface.
7. Check timeline and expandable logs.
8. Risk calculation.
9. Changed-file list.
10. Reproduction metadata.

Visual direction:

- Dense but calm developer tooling, closer to a great profiler than a marketing dashboard.
- Charcoal, warm white, restrained green, amber, and red.
- Monospace for paths, commands, and hashes; readable sans-serif for explanations.
- One small brand mark such as `PF` or a runway/check line; no generic AI gradients.
- Progressive disclosure for logs and dependency graphs.
- Every warning should provide a path to the evidence and a concrete next action.

### 9.5 Delight without gimmicks

Useful touches:

- Copy the exact next command with one action.
- Open a file at the finding location.
- Show "what changed since the last green run."
- Estimate run duration based on local history.
- Generate a compact proof card for a pull-request description.
- Use subtle completion feedback when the project becomes Ready.

## 10. Exit codes

Document stable exit codes so Preflight can be used in hooks and CI:

| Code | Meaning |
|---:|---|
| 0 | Ready |
| 1 | Blocked by a finding or failed required check |
| 2 | Needs evidence, when strict mode is enabled |
| 3 | Configuration error |
| 4 | Runtime/tooling error |
| 130 | Cancelled by the user |

By default, `needs-evidence` should still exit 0 for local interactive use. `--strict` can turn it into exit 2.

## 11. Git and GitHub integrations

### 11.1 Local Git hooks

Offer an explicit installer:

```bash
preflight hook install pre-push
```

Do not install hooks during package installation. The hook should call the repository's pinned Preflight version when available. Provide a quick mode for pre-push and leave expensive proof scenarios for manual or CI runs.

### 11.2 GitHub commit statuses

The GitHub Commit Statuses API can publish `pending`, `success`, `failure`, or `error` for a commit and link to a report. It is the simplest remote integration for an authenticated user or service.

### 11.3 GitHub Checks API

Rich check runs can annotate lines and expose re-run actions, but creating check runs requires a GitHub App. This belongs after the local product proves useful.

### 11.4 SARIF

Preflight should eventually export SARIF 2.1.0 so deterministic findings can appear in GitHub code scanning. Use stable `ruleId` and fingerprint data to prevent duplicate alerts. Be aware that private-repository uploads require the appropriate GitHub Code Security availability.

### 11.5 Pull-request summary

The low-complexity integration is:

```bash
preflight report --format markdown > preflight-summary.md
```

The summary can be pasted or uploaded by CI without requiring Preflight to own GitHub authentication in the MVP.

## 12. Optional AI design

AI is an enhancement, not a foundation.

Good uses:

- Summarize a large change manifest.
- Compare intent with changed surfaces.
- Suggest user scenarios that are not represented in configured checks.
- Explain a deterministic finding in project language.
- Map a plain-language task to configured tags.

Poor uses:

- Declaring code secure.
- Inventing test results.
- Blocking a push based only on a model judgment.
- Sending an entire private repository without explicit permission.
- Producing dozens of style suggestions already covered by linters.

Provider interface:

```ts
interface InferenceProvider {
  analyzeScope(input: RedactedScopeInput): Promise<ScopeAnalysis>;
  suggestScenarios(input: RedactedScenarioInput): Promise<SuggestedScenario[]>;
}
```

Privacy controls should include:

- Off by default.
- Preview exactly what will be sent.
- Filename-only, manifest, selected-hunks, and full-diff modes.
- Configurable provider.
- Redaction before provider invocation.
- No source retention assumptions in the UI; link to the selected provider's policy.

## 13. Delivery plan

### Phase 0: one-day proof of concept

Goal: prove the daily workflow, not the full platform.

Build:

- `preflight check --intent <text>`.
- Git repository discovery and merge-base diff.
- Changed-path classification.
- Five deterministic analyzers: scope, secrets, dependencies, risky paths, and missing related tests.
- Transparent risk calculation.
- `.preflight.yml` with path-triggered commands.
- Concurrent runner with timeouts.
- Terminal summary.
- Static HTML report.

Leave out:

- Accounts and cloud sync.
- GitHub App.
- Agent transcript integrations.
- Watch mode.
- AST call graph.
- SQLite.
- Automatic fixes.

### Phase 1: usable alpha, roughly three to five focused days

- `preflight init` with repository detection.
- Trusted-config flow.
- Cache and last-green run.
- Contracts and waivers.
- Better redaction.
- JavaScript/TypeScript, Swift, and Firebase packs.
- JSON schema and report fixtures.
- Markdown and SARIF export.
- Installable npm package.

### Phase 2: developer-quality beta

- Import and test-impact graph.
- Historical fragility and co-change analysis.
- Proof scenarios with screenshots and videos.
- Watch mode.
- Optional intent inference.
- Git hooks.
- CI action.
- Performance and coverage comparisons.
- Polished interactive HTML report.

### Phase 3: team and ecosystem

- GitHub App and Checks API.
- Shared policy packs.
- Signed or attestable run receipts.
- Plugin SDK.
- Agent transcript adapters.
- Team waiver and ownership workflows.
- Cross-repository policies.

## 14. Day-one implementation order

If building the first version in one day:

1. Scaffold the TypeScript CLI and typed result model.
2. Implement safe command execution and Git repository discovery.
3. Produce a correct change manifest from NUL-delimited Git output.
4. Add configuration parsing and trust confirmation.
5. Add path classification and deterministic analyzers.
6. Add risk calculation with a visible breakdown.
7. Add path-triggered command planning.
8. Run commands concurrently with cancellation and timeouts.
9. Render the terminal result.
10. Generate a single-file HTML report.
11. Add fixture repositories and golden-output tests.
12. Record a short demo showing an agent-like scope drift and Preflight catching it.

Correct Git parsing and a strong evidence model matter more than adding an LLM on day one.

## 15. Testing strategy

### 15.1 Unit tests

- Parse Git porcelain and diff formats, including spaces, Unicode, renames, deletes, and binary files.
- Configuration validation and defaults.
- Glob matching.
- Risk calculation.
- Finding fingerprint stability.
- Redaction.
- Cache-key generation.
- Exit-code mapping.

### 15.2 Fixture repositories

Create small repositories with known commits and expected results:

- Safe documentation-only change.
- Authentication change without tests.
- Renamed source file.
- Added dependency.
- Migration without rollback note.
- Suspected secret.
- Scope drift.
- Failing and timing-out commands.
- Dirty worktree with staged and unstaged edits.

### 15.3 Golden tests

Snapshot the normalized JSON model, plain terminal output, Markdown summary, and HTML accessibility structure. Avoid snapshotting timestamps and absolute paths directly.

### 15.4 Security tests

- Malicious filenames.
- Malicious `.preflight.yml` command arguments.
- Symlink traversal.
- Huge logs.
- ANSI escape injection in child output.
- Secrets in stdout and stderr.
- Cancellation that leaves child processes running.
- Untrusted repository configuration changes.

## 16. MVP acceptance criteria

The MVP is credible when:

- It installs and runs with one command in a Git repository.
- It correctly compares the working change with a configurable base.
- It handles staged, unstaged, committed, renamed, deleted, binary, and untracked files predictably.
- It explains why every check ran.
- It can run at least four checks concurrently and cancel them cleanly.
- It distinguishes blockers, warnings, passed evidence, and missing evidence.
- Its risk score is fully explained.
- It never requires network access.
- It does not persist obvious secrets in reports.
- It asks before executing a new or changed repository configuration.
- It produces an attractive, self-contained HTML report.
- It gives one concrete next action.
- The same inputs produce the same deterministic findings.

Suggested performance targets:

- Under 1 second for repository inspection on a typical project, excluding configured commands.
- Under 100 MB memory for a normal run.
- Under 500 ms to render the terminal result after checks finish.
- Reports remain usable with 1,000 changed files and gracefully summarize beyond that.

## 17. Non-goals for the MVP

- Replacing CI.
- Proving that software has no bugs.
- Automatically fixing arbitrary findings.
- Deploying code or changing cloud infrastructure.
- Uploading source code.
- Managing coding agents.
- Supporting every language with deep AST analysis.
- Becoming a full pull-request review platform.
- Blocking work based on opaque AI judgment.

## 18. Launch and GitHub presentation

The repository should demonstrate the product in under 30 seconds.

README structure:

1. One-sentence promise.
2. Short terminal GIF showing a risky change being caught.
3. Screenshot of the HTML evidence report.
4. Three-command quick start.
5. Example `.preflight.yml`.
6. Explanation of deterministic versus inferred findings.
7. Privacy and trust model.
8. Architecture diagram.
9. Roadmap and contribution guide.

Best demo scenario:

1. Start with the intent "fix mailbox reconnection without changing sign-in."
2. Modify session code, an unrelated auth view, and a dependency.
3. Claim all tests passed while only a narrow command was run.
4. Run Preflight.
5. Show scope drift, targeted checks, missing proof, and the final report.
6. Add the missing regression test, re-run, and show the result move from Needs evidence to Ready.

This communicates the product better than a generic list of lint warnings.

## 19. Official documentation and APIs

Core implementation references:

- [Git diff documentation](https://git-scm.com/docs/git-diff) — merge-base comparisons, `--name-status`, `--numstat`, and NUL-delimited output.
- [Git status documentation](https://git-scm.com/docs/git-status) — porcelain formats for staged and working-tree state.
- [Node.js child process documentation](https://nodejs.org/api/child_process.html) — safe process spawning, timeouts, signals, and `AbortSignal` cancellation.
- [Tree-sitter query documentation](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/index.html) — future syntax-aware import, declaration, route, and test analysis.
- [OpenAPI Specification](https://spec.openapis.org/oas/) — future API-contract compatibility checks.

GitHub integration references:

- [REST API for commit statuses](https://docs.github.com/en/rest/commits/statuses) — simplest way to publish a commit result.
- [REST API for check runs](https://docs.github.com/en/rest/checks/runs) — rich annotations; creating check runs requires a GitHub App.
- [Using the Checks API](https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks) — suites, runs, annotations, and requested actions.
- [GitHub SARIF support](https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support) — supported SARIF 2.1.0 fields, stable fingerprints, and upload constraints.
- [Uploading SARIF to GitHub](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/integrate-with-existing-tools/upload-sarif-file) — GitHub Actions and API upload workflows.
- [GitHub dependency review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review) — dependency-diff concepts and merge enforcement.
- [GitHub repository rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) — required checks, code quality, coverage, file restrictions, and merge policy.

Stack-pack references:

- [Firebase Local Emulator Suite](https://firebase.google.com/docs/emulator-suite) — local rules, functions, and integration testing.
- [Firebase CLI project aliases](https://firebase.google.com/docs/cli#project_aliases) — safe project targeting and environment separation.
- `man xcodebuild` and `xcodebuild -help` — authoritative documentation for the installed Xcode version.
- `man plutil` — property-list validation and inspection on macOS.

## 20. Product north star

Preflight succeeds if a developer runs it voluntarily several times a day because it gives a faster, more honest answer than manually reading a diff or waiting for CI.

The ideal final interaction is:

```text
Ready · High-risk change, strongly verified

All required checks passed.
Two important scenarios were demonstrated.
No scope drift or deterministic blockers were found.

Push with confidence:
  git push --set-upstream origin feature/mailbox-reconnect
```

The product should make confidence earned, visible, and portable.
