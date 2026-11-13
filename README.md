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

Specification written; no code yet (2026-11-11). The specification is in [`docs/spec/`](docs/spec/):

| File | What it covers |
|---|---|
| [`01-overview.md`](docs/spec/01-overview.md) | Purpose, guarantees and limits, components, terms |
| [`02-engine.md`](docs/spec/02-engine.md) | Exactly what the engine does with text and rules |
| [`03-detectors.md`](docs/spec/03-detectors.md) | The default rule pack: every rule, validator and example |
| [`04-mcp-server.md`](docs/spec/04-mcp-server.md) | The MCP tools, their arguments and results, and the server's safeguards |
| [`05-testing.md`](docs/spec/05-testing.md) | How each part is tested, up to a real MosAIc |
| [`06-mosaic-integration.md`](docs/spec/06-mosaic-integration.md) | Installing into MosAIc, what MosAIc does that we rely on, and the path upstream |
| [`07-decisions-and-open-questions.md`](docs/spec/07-decisions-and-open-questions.md) | Decisions this specification makes, and what is still open |

## Layout (planned)

```
packages/core        the engine: a TypeScript library with no file, network or MosAIc access
packages/server      the MCP server, over stdio
packages/installer   registers the server in MosAIc; doctor; uninstall
rulepacks/           the default rule pack (data) and its JSON schema
profiles/            which action each category gets, per profile (data)
conformance/         example cases every engine build must pass
rigs/                test harnesses: a stdio MCP client, a fake model server, MosAIc end-to-end
config/              data the repository checks read, such as gitleaks' rules
docs/spec/           the specification
```

## Toolchain (planned)

TypeScript, Node.js 20 or newer, npm workspaces, vitest, and Playwright for the end-to-end tests
against MosAIc. The MCP SDK is pinned to the version MosAIc itself ships.

## Licence

Open source. The licence is chosen before the first release
([`07-decisions-and-open-questions.md`](docs/spec/07-decisions-and-open-questions.md)).
