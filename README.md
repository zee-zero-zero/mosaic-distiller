# mosaic-distiller

A distiller for MosAIc Companion: a local MCP server that removes known kinds of sensitive data
from text before that text is passed on.

You give it text and, optionally, a list of your own sensitive words. It returns the same text
with secrets, structured personal identifiers and your listed words replaced by realistic fake
values that can never be real, such as `person1@example.com` or `(202) 555-0101`. It also returns
a list of what it replaced: the kind of value, the rule that matched and the position. The removed
values themselves are never in that list. It flags text that looks like an attempt to instruct an
AI, and removes invisible characters.

It runs entirely on the user's machine. It has no network access, reads no files, and needs no
key or account.

**What it does not do.** It uses fixed rules, not a language model. It does not find names unless
they are on your list. It does not find facts that identify someone only in combination. It does
not decide what is relevant. It is not anonymisation, and must never be described as such.

## Status

Engine, server and installer implemented (2026-11-13). The engine, its default rule pack, its two
profiles and its conformance cases; the MCP server with its two tools; and the installer that
registers the server in MosAIc are in place and tested. Not yet done: the test inside a real MosAIc
(the end-to-end rig), and the manual checks on macOS and Windows. The specification is in
[`docs/spec/`](docs/spec/):

| File | What it covers |
|---|---|
| [`01-overview.md`](docs/spec/01-overview.md) | Purpose, guarantees and limits, components, terms |
| [`02-engine.md`](docs/spec/02-engine.md) | Exactly what the engine does with text and rules |
| [`03-detectors.md`](docs/spec/03-detectors.md) | The default rule pack: every rule, validator and example |
| [`04-mcp-server.md`](docs/spec/04-mcp-server.md) | The MCP tools, their arguments and results, and the server's safeguards |
| [`05-testing.md`](docs/spec/05-testing.md) | How each part is tested, up to a real MosAIc |
| [`06-mosaic-integration.md`](docs/spec/06-mosaic-integration.md) | Installing into MosAIc, what MosAIc does that we rely on, and the path upstream |
| [`07-decisions-and-open-questions.md`](docs/spec/07-decisions-and-open-questions.md) | Decisions this specification makes, and what is still open |

## Layout

What exists today is marked; the rest is planned.

```
packages/core        the engine: a TypeScript library with no file, network or MosAIc access
packages/server      the MCP server, over stdio, bundled into one file by `npm run build`
packages/installer   registers the server in MosAIc; doctor; uninstall; serve
rulepacks/           the default rule pack (data) and its JSON schema
profiles/            which action each category gets, per profile (data)
conformance/         example cases every engine build must pass, and the runner's output
rigs/mcp-harness     the stdio test harness: starts a server the way MosAIc does and talks to it
rigs/                (planned) a fake model server, MosAIc end-to-end
config/              data the repository checks read: gitleaks' rules, with their licence notice
scripts/             the tier runner, the conformance runner, the seeded-defect run, repository checks
docs/spec/           the specification
docs/seeded-defects.md  the table of seeded defects, written by `npm run test:seeded`
```

## Using the engine as a library

`packages/core` is a pure TypeScript library: text and a rule pack in, a distillate and the records
of what was replaced out. It reads no file and uses no clock, network or locale; the caller loads
the pack and the profiles.

```ts
import { readFileSync } from "node:fs";
import { createEngine, loadProfile, loadRulePack, serializeResult } from "@mosaic-distiller/core";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const pack = loadRulePack(json("rulepacks/default.json")); // throws RulePackError { code } if refused
const profiles = ["agent", "document"].map((n) => loadProfile(json(`profiles/${n}.json`), pack));
const engine = createEngine({ pack, profiles, defaultProfile: "agent" });

const result = engine.distill({
  segments: [{ id: "1", text: "Write to jane.doe@northwind-mail.com." }],
  dictionaries: [{ name: "clients", terms: ["Northwind"] }], // optional: your own sensitive words
});
console.log(serializeResult(result)); // compact JSON, keys in a fixed order
// {"mode":"rules","segments":[{"id":"1","distillate":"Write to person1@example.com."}], ...}
```

`engine.distill` returns a result, or a refusal `{error: {code, message}}` whose message is fixed
and never quotes the input. `engine.capabilities()` reports the modes, profiles, pack version and
hash, categories and limits. The same input, rule pack and profile give the same bytes on every
machine. Positions in the records are Unicode code points, not UTF-16 units.

## Install into MosAIc

You need Node.js 20 or newer, and a clone of this repository. Build once, then run the installer:

```sh
npm ci && npm run build
node packages/installer/dist/cli.mjs install
```

`install` finds Node.js and records its absolute path, copies the server into a stable directory of
your own (`~/.local/share/mosaic-distiller/server/` on Linux, `~/Library/Application Support/mosaic-distiller/server/`
on macOS, `%LOCALAPPDATA%\mosaic-distiller\server\` on Windows), and adds one entry named
`distiller` to MosAIc's `mcp-plugins.json`. Every other entry in that file is kept byte for byte, a
backup `mcp-plugins.json.bak` is written first, and a file it cannot read as a JSON array is left
untouched. Running it again gives the same result. It prints `Added the "distiller" entry`, or
`Updated` when an older entry of ours was there.

Then open MosAIc's MCP page and press Refresh (or restart MosAIc). `distiller` appears with two
tools, `distill` and `capabilities`.

To check the installation, run `doctor`. It checks that the entry exists and points at files that
exist, that the recorded Node.js runs and is new enough, that the server starts and lists its tools,
and that the rule pack loads, and it prints the fix for each failure. It ends with
`all checks passed` when everything is in order. MosAIc's version is reported as "unknown": nothing
on disk says which version is installed.

```sh
node packages/installer/dist/cli.mjs doctor
```

To remove it, run `uninstall`. It removes our entry and our installed copy. It asks before it
removes the data directory, which holds only the log; with no answer it keeps it, and `--yes`
removes it without asking.

```sh
node packages/installer/dist/cli.mjs uninstall
node packages/installer/dist/cli.mjs uninstall --yes
```

**Installing by hand.** On MosAIc's MCP page, add a stdio server with command `npx` and arguments
`-y <package>@<version> serve`, once the package is published. It has two costs: it depends on
`npx` being on the `PATH` that MosAIc sees (a MosAIc started from the macOS Finder may not see the
shell's), and it does not blank `NODE_OPTIONS` and `NODE_PATH` as the installer's entry does, so
those two variables, if set, still act on the server before it can scrub them.

## What it does and does not do

- It replaces known sensitive shapes (secrets and API keys, e-mail addresses, North American phone
  numbers, card numbers, IBANs, national ID numbers, IP addresses) and the words you list. The
  replacements are realistic fakes, such as `person1@example.com`, that are not real.
- It does not find names or facts that are not on your list, and it is not anonymisation.
- **When a chat agent calls it, the original text is already in that chat.** MosAIc stores a tool
  call's arguments in the chat history, so the text you give an agent to distil is there in full,
  and the distiller protects only what is passed on after it. To keep text out of a chat
  entirely, distil it first from the MCP page or from an add-on, and paste the distillate into the
  chat.
- The server deletes every environment variable it does not need at start, so it never holds the
  provider keys that MosAIc passes to every server. It writes a log that holds only codes and
  numbers, never text. It has no network access.

## Toolchain

TypeScript in `strict` mode, Node.js 20 or newer, npm workspaces, vitest, ESLint and Prettier, the
MCP SDK (pinned to 1.28.0, the version MosAIc resolves) and esbuild. Playwright arrives with the
end-to-end tests. See [`AGENTS.md`](AGENTS.md) for the commands.

## Licence

Open source. The licence is chosen before the first release
([`07-decisions-and-open-questions.md`](docs/spec/07-decisions-and-open-questions.md)).
