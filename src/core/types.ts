export type ScopeMode = "staged" | "worktree" | "branch" | "task";

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "type-changed" | "unknown";

export type SurfaceId =
  | "authentication"
  | "authorization"
  | "payments"
  | "database"
  | "migration"
  | "api-contract"
  | "dependency"
  | "infrastructure"
  | "permissions"
  | "privacy"
  | "configuration"
  | "user-interface"
  | "tests"
  | "documentation"
  | "generated"
  | string;

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: ChangeStatus;
  added: number | null;
  removed: number | null;
  binary: boolean;
  surfaces: SurfaceId[];
}

export interface RepositoryState {
  root: string;
  branch: string;
  headSha: string | null;
  remoteHash?: string;
  baseRef: string;
  mergeBaseSha: string;
  dirty: boolean;
}

export interface ChangeManifest {
  scope: ScopeMode;
  files: ChangedFile[];
  added: number;
  removed: number;
  binaryFiles: number;
  patch: string;
  fingerprint: string;
}

export interface TaskIntent {
  intent: string;
  startedAt: string;
  startHeadSha: string;
  startBranch: string;
  expectedPaths: string[];
  avoidedPaths: string[];
  issue?: string;
}

export type Confidence = "deterministic" | "inferred";
export type Severity = "info" | "warning" | "error";

export interface Finding {
  id: string;
  ruleId: string;
  title: string;
  detail: string;
  severity: Severity;
  confidence: Confidence;
  blocking: boolean;
  location?: { path: string; line?: number };
  evidence: Array<{ kind: "observed" | "executed" | "demonstrated" | "inferred"; summary: string }>;
  remediation?: { summary: string; command?: string[] };
}

export interface RiskSignal {
  id: string;
  label: string;
  weight: number;
  evidence: string[];
}

export interface RiskAssessment {
  score: number;
  level: "low" | "moderate" | "high" | "critical";
  signals: RiskSignal[];
}

export type CheckState = "planned" | "running" | "passed" | "failed" | "timed-out" | "cancelled" | "skipped";

export interface PlannedCheck {
  id: string;
  label: string;
  command: string[];
  cwd: string;
  timeoutMs: number;
  blocking: boolean;
  reason: string[];
  proves: string[];
}

export interface CheckResult extends PlannedCheck {
  state: CheckState;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  signal?: string | null;
  stdout: string;
  stderr: string;
  outputDigest?: string;
  outputTruncated?: boolean;
}

export interface EvidenceScenario {
  id: string;
  label: string;
  state: "verified" | "failed" | "missing" | "not-applicable";
  source?: string;
}

export type Outcome = "ready" | "needs-evidence" | "blocked" | "stale" | "cancelled";

export interface PreflightRun {
  schemaVersion: 1;
  id: string;
  startedAt: string;
  finishedAt: string;
  repository: Omit<RepositoryState, "root"> & { rootHash: string };
  intent?: TaskIntent;
  change: Omit<ChangeManifest, "patch">;
  preRunFingerprint: string;
  postRunFingerprint: string;
  configHash: string;
  executionPolicyHash: string;
  risk: RiskAssessment;
  findings: Finding[];
  checks: CheckResult[];
  scenarios: EvidenceScenario[];
  outcome: Outcome;
  reportDirectory: string;
}

export interface SurfaceConfig {
  id: string;
  label: string;
  paths: string[];
  risk: number;
}

export interface CheckConfig {
  id: string;
  label: string;
  when?: { changed?: string[]; surfaces?: string[] };
  run: string[];
  cwd?: string;
  timeout: string;
  blocking: boolean;
  proves: string[];
}

export interface ContractConfig {
  id: string;
  label: string;
  when: { changed: string[] };
  requireChanged?: string[];
  forbidChanged?: string[];
  requireText?: { path: string; values: string[] };
  blocking: boolean;
}

export interface PreflightConfig {
  version: 1;
  baseBranch?: string;
  includeUntracked: boolean;
  concurrency: number;
  criticalPaths: string[];
  surfaces: SurfaceConfig[];
  checks: CheckConfig[];
  contracts: ContractConfig[];
}
