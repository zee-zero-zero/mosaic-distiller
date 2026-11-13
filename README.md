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

Engine implemented; server not yet (2026-11-13). The engine, its default rule pack, its two
profiles and its conformance cases are in place and tested; the MCP server and the MosAIc installer
are still to come. The specification is in [`docs/spec/`](docs/spec/):

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
packages/server      (planned) the MCP server, over stdio
packages/installer   (planned) registers the server in MosAIc; doctor; uninstall
rulepacks/           the default rule pack (data) and its JSON schema
profiles/            which action each category gets, per profile (data)
conformance/         example cases every engine build must pass, and the runner's output
rigs/                (planned) test harnesses: a stdio MCP client, a fake model server, MosAIc end-to-end
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

## Toolchain

TypeScript in `strict` mode, Node.js 20 or newer, npm workspaces, vitest, ESLint and Prettier. The
MCP SDK, esbuild and Playwright arrive with the server and the end-to-end tests. See
[`AGENTS.md`](AGENTS.md) for the commands.

## Licence

Open source. The licence is chosen before the first release
([`07-decisions-and-open-questions.md`](docs/spec/07-decisions-and-open-questions.md)).
