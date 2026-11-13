# 6. Integration into MosAIc

This part covers how the distiller gets into a user's MosAIc Companion, what MosAIc does that the
design relies on, and the order in which integration moves from a local install towards MosAIc
itself. Source references are to `hypercycle-development/mosaic-companion` at commit `7af40c8`.

## 6.1 How MosAIc runs MCP servers

- **There is no catalogue for MCP servers.** MosAIc's reviewed, signed catalogue
  (`mosaic-open-platform`) is for add-ons only. Each user registers MCP servers in their own
  MosAIc (`docs/build-an-extension.md`).
- **Registration is one file.** MosAIc keeps its servers in `mcp-plugins.json`, in its settings
  directory: `~/.config/mosaic-companion/` on Linux, `~/Library/Application Support/mosaic-companion/`
  on macOS, `%APPDATA%\mosaic-companion\` on Windows. MosAIc's own example,
  `examples/mcp/mcp-hello`, registers itself by adding an entry to that file; the user then
  presses Refresh on the MCP page. A user can also add an entry by hand on the MCP page, by giving
  a command and its arguments, or the address of an HTTP server.
- **A server is a child process** started with the entry's command and arguments, speaking MCP
  over stdio, with MosAIc's whole environment plus the entry's `env` on top
  (`electron/integrations/mcp/MCPClient.ts:151-201`).
- **Tool calls time out after 60 seconds**, the MCP SDK's default, because MosAIc sets no
  timeout of its own (`MCPClient.ts:369-377`).
- **Only text content of a result is shown** (`MCPClient.ts:503-512`).
- **A result containing `__payment_required` opens MosAIc's payment flow**, whether the tool was
  called from chat or from an add-on (`src/services/ActionParser.ts:132-139`;
  `electron/addons/api/mcp.ts:17-71`). This is why every result is neutralised (§4.5).

## 6.2 Who in MosAIc can call the distiller

| Part of MosAIc | Can call it? | Evidence |
|---|---|---|
| One-to-one chat agents | Yes, as a tool call. Every agent sees every connected server's tools. | `src/services/ActionParser.ts:120`, `:177-199`; `src/components/Chatview.tsx:563-575` |
| Add-ons | Yes, with the `mcp:call` permission | `electron/addons/api/mcp.ts:53` |
| MosAIc's own code | Yes, through its MCP client | `electron/integrations/mcp/index.ts:147`, `:334` |
| The MCP page, by hand | Yes | `src/components/MCPPage.tsx:286` |
| Chat-room agents, MosaicBot, the IDE assistant | No. They get one text reply with no tool calls. | `chat/agent-runner.ts:94`; `mosaicbot/src/main/index.ts:127`, `:154`; `ide/AIAssistPanel.tsx:89` |
| WASM tools | No. They reach the host only through host functions. | `sandbox/wasm-launcher.ts:331` |

## 6.3 The installer

`packages/installer` is a command-line program, run once by the user: `npx <package> install`.

**`install`:**
1. Finds Node.js 20 or newer and records its **absolute path**. MosAIc launched from the macOS
   Finder may not see the shell's `PATH`, so a bare `node`, as MosAIc's own example writes, can
   fail there. Without a suitable Node, it stops with a message saying what to install.
2. Copies the server, with its rule pack and profiles, into a stable per-user directory, so that
   the entry does not point into a temporary npm cache:
   `~/.local/share/<package name>/server/` on Linux, `~/Library/Application Support/<package name>/server/`
   on macOS, `%LOCALAPPDATA%\<package name>\server\` on Windows.
3. Finds MosAIc's settings directory (§6.1) and edits `mcp-plugins.json`:
   - reads it; refuses to touch a file it cannot parse, and says so;
   - keeps every other entry byte for byte;
   - adds our entry, or replaces our older one, recognised by its `name`;
   - writes a backup, then writes to a temporary file and renames it over the original, so a
     crash leaves the old file or the new one, never half of one.
4. Tells the user to press Refresh on MosAIc's MCP page, or to restart MosAIc.

Our entry:

```json
{"id": "<fixed UUID of this package>",
 "name": "distiller",
 "description": "Replaces sensitive values in text with fake ones",
 "transport": "stdio",
 "command": "/absolute/path/to/node",
 "args": ["/absolute/path/to/server/index.js"],
 "env": {"NODE_OPTIONS": "", "NODE_PATH": ""},
 "autoConnect": true}
```

The `env` blanks two variables that Node applies before any of our code runs (§4.5). MosAIc
applies the entry's `env` over its own environment.

**`doctor`** checks, and prints the fix for each failure: that the entry exists and points at
files that exist; that the recorded Node runs and is new enough; that the server starts and lists
its tools; that the rule pack loads; and which MosAIc version is installed.

**`uninstall`** removes our entry, keeping every other entry byte for byte, and removes our
installed copy. It removes our data directory only after asking.

**Installing by hand** is also documented, for users who prefer it: on MosAIc's MCP page, a stdio
server with command `npx` and arguments `-y <package>@<version> serve`. The README states its two
costs: it depends on `npx` being on the `PATH` MosAIc sees, and it does not blank `NODE_OPTIONS`.

## 6.4 Stages of integration

Each stage starts only when the one before it is done.

**Stage 1: local.** The server, the installer and the tests of §5, up to and including the MosAIc
end-to-end suite and the manual tests. Users install it themselves with the installer. Exit:
every automated tier passes, and MAN-1 and MAN-2 have been answered.

**Stage 2: a public example in MosAIc's repository.** A pull request to `mosaic-companion`
adding, under `examples/`, a short example of calling the distiller from an add-on and from a chat
agent. Documentation only; no change to MosAIc's code. MosAIc's contribution guide asks for an
issue first for anything beyond small fixes, so an issue comes first.

**Stage 3: bundling, only if invited.** MosAIc can ship a server inside itself, as it does its own
plugins, but that needs a line in MosAIc's main process (`electron/main.ts`), which is a change to
MosAIc's core. MosAIc's maintainers steer features out of the core. So this starts as an issue
proposing it, and the distiller never depends on it happening.

**Stage 4: issues for the MosAIc team.** These are MosAIc behaviours that weaken what the distiller
can promise. Each is filed as an issue with its evidence, not fixed by us in MosAIc's core:
- MCP servers inherit MosAIc's whole environment, including provider keys. Ask for a minimal
  environment by default.
- Chat history stores tool arguments and results in full, and resends them to whichever provider
  the agent uses next. Ask for a way for a tool to keep its arguments out of history, or at least
  a visible mark on such sessions.
- Every chat agent sees every tool of every server. Ask for per-agent tool lists; a community pull
  request (#166) proposes per-agent tool filtering.
- Tool results are scanned for MosAIc's own markup and payment signals. Ask for that scan to be
  limited to servers the user has allowed to request payment.

## 6.5 What users must be told

The README and the tool description say, in plain words:
- what the distiller replaces and what it does not (§1.2);
- that replaced values become fakes, such as `person1@example.com`, that are not real;
- that it is not anonymisation;
- that when a chat agent calls it, the original text is already in that chat, and the call's
  arguments are stored in the chat history (QRK-5). The distiller protects what is passed on after
  it. To keep text out of a chat entirely, distil it first from the MCP page or an add-on, and
  paste the distillate into the chat.
