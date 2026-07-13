import { describe, expect, it } from "vitest";
import { parseNameStatusZ, parseNumstatZ } from "../src/core/git.js";

describe("Git machine-format parsers", () => {
  it("parses NUL-delimited names including renames and unusual paths", () => {
    const output = Buffer.from("M\0src/normal.ts\0R100\0src/old name.ts\0src/new name.ts\0A\0unicodé.ts\0");
    expect(parseNameStatusZ(output)).toMatchObject([
      { path: "src/normal.ts", status: "modified" },
      { path: "src/new name.ts", oldPath: "src/old name.ts", status: "renamed" },
      { path: "unicodé.ts", status: "added" },
    ]);
  });

  it("parses text, binary, and renamed numstat records", () => {
    const output = Buffer.from(["4\t2\tsrc/file.ts", "-\t-\timage.png", "3\t1\t", "old.ts", "new.ts", ""].join("\0"));
    const parsed = parseNumstatZ(output);
    expect(parsed.get("src/file.ts")).toEqual({ added: 4, removed: 2, binary: false });
    expect(parsed.get("image.png")).toEqual({ added: null, removed: null, binary: true });
    expect(parsed.get("new.ts")).toEqual({ added: 3, removed: 1, binary: false });
  });
});
