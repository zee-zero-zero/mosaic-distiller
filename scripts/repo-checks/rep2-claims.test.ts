// REP-2 (§5.9): documentation and descriptions use the whole words "anonymise", "anonymised",
// "anonymous", "anonymisation", "isolated" and "isolation" (either spelling) only in a sentence
// that denies them. Unicode's "isolates", a kind of invisible character, is not one of them.
import { describe, expect, it } from "vitest";
import { ROOT, read, rel, walk } from "./files";

const WORDS = /\b(anonymi[sz](?:e[sd]?|ation|ing)|anonymous|isolated|isolation)\b/gi;
const DENIAL = /\b(not|never|no|nor|cannot|without|neither|none|deny|denies|denying|denied)\b|n't/i;

/** Splits text into sentences: at . ! ? followed by white space, at blank lines, and at each Markdown row or list item. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n");
    let current = "";
    for (const line of lines) {
      if (/^\s*(?:[-*|#>]|\d+\.)\s/.test(line) && current !== "") {
        out.push(current);
        current = "";
      }
      current += (current === "" ? "" : " ") + line.trim();
    }
    if (current !== "") out.push(current);
  }
  return out.flatMap((s) => s.split(/(?<=[.!?])\s+/));
}

export function violations(text: string): string[] {
  const bad: string[] = [];
  for (const s of sentences(text)) {
    WORDS.lastIndex = 0;
    if (WORDS.test(s) && !DENIAL.test(s)) bad.push(s.slice(0, 160));
  }
  return bad;
}

describe("REP-2 claims", () => {
  it("REP-2 the detector flags a claim and accepts a denial", () => {
    expect(violations("The output is anonymous.")).toHaveLength(1);
    expect(violations("It is anonymised by the tool.")).toHaveLength(1);
    expect(violations("The service gives you isolation.")).toHaveLength(1);
    expect(violations("It is not anonymisation.")).toHaveLength(0);
    expect(violations("It must never be called anonymous.")).toHaveLength(0);
    expect(violations("Unicode's bidirectional isolates are removed.")).toHaveLength(0);
    expect(violations("- It makes the data anonymized\n- but it is not isolated")).toHaveLength(1);
  });

  const docs = walk(ROOT, (p) => p.endsWith(".md"));
  const manifests = walk(ROOT, (p) => p.endsWith("package.json"));
  it("REP-2 finds the repository's documents", () => {
    expect(docs.length).toBeGreaterThan(8);
  });
  for (const file of docs) {
    it(`REP-2 ${rel(file)} makes no claim the specification forbids`, () => {
      expect(violations(read(file))).toEqual([]);
    });
  }
  for (const file of manifests) {
    it(`REP-2 ${rel(file)} description makes no such claim`, () => {
      const description = (JSON.parse(read(file)) as { description?: string }).description ?? "";
      expect(violations(description)).toEqual([]);
    });
  }
  it("REP-2 the rule pack's and the profiles' names and versions make no such claim", () => {
    for (const f of walk(ROOT, (p) => /(rulepacks|profiles)\/[^/]+\.json$/.test(p))) {
      expect(violations(read(f).replace(/[{}",:[\]]/g, " ")), rel(f)).toEqual([]);
    }
  });
});
