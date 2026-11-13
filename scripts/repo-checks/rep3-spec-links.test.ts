// REP-3 (§5.9): every `§` reference in docs/spec/ resolves to a heading.
import { describe, expect, it } from "vitest";
import { ROOT, read, rel, walk } from "./files";

/** The section numbers of a document's headings: `## 2.4.1 Title` has the number 2.4.1. */
export function headingNumbers(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split("\n")) {
    const m = /^#{1,6}\s+(\d+(?:\.\d+)*)\.?\s/.exec(line);
    if (m !== null) out.add(m[1] as string);
  }
  return out;
}

export function references(text: string): string[] {
  return [...text.matchAll(/§(\d+(?:\.\d+)*)/g)].map((m) => m[1] as string);
}

describe("REP-3 specification links", () => {
  const files = walk(ROOT + "docs/spec", (p) => p.endsWith(".md"));
  const all = new Set<string>();
  for (const f of files) for (const h of headingNumbers(read(f))) all.add(h);

  it("REP-3 the heading and reference readers work", () => {
    expect([...headingNumbers("# 7. Title\n## 2.4.1 Sub\ntext §2.4.1 and §7.")].sort()).toEqual([
      "2.4.1",
      "7",
    ]);
    expect(references("see §2.4.1, §5.9. And §7 (§3.4).")).toEqual(["2.4.1", "5.9", "7", "3.4"]);
  });
  it("REP-3 the specification has headings", () => {
    expect(all.size).toBeGreaterThan(40);
  });
  for (const file of files) {
    it(`REP-3 every § reference in ${rel(file)} resolves to a heading`, () => {
      const unresolved = references(read(file)).filter((r) => !all.has(r));
      expect([...new Set(unresolved)]).toEqual([]);
    });
  }
});
