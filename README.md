# Preflight

> A local evidence gate for human- and agent-written code. Know what changed, what could break, and what has actually been proven before you push.

Preflight reads the intent of a task, inspects the real Git change, identifies sensitive surfaces, selects repository checks, runs them locally, and produces an evidence receipt. It distinguishes three answers that ordinary check runners often blur together:

- **Ready** — required checks passed and no evidence gaps were found.
- **Needs evidence** — nothing is known to be broken, but important proof is missing.
- **Blocked** — a deterministic policy or required command failed.

If the workspace changes during verification, the result is **Stale** instead of presenting old green checks as current evidence.

## Quick start

Requirements: Git and Node.js 20 or newer.

```bash
pnpm install
pnpm build
pnpm link --global

cd /path/to/your/repository
preflight init
```

Review the generated `.preflight.yml`, commit it with the repository, then begin a task from a clean working tree:

```bash
preflight start "Fix mailbox reconnection without changing sign-in" \
  --expect "Sources/Mail/**" \
  --avoid "Sources/Auth/**"

# Work normally, then:
preflight check
```

The first check displays the exact configured commands and asks you to trust that execution policy. Changing `.preflight.yml`, a referenced script, or a package-manager script definition invalidates trust.

## Daily use

```bash
# Inspect the active task and run matching checks
preflight check

# Fast inspection without executing repository commands
preflight check --quick

# Choose an exact Git scope
preflight check --staged
preflight check --worktree
preflight check --branch
preflight check --task

# Machine-readable output for agents and scripts
preflight check --json --trust-config

# Make missing evidence non-zero in hooks or CI
preflight check --strict
```

Preflight includes staged, unstaged, committed, renamed, deleted, binary, and untracked changes according to the selected scope. Untracked files are included by default because new code should not escape review.

## Configuration

Commands are executable-plus-argument arrays. Preflight does not invoke a shell.

```yaml
version: 1
includeUntracked: true
concurrency: 2

criticalPaths:
  - "Sources/Auth/**"
  - "firestore.rules"

checks:
  - id: auth-tests
    label: Authentication tests
    when:
      changed:
        - "Sources/Auth/**"
      surfaces:
        - authentication
    run: ["pnpm", "vitest", "run", "src/auth"]
    timeout: 5m
    blocking: true
    proves:
      - Expired credentials return safely to sign-in

contracts:
  - id: rules-index-pair
    label: Firestore query changes include index review
    when:
      changed: ["firestore.rules", "Sources/Data/**"]
    requireChanged: ["firestore.indexes.json"]
    blocking: false
```

A passing command is recorded as **verified execution**. It marks a behavior as **demonstrated** only when that behavior is explicitly listed under `proves`.

## Agent workflow

Add this to `AGENTS.md` or your coding-agent instructions:

```text
Before declaring a task complete, run `preflight check --task --json`.
Report the outcome, commands executed, missing evidence, and scope drift.
Do not claim the change is ready when Preflight reports stale or needs-evidence.
```

The JSON and HTML receipts bind results to the exact change fingerprint and configuration hash. Source patches are not persisted.

## Privacy and command safety

- No account, backend, telemetry, API key, or network connection is required by Preflight.
- Repository commands can still access the network and inherited environment; review them before trusting configuration.
- Commands run with `shell: false`, bounded output, timeouts, cancellation, and redaction.
- Full patches are not written to reports.
- Known credential prefixes are blocked and masked. This is a focused guardrail, not a replacement for a dedicated scanner such as Gitleaks.
- Preflight proves what it observed and executed; it does not prove that software has no bugs.

See [MVP.md](./MVP.md) for the product direction and roadmap.

## Development

```bash
pnpm install
pnpm check
pnpm dev -- check --branch --quick
```

The implementation follows Git's stable porcelain and NUL-delimited machine formats and Node's argument-array child-process API:

- [Git status porcelain formats](https://git-scm.com/docs/git-status)
- [Git diff machine output](https://git-scm.com/docs/git-diff)
- [Node.js child processes](https://nodejs.org/api/child_process.html)
- [pnpm dependency build approvals](https://pnpm.io/cli/approve-builds)

## Status

Preflight is an early v0.1. The core local workflow works today; caching, SARIF, historical fragility, deeper stack packs, and optional AI inference remain future work.

## License

MIT
