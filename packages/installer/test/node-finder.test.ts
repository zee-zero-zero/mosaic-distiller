// Tests of INS-4: finding a Node.js of version 20 or newer, with fake `node` scripts on a fake
// PATH, and with an injected `run` for the fixed directories that tests cannot create.
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { findNode, parseNodeVersion } from "../src/node-finder";
import { spawnTier, tmp, write } from "./helpers";

function fakeNode(dir: string, version: string): string {
  const p = join(dir, "node");
  write(p, `#!/bin/sh\necho ${version}\n`, 0o755);
  return p;
}
const base = (
  over: Partial<Parameters<typeof findNode>[0]> = {},
): Parameters<typeof findNode>[0] => ({
  execPath: "/nonexistent/bin/node",
  pathEnv: "",
  platform: "linux",
  home: tmp(),
  ...over,
});

describe("INS-4 finding Node", () => {
  it("INS-4 version parsing and the boundary at 20", () => {
    expect(parseNodeVersion("v20.0.0\n")?.major).toBe(20);
    expect(parseNodeVersion("v19.9.9\n")?.major).toBe(19);
    for (const bad of ["", "node", "v20", "20.1.0", "v20.1.0 extra", "v-1.0.0"]) {
      expect(parseNodeVersion(bad)).toBeNull();
    }
    const run = (v: string) => () => v + "\n";
    const at = (v: string) => findNode(base({ execPath: "/x/node", run: run(v) }));
    expect(at("v20.0.0").ok).toBe(true);
    expect(at("v19.9.9").ok).toBe(false);
    expect(at("v22.3.1").ok).toBe(true);
  });

  it("INS-4 no Node at all gives a refusal that says what to install", () => {
    const r = findNode(base({ run: () => null }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("Install Node.js 20 or newer");
      expect(r.message).toContain("No Node.js was found");
    }
  });

  it("INS-4 only an old Node: refused, and the message names it", () => {
    const r = findNode(base({ execPath: "/old/node", run: () => "v18.19.0\n" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("v18.19.0");
  });

  it("INS-4 /opt/homebrew/bin and /usr/local/bin are tried, in that order, after PATH", () => {
    const asked: string[] = [];
    const run = (c: string) => {
      asked.push(c);
      return c === "/usr/local/bin/node"
        ? "v22.1.0\n"
        : c === "/opt/homebrew/bin/node"
          ? "v18.0.0\n"
          : null;
    };
    const r = findNode(base({ pathEnv: "/bin" + delimiter + "/usr/bin", run }));
    expect(r.ok && r.path).toBe("/usr/local/bin/node");
    expect(asked).toEqual([
      "/nonexistent/bin/node",
      "/bin/node",
      "/usr/bin/node",
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
    ]);
    const homebrew = findNode(
      base({ run: (c) => (c === "/opt/homebrew/bin/node" ? "v22.1.0\n" : null) }),
    );
    expect(homebrew.ok && homebrew.path).toBe("/opt/homebrew/bin/node");
  });

  it("INS-4 Windows does not look in the macOS and Linux directories", () => {
    const asked: string[] = [];
    findNode(base({ platform: "win32", pathEnv: "", run: (c) => (asked.push(c), null) }));
    expect(asked.join()).not.toContain("homebrew");
    expect(asked.join()).not.toContain("/usr/local");
  });

  it("INS-4 the running Node comes first, a relative PATH entry is never used", () => {
    const asked: string[] = [];
    const r = findNode(
      base({
        execPath: "/run/node",
        pathEnv: "bin" + delimiter + "." + delimiter + "/ok",
        run: (c) => (asked.push(c), "v21.0.0\n"),
      }),
    );
    expect(r.ok && r.path).toBe("/run/node");
    const r2 = findNode(
      base({
        execPath: "/run/node",
        pathEnv: "bin" + delimiter + ".",
        run: (c) => (asked.push(c), c === "/run/node" ? null : "v21.0.0\n"),
      }),
    );
    expect(r2.ok).toBe(true); // found among the fixed directories, never at a relative path
    expect(asked.some((c) => c.startsWith("bin") || c.startsWith("."))).toBe(false);
  });

  it("INS-4 a candidate that prints nonsense or fails is skipped", () => {
    const run = (c: string) =>
      c === "/a/node"
        ? "hello"
        : c === "/b/node" || c.startsWith("/nonexistent")
          ? null
          : "v20.5.0\n";
    const r = findNode(base({ pathEnv: ["/a", "/b", "/c"].join(delimiter), run }));
    expect(r.ok && r.path).toBe("/c/node");
  });

  it("INS-4 nvm's default: a number, an alias chain, and 'node'", () => {
    for (const [alias, extra] of [
      ["20", {}],
      ["lts/iron", { "lts/iron": "v20.11.0" }],
      ["node", {}],
    ] as const) {
      const home = tmp();
      write(join(home, ".nvm", "alias", "default"), alias + "\n");
      for (const [k, v] of Object.entries(extra)) write(join(home, ".nvm", "alias", k), v);
      for (const v of ["v18.0.0", "v20.11.0", "v20.2.0"])
        write(join(home, ".nvm", "versions", "node", v, "bin", "node"), "");
      const r = findNode(
        base({ home, run: (c) => (c.includes(home) ? c.split("/").slice(-3)[0] + "\n" : null) }),
      );
      expect(r.ok && r.path).toBe(
        join(
          home,
          ".nvm",
          "versions",
          "node",
          alias === "node" ? "v20.11.0" : "v20.11.0",
          "bin",
          "node",
        ),
      );
    }
  });

  it("INS-4 a hostile nvm alias is not followed out of the nvm directory", () => {
    const home = tmp();
    write(join(home, ".nvm", "alias", "default"), "../../../etc/passwd\n");
    write(join(home, ".nvm", "versions", "node", "v20.1.0", "bin", "node"), "");
    const asked: string[] = [];
    const r = findNode(base({ home, run: (c) => (asked.push(c), null) }));
    expect(r.ok).toBe(false);
    expect(asked.some((c) => c.includes("passwd"))).toBe(false);
  });

  describe.skipIf(!spawnTier())("with real scripts", () => {
    it("INS-4 a Node in a directory whose path has spaces is recorded as an absolute path", () => {
      const dir = join(tmp(), "my tools", "node dir");
      const p = fakeNode(dir, "v22.0.0");
      const r = findNode(base({ pathEnv: dir }));
      expect(r.ok && r.path).toBe(p);
      expect(r.ok && r.version).toBe("v22.0.0");
    });

    it("INS-4 Node 18 on PATH is refused, then a Node 20 later on PATH is used", () => {
      const old = fakeNode(join(tmp(), "old"), "v18.0.0");
      // The fixed fallback directories are real here, so a Node 20 in /usr/local/bin may answer:
      // what is checked is that the Node 18 on PATH is never the one chosen.
      const first = findNode(base({ pathEnv: join(old, "..") }));
      expect(first.ok && first.path === old).toBe(false);
      const good = fakeNode(join(tmp(), "good"), "v20.1.0");
      const r = findNode(base({ pathEnv: [join(old, ".."), join(good, "..")].join(delimiter) }));
      expect(r.ok && r.path).toBe(good);
    });

    it("INS-4 a file that is not executable or not a program is skipped", () => {
      const dir = tmp();
      const p = join(dir, "node");
      write(p, "#!/bin/sh\necho v22.0.0\n", 0o644);
      const r = findNode(base({ pathEnv: dir }));
      expect(r.ok && r.path === p).toBe(false);
      if (!r.ok) expect(r.tried.some((t) => t.startsWith(p))).toBe(false);
    });
  });
});
