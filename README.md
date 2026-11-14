# ai-distiller

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

Stage 1 is implemented and its automated tests pass, including the end-to-end tests that run the
server inside a real MosAIc (2026-11-14).

**Implemented**

- **The engine** (`packages/core`): a rule-based distiller with a default rule pack of 72 rules in
  57 categories. They cover secrets and API keys, e-mail addresses, North American phone numbers,
  payment cards, IBANs, crypto addresses, IP and MAC addresses, vehicle identification numbers, postal codes, and
  national ID, tax and business numbers of more than twenty countries, each checked by its own
  validator where the issuer defines one. It also flags text that looks like an attempt to instruct
  an AI, and deletes invisible characters. Rules are listed one by one, with examples, in
  [`03-detectors.md`](docs/spec/03-detectors.md).
- **Your own words**: lists of terms (client names, project names, contacts) sent with each request
  and replaced by numbered fakes such as `Term 1`.
- **Two profiles**, `agent` and `document`, which decide per category whether a hit is replaced,
  only flagged, or neutralised.
- **The MCP server** (`packages/server`) with two tools, `distill` and `capabilities`, over stdio,
  with its safeguards: scrubbed environment, a deadline per call, no content in logs.
- **The installer** (`packages/installer`): `install`, `doctor` and `uninstall` for MosAIc.
- **The test rigs**: a stdio harness, a scripted fake model, and a real MosAIc built at a pinned
  commit and driven by Playwright.

**Not done**

- **Summarising.** See the next section.
- **Two manual checks**: a real model calling the tool (MAN-1), and the installer on packaged
  MosAIc for macOS and Windows (MAN-2).
- **Phone numbers outside North America**, and names that are not on your list. Both are left out
  on purpose; the reasons are in [`03-detectors.md`](docs/spec/03-detectors.md) §3.6. Foreign
  numbers would take their lengths and prefixes from libphonenumber's metadata (Apache-2.0) as data.
- **A public conformance suite.** None exists for this kind of distiller, so every result says
  `certified: false` (`05-testing.md` §5.5).
- A published package. The installer works from a clone of this repository.

## Summarising is not done

The distiller has one mode, `rules`. A second mode that summarises text with a language model, so
that less is passed on and not only a cleaned copy, is **not built, and not specified**.

The reason is that it is not yet clear where the distiller would get access to a model. It runs on
the user's machine with no network access and no keys: the server deletes every provider key that
MosAIc passes it, on purpose. A summariser needs a model API to call, and that decision has not been
made. **We are waiting for an LLM API before we do the summarising part.**

What exists is only room in the interface. `distill` already accepts `mode` and `objective`
(`store`, `forward` or `task`), but `mode` accepts only `rules`, anything else is refused with
`UNSUPPORTED_MODE`, and `objective` changes nothing in the output. Nothing in the repository calls
a model.

The specification is in [`docs/spec/`](docs/spec/):

| File | What it covers |
|---|---|
| [`01-overview.md`](docs/spec/01-overview.md) | Purpose, guarantees and limits, components, terms |
| [`02-engine.md`](docs/spec/02-engine.md) | Exactly what the engine does with text and rules |
| [`03-detectors.md`](docs/spec/03-detectors.md) | The default rule pack: every rule, validator and example |
| [`04-mcp-server.md`](docs/spec/04-mcp-server.md) | The MCP tools, their arguments and results, and the server's safeguards |
| [`05-testing.md`](docs/spec/05-testing.md) | How each part is tested, up to a real MosAIc |
| [`06-mosaic-integration.md`](docs/spec/06-mosaic-integration.md) | Installing into MosAIc, what MosAIc does that we rely on, and the path upstream |

## Layout

```
packages/core        the engine: a TypeScript library with no file, network or MosAIc access
packages/server      the MCP server, over stdio, bundled into one file by `npm run build`
packages/installer   registers the server in MosAIc; doctor; uninstall; serve
rulepacks/           the default rule pack (data) and its JSON schema
profiles/            which action each category gets, per profile (data)
conformance/         example cases every engine build must pass, and the runner's output
rigs/mcp-harness     the stdio test harness: starts a server the way MosAIc does and talks to it
rigs/fake-model      a scripted server that speaks Ollama's API, so a MosAIc chat agent runs for free
rigs/e2e             MosAIc built at a pinned commit and driven by Playwright: the MOS and QRK cases
docs/upstream/       drafts of the issues and the pull request for MosAIc's maintainers (not sent)
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
your own (`~/.local/share/ai-distiller/server/` on Linux, `~/Library/Application Support/ai-distiller/server/`
on macOS, `%LOCALAPPDATA%\ai-distiller\server\` on Windows), and adds one entry named
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

## See it run

**In MosAIc.** After `install` and a Refresh, open the MCP page: `distiller` is listed with its two
tools, and you can call `distill` from there with a `text` argument. Or ask a chat agent to
distil a text; it sees the tool's description and calls it. Either way the result is JSON with the
`distillate`, the list of `removals` (category, rule, position and the fake that replaced the
value, never the value) and `findings`.

**Without MosAIc.** The server speaks MCP over stdio, so any MCP client can start it. After
`npm run build`, this sends one request by hand:

```sh
cd packages/server/dist
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"distill","arguments":{"text":"Mail jane.doe@northwind-mail.com"}}}' \
  | XDG_DATA_HOME=$(mktemp -d) node server.mjs
```

The second line of output holds the distillate `Mail person1@example.com`. (`XDG_DATA_HOME`
keeps the log out of your real data directory.)

**As a library.** See the next section.

**The tests.** `npm run test:quick` takes about a minute; `npm run test:local` also starts the real
server and installer; `npm run test:e2e` runs a real MosAIc and needs a display (or `xvfb-run`).
[`AGENTS.md`](AGENTS.md) lists every command.

## Turning distillation on and off

There is no on/off switch inside the server: it distils every call it gets. What you control is
which categories are replaced, and whether the server is connected at all.

| To do this | Do this |
|---|---|
| Stop MosAIc using the distiller | `uninstall`, or remove the `distiller` entry on MosAIc's MCP page. `install` brings it back. |
| Distil text about prompts and chats without its role labels and template tokens being treated as attacks | Pass `"profile": "document"` in the call. The default is `agent`. |
| Add your own sensitive words for one call | Pass `dictionaries`: `[{"name": "clients", "terms": ["Northwind"]}]`. Names are 1 to 32 characters of `[a-z0-9_]`, and a term needs at least two characters. |
| Keep a category in the text, but have it reported | Edit the profile (below): set the category to `flag`. The text is unchanged and the hit is in `findings`. |
| Turn a category off completely | Delete its rule from `rulepacks/default.json` (below). No profile action means "ignore". |

**Changing a profile.** A profile is a small file, `profiles/agent.json` or `profiles/document.json`,
that maps a category (`network.ipv4`) or a category with a variant (`network.ipv4/private`) to an
action: `redact` (replace with a fake), `flag` (keep and report), `neutralise` (replace with
`[neutralised: <category>]`) or `block` (refuse the whole request). A category the profile does not
name keeps its rule's own action. So this keeps e-mail addresses in the text of the `document`
profile and still reports them:

```json
{"format": "profile/1", "name": "document", "actions": {"contact.email": "flag"}}
```

(Add that key to the `actions` that the file already has; do not replace them.) A category must be
declared in the rule pack, and a value must be one of the four actions, or the server refuses to
start. The server reads profiles at start, so rebuild, run `install` again, and Refresh. Be careful
with `flag` on a `secret.*` or personal-data category: the value then goes on, unchanged.

A new profile *name* is not yet possible without a code change, because the tool's `profile`
argument lists the two built-in names (`packages/server/src/tools.ts`, §4.2).

## Adding detectors

Three levels, from cheapest to most work.

**1. Your own words, per call.** Pass `dictionaries` as above. No change to the repository.

**2. A rule in the rule pack.** A rule is data in `rulepacks/default.json`; no code changes. Two
kinds exist: a `terms` rule (a fixed list of words that always applies) and a `pattern` rule. This
one finds employee numbers written `EMP-` and six digits, and replaces each with a shape-preserving
fake (`XXX-000001`):

```json
"categories": { "org_id.employee": { "class": "medium", "surrogate": "shape" } }
```
```json
{"id": "org_id.employee", "category": "org_id.employee", "kind": "pattern",
 "pattern": "EMP-[0-9]{6}", "flags": "", "edges": "word", "validators": [], "action": "redact"}
```

The first goes in the pack's `categories`, the second in its `rules`. A pattern is limited to a
portable subset so that every engine reads it the same way and hostile input stays fast: ASCII
character classes only (`[0-9]`, never `\d`), every repetition bounded (`{1,9}`, never `*` or `+`),
no lookaround or backreferences, and at most one capture group, whose text is the part that is
replaced. `edges` says what may not touch the match (`word`, `numeric`, `word_before`,
`word_colon`, `none`). `validators` name checks from a fixed list, such as `luhn`, that a match must
also pass. [`02-engine.md`](docs/spec/02-engine.md) §2.2 and §2.4 give the rules in full; a pack
that breaks one is refused, with a code, when the server starts.

Then, in the same commit, because the specification is authoritative:
1. Describe the rule in [`03-detectors.md`](docs/spec/03-detectors.md), with examples it must hit,
   examples it must not hit, and its residual risk. Precision comes first: a rule is included only
   if a match is close to certain from the value alone (§3.1).
2. Add those examples to `conformance/rules.jsonl`, and run `npm run conformance`.
3. Run `npm run test:quick`. Tests that record the rule pack's hash or the golden results will fail
   until you regenerate `conformance/golden.jsonl` with `npx tsx scripts/golden-regen.ts` and read
   the difference against the specification.
4. `npm run build`, then `install` again, then Refresh. The installer copies the rule pack next to
   the server, and the server loads it at start.

Use only invented or documentation-range values in examples and tests, never real personal data.

**3. A new validator (a checksum or a structural check).** A validator is code: add it under
`packages/core/src/validators/`, register it in `index.ts`, describe it in
[`03-detectors.md`](docs/spec/03-detectors.md) §3.5, and test it with valid and invalid values
(`05-testing.md`). A validator must not read the clock, the locale or the machine, so that the
output stays the same everywhere.

## Toolchain

TypeScript in `strict` mode, Node.js 20 or newer, npm workspaces, vitest, ESLint and Prettier, the
MCP SDK (pinned to 1.28.0, the version MosAIc resolves) and esbuild. Playwright (1.58.2, MosAIc's version) drives the
end-to-end tests. See [`AGENTS.md`](AGENTS.md) for the commands.

## Licence

Apache-2.0, the same licence as MosAIc. See [`LICENSE`](LICENSE). The copyright holder line is
added before the first release.
