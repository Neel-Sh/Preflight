import { describe, expect, it } from "vitest";
import { formatDuration, parseDuration, sha256 } from "../src/core/utils.js";
import { redact, secretMatches } from "../src/core/redaction.js";

describe("duration utilities", () => {
  it("parses supported units", () => {
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("2m")).toBe(120_000);
    expect(parseDuration("1h")).toBe(3_600_000);
  });

  it("rejects ambiguous durations", () => {
    expect(() => parseDuration("30")).toThrow("Invalid duration");
  });

  it("formats elapsed time compactly", () => {
    expect(formatDuration(425)).toBe("425ms");
    expect(formatDuration(1_250)).toBe("1.3s");
    expect(formatDuration(75_000)).toBe("1m 15s");
  });
});

describe("receipts and redaction", () => {
  it("produces stable hashes", () => {
    expect(sha256("same")).toBe(sha256("same"));
    expect(sha256("same")).not.toBe(sha256("different"));
  });

  it("detects and masks known token prefixes", () => {
    const token = `ghp_${"a".repeat(36)}`;
    expect(secretMatches(`token=${token}`)).toEqual([{ detector: "github-token", index: 6 }]);
    expect(redact(`token=${token}`)).toBe("token=[REDACTED GITHUB TOKEN]");
  });
});
