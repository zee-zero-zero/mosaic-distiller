// REP-5 (§5.9): every case id in docs/spec/05-testing.md has at least one test whose name starts
// with it, except the ids listed in scripts/case-ids-pending.txt and the cases that are manual by
// nature (REP-1, which maintainers run, and MAN-*). The pending file shrinks with each commit and
// is deleted when the last automated case exists. A pending id that has a test is an error: the
// file must not go stale.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROOT, read, walk } from "./files";

const ID = /\b(?:ENG|VAL|SRV|INS|MOS|QRK|REP|MAN)-\d+\b/;

/** The ids in the first column of the specification's case tables. */
export function caseIds(spec: string): string[] {
  const ids: string[] = [];
  for (const line of spec.split("\n")) {
    const m = /^\|\s*((?:ENG|VAL|SRV|INS|MOS|QRK|REP|MAN)-\d+)\s*\|/.exec(line);
    if (m !== null) ids.push(m[1] as string);
  }
  return ids;
}

/** The ids at which a test name (a string literal) starts. */
export function testedIds(source: string): Set<string> {
  const out = new Set<string>();
  for (const m of source.matchAll(
    /(["'`])((?:ENG|VAL|SRV|INS|MOS|QRK|REP|MAN)-\d+)(?=[\s:"'`])/g,
  )) {
    out.add(m[2] as string);
  }
  return out;
}

export function pendingIds(): string[] {
  const file = ROOT + "scripts/case-ids-pending.txt";
  if (!existsSync(file)) return [];
  return read(file)
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter((l) => l !== "");
}

const MANUAL = /^(?:MAN-\d+|REP-1)$/;

describe("REP-5 case coverage", () => {
  const ids = caseIds(read(ROOT + "docs/spec/05-testing.md"));
  const tested = new Set<string>();
  for (const f of walk(ROOT, (p) => /\.test\.ts$/.test(p))) {
    for (const id of testedIds(read(f))) tested.add(id);
  }
  const pending = new Set(pendingIds());

  it("REP-5 the readers work", () => {
    expect(caseIds("| ENG-1 | x |\n| not | a case |\n| VAL-12 | y |")).toEqual(["ENG-1", "VAL-12"]);
    expect(
      [...testedIds('it("ENG-11 edges: x"); describe(`VAL-2 y`); it("no ENG-3 here")')].sort(),
    ).toEqual(["ENG-11", "VAL-2"]);
    expect(ID.test("x ENG-5")).toBe(true);
  });
  it("REP-5 the specification lists its cases", () => {
    expect(ids.length).toBeGreaterThan(60);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("REP-5 every pending id is a case of the specification", () => {
    for (const p of pending) expect(ids, p).toContain(p);
  });
  for (const id of ids) {
    if (MANUAL.test(id)) continue;
    if (pending.has(id)) {
      it(`REP-5 ${id} is pending and still has no test`, () => {
        expect(
          tested.has(id),
          `${id} has a test: remove it from scripts/case-ids-pending.txt`,
        ).toBe(false);
      });
    } else {
      it(`REP-5 ${id} has a test whose name starts with it`, () => {
        expect(tested.has(id), `no test name starts with ${id}`).toBe(true);
      });
    }
  }
});
