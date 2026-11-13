// Tests of the byte-preserving edit of mcp-plugins.json: the scanner, INS-1 (every prior state ×
// install, upgrade, uninstall), INS-2 (installing twice) and INS-3 (a kill during the write).
import fc from "fast-check";
import { chmodSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyEdit,
  editPluginsText,
  makeEntry,
  scanArray,
  type FsOps,
  type PluginsEdit,
} from "../src/plugins-file";
import { oursCount, otherSlices, sandbox, write } from "./helpers";

const BOM = String.fromCharCode(0xfeff);
const entry = makeEntry("/usr/bin/node", "/data/server/server.mjs");
const upgraded = makeEntry("/opt/node22/bin/node", "/data/server/server.mjs");
const install: PluginsEdit = { kind: "upsert", entry };
const upgrade: PluginsEdit = { kind: "upsert", entry: upgraded };
const uninstall: PluginsEdit = { kind: "remove" };

describe("scanner", () => {
  it("slices every element, however it is written", () => {
    const text = `${BOM} [ 1 ,"a]b,\\"c\\\\" ,\n\t{"k":[1,{"x":"]"}],"u":"é😀"},[[],[2]],null, true,-1.5e3 ]\n`;
    const l = scanArray(text);
    const parsed = JSON.parse(text.slice(1)) as unknown[];
    expect(l.elements.map((e) => JSON.parse(text.slice(e.start, e.end)))).toEqual(parsed);
    expect(text.slice(l.close)).toBe("]\n");
  });

  it("agrees with JSON.parse on generated arrays in several layouts", () => {
    fc.assert(
      fc.property(
        fc.array(fc.jsonValue(), { maxLength: 8 }),
        fc.constantFrom(0, 2, 4, "\t"),
        (arr, indent) => {
          const text = JSON.stringify(arr, null, indent) + "\n";
          const l = scanArray(text);
          expect(
            JSON.stringify(l.elements.map((e) => JSON.parse(text.slice(e.start, e.end)))),
          ).toBe(JSON.stringify(arr));
        },
      ),
      { seed: 20260101, numRuns: 300 },
    );
  });

  it("keeps the other entries byte for byte when ours is added, on generated arrays", () => {
    fc.assert(
      fc.property(
        fc.array(fc.jsonValue(), { maxLength: 6 }),
        fc.constantFrom(0, 2, "\t"),
        (arr, indent) => {
          const text = JSON.stringify(arr, null, indent) + "\n";
          const r = editPluginsText(text, install);
          if (!r.ok) throw new Error("refused");
          expect(otherSlices(r.text)).toEqual(otherSlices(text));
          expect(oursCount(r.text)).toBe(1);
          const again = editPluginsText(r.text, install);
          expect(again.ok && again.text).toBe(r.text);
          const gone = editPluginsText(r.text, uninstall);
          expect(gone.ok && otherSlices(gone.text)).toEqual(otherSlices(text));
        },
      ),
      { seed: 20260102, numRuns: 300 },
    );
  });
});

const other1 = '{"id":"a","name":"one","transport":"stdio","command":"x","args":["é","]"]}';
const other2 = '{ "id" : "b",\t"name":"two" ,"url":"http://host/\\u00e9" }';
const old = '{"id":"old","name":"distiller","command":"/old/node","args":["/old/server/index.js"]}';
const byId = '{"id":"0f107eda-796d-44e2-b910-37c18e2bc535","name":"renamed"}';
const current = JSON.stringify(entry);

interface State {
  name: string;
  /** null: no file. A string is written as text, a Buffer as bytes. */
  content: string | Buffer | null;
  /** Whether install must be refused and the file left untouched. */
  refused?: boolean;
}
const states: State[] = [
  { name: "absent", content: null },
  { name: "empty", content: "" },
  { name: "blank", content: " \n\t\n" },
  { name: "empty array", content: "[]\n" },
  { name: "only other entries, pretty", content: `[\n  ${other1},\n  ${other2}\n]\n` },
  { name: "only other entries, CRLF", content: `[\r\n  ${other1},\r\n  ${other2}\r\n]\r\n` },
  {
    name: "only other entries, tabs, no final newline",
    content: `[\n\t${other1},\n\t${other2}\n]`,
  },
  { name: "only other entries, one line", content: `[${other1},${other2}]` },
  { name: "other entries, a BOM", content: `${BOM}[\n  ${other1}\n]\n` },
  { name: "an older entry of ours", content: `[\n  ${other1},\n  ${old},\n  ${other2}\n]\n` },
  { name: "an entry of ours by id only", content: `[${byId},${other1}]\n` },
  { name: "our current entry", content: `[\n  ${other1},\n  ${current}\n]\n` },
  { name: "two entries of ours", content: `[\n  ${old},\n  ${other1},\n  ${current}\n]\n` },
  { name: "text after the array", content: `[${other1}]\n\n` },
  { name: "malformed", content: `[${other1},`, refused: true },
  { name: "not an array", content: `{"servers":[]}`, refused: true },
  { name: "not UTF-8", content: Buffer.from([0x5b, 0xff, 0xfe, 0x5d]), refused: true },
];

describe("INS-1 every prior state of MosAIc's server list × install, upgrade, uninstall", () => {
  for (const st of states) {
    const actions: [string, PluginsEdit][] = [
      ["install", install],
      ["upgrade", upgrade],
      ["uninstall", uninstall],
    ];
    for (const [label, edit] of actions) {
      it(`INS-1 ${st.name} × ${label}`, () => {
        const sb = sandbox();
        const file = sb.plugins;
        const before = st.content === null ? null : Buffer.from(st.content);
        if (st.content !== null) write(file, st.content);
        const r = applyEdit(file, edit);
        const after = existsSync(file) ? readFileSync(file) : null;
        const removing = edit.kind === "remove";
        if (st.refused) {
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.message).toContain(file);
          expect(after).toEqual(before);
          expect(existsSync(file + ".bak")).toBe(false);
          return;
        }
        expect(r.ok).toBe(true);
        if (after === null) {
          // Nothing existed and nothing was installed: uninstall leaves no file.
          expect(removing).toBe(true);
          return;
        }
        const text = after.toString("utf8");
        if (text.trim() === "") return; // an empty file that nothing was done to
        const beforeText = before === null ? "[]" : before.toString("utf8");
        const prior = beforeText.trim() === "" ? "[]" : beforeText;
        expect(otherSlices(text)).toEqual(otherSlices(prior));
        expect(oursCount(text)).toBe(removing ? 0 : 1);
        if (!removing) {
          const mine = (
            JSON.parse(text.replace(BOM, "")) as { name: string; command: string }[]
          ).find((v) => v.name === "distiller" || v.name === "renamed");
          expect(mine?.command).toBe(edit.kind === "upsert" ? edit.entry.command : "");
        }
        if (before !== null && before.length > 0 && r.ok && r.changed) {
          expect(readFileSync(file + ".bak")).toEqual(before);
        }
        if (before !== null && r.ok && !r.changed) expect(after).toEqual(before);
        // The entry order of the others and the text after the array are kept.
        if (st.name === "text after the array") expect(text.endsWith("]\n\n")).toBe(true);
        if (st.name.endsWith("CRLF") && !removing)
          expect(text.replace(/\r\n/g, "")).not.toContain("\n");
        if (st.name === "other entries, a BOM") expect(text.charCodeAt(0)).toBe(0xfeff);
      });
    }
  }

  const readOnlyCases: [string, string, PluginsEdit, boolean][] = [
    ["others only", `[${other1}]\n`, install, true],
    ["others only", `[${other1}]\n`, upgrade, true],
    ["others only", `[${other1}]\n`, uninstall, false],
    ["our current entry", `[${other1},${current}]\n`, install, false],
    ["our current entry", `[${other1},${current}]\n`, upgrade, true],
    ["our current entry", `[${other1},${current}]\n`, uninstall, true],
  ];
  for (const [name, content, edit, refused] of readOnlyCases) {
    it(`INS-1 read-only, ${name} × ${edit.kind === "remove" ? "uninstall" : edit === install ? "install" : "upgrade"}`, () => {
      const sb = sandbox();
      write(sb.plugins, content);
      chmodSync(sb.plugins, 0o444);
      const r = applyEdit(sb.plugins, edit);
      expect(r.ok).toBe(!refused);
      if (!r.ok) expect(r.message).toContain("read-only");
      expect(readFileSync(sb.plugins, "utf8")).toBe(content);
      expect(existsSync(sb.plugins + ".bak")).toBe(false);
    });
  }

  it("INS-1 refuses a malformed file with a message that says so, and names no content", () => {
    const sb = sandbox();
    write(sb.plugins, '[{"secret-looking":"abc123"');
    const r = applyEdit(sb.plugins, install);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("not valid JSON");
      expect(r.message).not.toContain("abc123");
    }
  });
});

describe("INS-2 installing twice equals installing once", () => {
  for (const st of states.filter((s) => !s.refused && s.content !== null)) {
    it(`INS-2 ${st.name}`, () => {
      const sb = sandbox();
      write(sb.plugins, st.content as string | Buffer);
      applyEdit(sb.plugins, install);
      const once = readFileSync(sb.plugins);
      const second = applyEdit(sb.plugins, install);
      expect(readFileSync(sb.plugins)).toEqual(once);
      expect(second.ok && second.changed).toBe(false);
      expect(oursCount(once.toString("utf8"))).toBe(1);
    });
  }
  it("INS-2 from no file at all", () => {
    const sb = sandbox();
    applyEdit(sb.plugins, install);
    const once = readFileSync(sb.plugins, "utf8");
    applyEdit(sb.plugins, install);
    expect(readFileSync(sb.plugins, "utf8")).toBe(once);
    expect(once).toBe(`[\n  ${JSON.stringify(entry, null, 2).split("\n").join("\n  ")}\n]\n`);
  });
});

describe("INS-3 a kill during the write", () => {
  const killedRename: FsOps = {
    rename() {
      throw new Error("killed");
    },
  };
  it("INS-3 an existing file is still the old one", () => {
    const sb = sandbox();
    const old = `[\n  ${other1}\n]\n`;
    write(sb.plugins, old);
    expect(() => applyEdit(sb.plugins, install, killedRename)).toThrow("killed");
    expect(readFileSync(sb.plugins, "utf8")).toBe(old);
    expect(readFileSync(sb.plugins + ".bak", "utf8")).toBe(old);
  });
  it("INS-3 an absent file stays absent", () => {
    const sb = sandbox();
    write(sb.plugins + ".x", "");
    expect(() => applyEdit(sb.plugins, install, killedRename)).toThrow("killed");
    expect(existsSync(sb.plugins)).toBe(false);
  });
  it("INS-3 a leftover temporary file, and a leftover backup, break nothing", () => {
    const sb = sandbox();
    write(sb.plugins, `[${other1}]\n`);
    write(`${sb.plugins}.tmp-${process.pid}`, '{"half":');
    write(`${sb.plugins}.bak`, "stale");
    const r = applyEdit(sb.plugins, install);
    expect(r.ok && r.changed).toBe(true);
    expect(oursCount(readFileSync(sb.plugins, "utf8"))).toBe(1);
    expect(readFileSync(sb.plugins + ".bak", "utf8")).toBe(`[${other1}]\n`);
  });
  it("INS-3 the new text only ever appears through the rename", () => {
    const sb = sandbox();
    write(sb.plugins, `[${other1}]\n`);
    let seenAtRename = "";
    const spy: FsOps = {
      rename(from, to) {
        seenAtRename = readFileSync(to, "utf8");
        expect(readFileSync(from, "utf8")).toContain("distiller");
        expect(dirname(from)).toBe(dirname(to));
        expect(basename(from)).not.toBe(basename(to));
        throw new Error("killed");
      },
    };
    expect(() => applyEdit(sb.plugins, install, spy)).toThrow();
    expect(seenAtRename).toBe(`[${other1}]\n`);
    expect(readdirSync(dirname(sb.plugins)).filter((n) => n.includes(".tmp-"))).toEqual([]);
  });
});
