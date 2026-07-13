const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED GITHUB TOKEN]"],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, "[REDACTED API KEY]"],
  [/\bAKIA[A-Z0-9]{16}\b/g, "[REDACTED AWS ACCESS KEY]"],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, "[REDACTED GOOGLE API KEY]"],
  [/(?:https?:\/\/)[^\s/:]+:[^\s/@]+@/g, "https://[REDACTED CREDENTIALS]@"],
];

export function redact(value: string): string {
  let output = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) output = output.replace(pattern, replacement);
  return stripAnsi(output);
}

export function secretMatches(value: string): Array<{ detector: string; index: number }> {
  const detectors: Array<[RegExp, string]> = [
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "private-key"],
    [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "github-token"],
    [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, "api-key"],
    [/\bAKIA[A-Z0-9]{16}\b/g, "aws-access-key"],
    [/\bAIza[0-9A-Za-z_-]{30,}\b/g, "google-api-key"],
    [/(?:https?:\/\/)[^\s/:]+:[^\s/@]+@/g, "credential-url"],
  ];
  const results: Array<{ detector: string; index: number }> = [];
  for (const [pattern, detector] of detectors) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) results.push({ detector, index: match.index });
  }
  return results;
}

export function stripAnsi(value: string): string {
  return value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "");
}
