// AGENTS.md, rule 3: every source file opens with a comment saying what it provides. This checks
// the first non-blank line of every TypeScript and JavaScript file the repository owns.
import { describe, expect, it } from "vitest";
import { ROOT, read, rel, walk } from "./files";

export function opensWithComment(source: string): boolean {
  const first = source.split("\n").find((l) => l.trim() !== "") ?? "";
  return first.startsWith("//") || first.startsWith("/*") || first.startsWith("#!");
}

describe("source files open with a comment", () => {
  it("the detector tells a comment from code", () => {
    expect(opensWithComment("// provides x\nconst a = 1;")).toBe(true);
    expect(opensWithComment("\n\n/* provides x */\n")).toBe(true);
    expect(opensWithComment("import x from 'y';\n// late comment")).toBe(false);
    expect(opensWithComment("")).toBe(false);
  });
  const files = walk(ROOT, (p) => /\.(?:ts|mjs|js)$/.test(p) && !p.endsWith(".d.ts"));
  it("finds the repository's sources", () => {
    expect(files.length).toBeGreaterThan(40);
  });
  for (const file of files) {
    it(`${rel(file)} opens with a comment`, () => {
      expect(opensWithComment(read(file))).toBe(true);
    });
  }
});
