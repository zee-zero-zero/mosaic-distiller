// REP-4 (§5.9): packages/core/src uses no source of nondeterminism: Date, Math.random,
// toLocaleLowerCase, toLocaleUpperCase, localeCompare, Intl, or the regular-expression escapes
// \d \w \s \b (whose meaning differs between engines). The one exception is
// src/pattern/subset.ts, which names those escapes in order to refuse them. Comments are
// ignored: the check reads the syntax tree, so only code, strings and regular expressions count.
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ROOT, read, rel, walk } from "./files";

const BANNED_NAMES = new Set([
  "Date",
  "Intl",
  "localeCompare",
  "toLocaleLowerCase",
  "toLocaleUpperCase",
]);
const ESCAPE = /\\[dwsbDWSB]/;

export function problems(source: string, fileName = "x.ts"): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const out: string[] = [];
  const at = (n: ts.Node): string =>
    `line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && BANNED_NAMES.has(n.text)) out.push(`${n.text} at ${at(n)}`);
    if (
      ts.isPropertyAccessExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "Math" &&
      n.name.text === "random"
    ) {
      out.push(`Math.random at ${at(n)}`);
    }
    if (ts.isRegularExpressionLiteral(n) && ESCAPE.test(n.text))
      out.push(`regex escape in ${n.text} at ${at(n)}`);
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && ESCAPE.test(n.text)) {
      out.push(`regex escape in string at ${at(n)}`);
    }
    if (
      (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) &&
      ESCAPE.test(n.text)
    ) {
      out.push(`regex escape in template at ${at(n)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("REP-4 determinism", () => {
  it("REP-4 the detector finds each banned construct", () => {
    expect(problems("const t = new Date();")).toHaveLength(1);
    expect(problems("const x = Math.random();")).toHaveLength(1);
    expect(
      problems("a.localeCompare(b); a.toLocaleLowerCase(); a.toLocaleUpperCase(); Intl.Collator;"),
    ).toHaveLength(4);
    expect(problems("const r = /\\d+/;")).toHaveLength(1);
    expect(problems('const s = "\\\\w";')).toHaveLength(1);
    expect(problems("const s = `\\\\s${1}`;")).toHaveLength(1);
    expect(problems("const r = /\\bword/;")).toHaveLength(1);
  });
  it("REP-4 the detector ignores comments and harmless escapes", () => {
    expect(problems("// uses Date, Math.random and \\d\nconst a = 1; /* Intl \\w */")).toEqual([]);
    expect(problems('const s = "\\n\\t"; const r = /[0-9]+\\./u;')).toEqual([]);
    expect(problems("const performance = 1; const Dates = 2;")).toEqual([]);
  });
  const files = walk(ROOT + "packages/core/src", (p) => p.endsWith(".ts"));
  it("REP-4 finds the core sources", () => {
    expect(files.length).toBeGreaterThan(15);
  });
  for (const file of files) {
    if (file.endsWith("pattern/subset.ts")) continue;
    it(`REP-4 ${rel(file)} has no nondeterminism`, () => {
      expect(problems(read(file), file)).toEqual([]);
    });
  }
  it("REP-4 the one exception, pattern/subset.ts, uses no other banned construct", () => {
    const text = read(ROOT + "packages/core/src/pattern/subset.ts");
    expect(problems(text).filter((p) => !p.startsWith("regex escape"))).toEqual([]);
  });
});
