import picomatch from "picomatch";
import type { ChangeManifest, PreflightConfig, RiskAssessment, RiskSignal, SurfaceId } from "./types.js";

interface BuiltinSurface {
  id: SurfaceId;
  label: string;
  paths: string[];
  risk: number;
}

export const BUILTIN_SURFACES: BuiltinSurface[] = [
  { id: "authentication", label: "Authentication", paths: ["**/{auth,Auth,login,Login,session,Session,oauth,OAuth}/**", "**/*{Auth,Login,Session,OAuth}*.*"], risk: 25 },
  { id: "authorization", label: "Authorization", paths: ["**/*{Authorization,Permission,AccessControl,Policy}*.*", "**/{policies,permissions}/**", "**/*.{rules,rego}"], risk: 25 },
  { id: "payments", label: "Payments", paths: ["**/{payments,billing,checkout,subscriptions}/**", "**/*{Payment,Billing,Checkout,Subscription}*.*"], risk: 30 },
  { id: "migration", label: "Migrations", paths: ["**/{migrations,migrate}/**", "**/*migration*.*"], risk: 30 },
  { id: "database", label: "Database", paths: ["**/{database,db,models,schema}/**", "**/*{Schema,Repository,Firestore,Database}*.*", "**/firestore.{rules,indexes.json}", "**/*.sql"], risk: 18 },
  { id: "api-contract", label: "API contract", paths: ["**/{openapi,swagger,graphql}/**", "**/*{openapi,swagger}*.{json,yaml,yml}", "**/*.graphql", "**/*.proto"], risk: 18 },
  { id: "dependency", label: "Dependencies", paths: ["**/{package.json,pnpm-lock.yaml,yarn.lock,package-lock.json,Podfile,Podfile.lock,Package.resolved,requirements.txt,poetry.lock,go.mod,go.sum,Cargo.toml,Cargo.lock}"], risk: 10 },
  { id: "infrastructure", label: "Infrastructure", paths: ["**/{.github,infra,infrastructure,terraform,k8s,deploy}/**", "**/{Dockerfile,docker-compose.yml,firebase.json,.firebaserc}", "**/*.{tf,hcl}"], risk: 20 },
  { id: "permissions", label: "Permissions", paths: ["**/*.{entitlements,plist}", "**/AndroidManifest.xml", "**/PrivacyInfo.xcprivacy"], risk: 20 },
  { id: "privacy", label: "Privacy", paths: ["**/*{Privacy,Consent,Tracking}*.*", "**/PrivacyInfo.xcprivacy"], risk: 20 },
  { id: "configuration", label: "Configuration", paths: ["**/*.{config,conf,yaml,yml,toml,ini}", "**/.env*", "**/Info.plist"], risk: 8 },
  { id: "tests", label: "Tests", paths: ["**/{test,tests,__tests__,spec,specs}/**", "**/*.{test,spec}.*", "**/*Tests.swift"], risk: 0 },
  { id: "documentation", label: "Documentation", paths: ["**/{docs,documentation}/**", "**/*.{md,mdx,rst}"], risk: 0 },
  { id: "generated", label: "Generated", paths: ["**/{generated,DerivedData,dist,build}/**", "**/*.generated.*"], risk: 5 },
  { id: "user-interface", label: "User interface", paths: ["**/{views,components,screens,ui}/**", "**/*{View,Screen,Component}.*", "**/*.{css,scss,storyboard,xib}"], risk: 5 },
];

export function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => picomatch.isMatch(path, pattern, { dot: true, nocase: false }));
}

export function classifyChanges(manifest: ChangeManifest, config: PreflightConfig): Map<string, string> {
  const labels = new Map<string, string>();
  for (const surface of BUILTIN_SURFACES) labels.set(surface.id, surface.label);
  for (const surface of config.surfaces) labels.set(surface.id, surface.label);

  for (const file of manifest.files) {
    const surfaces = new Set<string>();
    for (const surface of BUILTIN_SURFACES) if (matchesAny(file.path, surface.paths)) surfaces.add(surface.id);
    for (const surface of config.surfaces) if (matchesAny(file.path, surface.paths)) surfaces.add(surface.id);
    file.surfaces = [...surfaces];
  }
  return labels;
}

export function assessRisk(manifest: ChangeManifest, config: PreflightConfig): RiskAssessment {
  const signals: RiskSignal[] = [];
  const seen = new Set<string>();
  const allSurfaces = new Set(manifest.files.flatMap((file) => file.surfaces));
  for (const surface of [...BUILTIN_SURFACES, ...config.surfaces]) {
    if (surface.risk <= 0 || !allSurfaces.has(surface.id) || seen.has(surface.id)) continue;
    seen.add(surface.id);
    signals.push({
      id: `surface:${surface.id}`,
      label: `${surface.label} changed`,
      weight: surface.risk,
      evidence: manifest.files.filter((file) => file.surfaces.includes(surface.id)).map((file) => file.path),
    });
  }

  const critical = manifest.files.filter((file) => matchesAny(file.path, config.criticalPaths));
  if (critical.length > 0) signals.push({ id: "critical-path", label: "Configured critical path changed", weight: 20, evidence: critical.map((file) => file.path) });

  const sourceFiles = manifest.files.filter((file) => !file.surfaces.includes("tests") && !file.surfaces.includes("documentation") && !file.surfaces.includes("generated"));
  const testFiles = manifest.files.filter((file) => file.surfaces.includes("tests"));
  if (sourceFiles.length > 0 && testFiles.length === 0) {
    signals.push({ id: "no-related-test-change", label: "No test file changed", weight: 12, evidence: sourceFiles.slice(0, 10).map((file) => file.path) });
  }
  if (manifest.added + manifest.removed >= 500) signals.push({ id: "large-change", label: "Large change (500+ lines)", weight: 10, evidence: [`+${manifest.added} −${manifest.removed}`] });
  else if (manifest.added + manifest.removed >= 200) signals.push({ id: "medium-change", label: "Broad change (200+ lines)", weight: 5, evidence: [`+${manifest.added} −${manifest.removed}`] });

  const score = Math.max(0, Math.min(100, signals.reduce((sum, signal) => sum + signal.weight, 0)));
  const level = score < 25 ? "low" : score < 50 ? "moderate" : score < 75 ? "high" : "critical";
  return { score, level, signals };
}
