# 4. The MCP server

`packages/server` exposes the engine as an MCP server. It is started by MosAIc, or by any MCP
client, as a child process, and speaks MCP over stdio. It has two tools, `distill` and
`capabilities`.

## 4.1 Process and transport

- **Runtime:** Node.js 20 or newer.
- **Transport:** stdio. Stdout carries only MCP protocol messages, nothing else, ever.
- **MCP SDK:** `@modelcontextprotocol/sdk`, pinned to the version MosAIc ships, so the two sides
  agree on the protocol. At MosAIc commit `7af40c8` that is `^1.27.0`, resolving to 1.28.0.
- **Start-up:** scrub the environment (§4.5), load and verify the rule pack and profiles from the
  directory of the running file, start the engine worker (§4.5), then connect the transport. If the
  pack or a profile is refused (§2.2), write one line to stderr, `DISTILLER_START_FAILED <code>`,
  where `<code>` is the loader's code, and exit with status 2, before connecting. A pack or profile
  file that is missing or is not JSON gives `PACK_SCHEMA` or `PROFILE_SCHEMA`; so does a missing
  profile named `agent`, the default. Nothing else is ever written to stderr.
- **Shutdown:** when stdin closes, exit within 2 seconds.
- **No network, no files read except our own.** The server reads its rule pack and profiles from
  its own installation directory, and writes its log to its own data directory (§4.5). It opens no
  socket.

## 4.2 Tool `distill`

**Arguments** (a JSON object):

| Argument | Type | Required | Meaning |
|---|---|---|---|
| `text` | string | one of `text` and `segments` | The text to distil, as one segment with id `"1"`. The simple form, for chat agents. |
| `segments` | array of `{id, text, kind?}` | one of `text` and `segments` | Several pieces of text, each kept apart. `kind` is a free label, such as `"email"` or `"document"`, recorded nowhere and reserved for later modes. |
| `dictionaries` | array of `{name, terms[], template?}` | no | The caller's own sensitive words. `name` is 1 to 32 characters of `[a-z0-9_]`; `template` must contain `{n}` and defaults to `Term {n}`. |
| `objective` | `{kind, task?}` | no | What the distillate is for. `kind` is `store`, `forward` or `task`; default `forward`. In `rules` mode it changes nothing in the output; it is accepted now so that a later mode can use it without changing the interface. It is never echoed back. |
| `profile` | `"agent"` or `"document"` | no | §2.7. Default `agent`. |
| `mode` | `"rules"` | no | Default `rules`. Any other value is refused with `UNSUPPORTED_MODE`. |

Giving both `text` and `segments`, or neither, is refused with `INVALID_ARGUMENTS`. Unknown
argument names are refused too, so that a misspelt `dictionaries` is not silently ignored.

**Result.** One MCP text content block holding the engine's result (§2.10) as JSON. MosAIc
renders only text content, so nothing is put in other content types. On a refusal the result has
`isError: true` and the text holds `{"error": {"code": "<CODE>", "message": "<fixed text>"}}`.
The message is fixed per code and never quotes input.

**Error codes:** `INVALID_ARGUMENTS`, `EMPTY_INPUT`, `DUPLICATE_SEGMENT_ID`, `TOO_MANY_SEGMENTS`,
`INPUT_TOO_LARGE`, `TOO_MANY_DICTIONARIES`, `TOO_MANY_TERMS`, `TERM_TOO_SHORT`, `TERM_TOO_LONG`,
`UNKNOWN_PROFILE`, `UNSUPPORTED_MODE`, `RESULT_TOO_LARGE`, `DEADLINE`, `INTERNAL`.

**Description** (what every chat agent in MosAIc reads; 535 characters):

> Replaces sensitive values in text with fake ones before the text is shared: secrets and API
> keys, e-mail addresses, North American phone numbers, card numbers, IBANs, national ID numbers,
> IP addresses, and any words in `dictionaries`. Pass the user's text unchanged as `text`. Show
> the user the returned distillate, not the original. Replaced values become realistic fakes such
> as person1@example.com; they are not real. It removes known sensitive shapes and listed terms
> only: it does not find unlisted names and is not anonymisation.

## 4.3 Tool `capabilities`

**Arguments:** none. Any argument is ignored.

**Result:** JSON text holding:
- `modes`: `["rules"]`;
- `profiles`: `{"names": [...], "default": "agent"}`, the built-in profile names in code-point
  order and the default;
- `rulepack`: `{name, version, hash}`;
- `engine`: `{name, version, unicode}`;
- `categories`: an object from every category the rule pack can report to its class, so that a
  user interface can label each one. The caller's own dictionaries are not in it;
- `limits`: the values of §2.11, as `segments`, `segment_id_length`, `total_bytes`,
  `dictionaries`, `terms` and `term_length`;
- `certified`: `false`.

**Description** (152 characters):

> Reports what the distiller can do: its modes, profiles, rule-pack version and the categories it
> detects. Call it before relying on a mode or a category.

## 4.4 Rules for every tool description

Every chat agent in MosAIc receives the name, description and argument schema of every tool of
every connected server in its system prompt. A description is therefore a prompt, read by models
we do not choose, and it costs every agent's context. So each description:
- is at most 600 characters;
- makes no claim beyond §1.2, and never uses "anonymise", "anonymous", "isolated" or "isolation"
  except to deny them;
- names no company, project or product behind this work (§5.9);
- uses only argument names that exist, and any example in it validates against the schema.

## 4.5 Safeguards

**The environment is scrubbed at start.** MosAIc starts each MCP server with its whole
environment, which can include the user's API keys for every model provider. Before doing
anything else, the server deletes every variable not on this allow-list: `PATH`, `HOME`,
`USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `TMPDIR`, `TEMP`,
`TMP`, `SystemRoot`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, and our own `DISTILLER_*`.

Two variables act before any of our code runs and cannot be undone this way: `NODE_OPTIONS`,
which can make Node load extra code, and `NODE_PATH`, which changes where modules are found. The
installer therefore sets both to empty strings in the server's MosAIc entry (§6.3), which MosAIc
applies over its own environment.

**Every result is neutralised.** Every text the server returns, results and error messages alike,
passes through one function, the one that builds a tool result. It replaces `<use_tool` with
`[neutralised: use_tool]`, `<mosaic_ui` with `[neutralised: mosaic_ui]` and `__payment_required`
with `[neutralised: payment_required]`, in any case of letters. None of these contains a quote or a
backslash, so a JSON text stays valid JSON; and where the payment key was written between quotes,
the quotes stay, so that the text no longer holds `"__payment_required"`. MosAIc acts on these when
they appear in a tool result: the first two as markup, the last as a request to open a payment
screen. The engine already neutralises them in distillates; this second pass covers every other
path. One such path is a dictionary named `__payment_required`, whose category appears in the
result, and another is a segment id that is that word: the id comes back neutralised, and so is not
the id that was sent. The environment scrub is the first import of the entry, because a module is
evaluated after the modules it imports, in order.

**No content in logs.** Log events are codes and counts. They never hold a string taken from
input: no text, no term, no segment id, no dictionary name. The log is written to the server's
data directory, never to stdout, which carries the protocol. Stderr carries only fixed start-up
failure codes.

**A deadline per call.** Every tool call finishes within 20 seconds or returns `DEADLINE`. MosAIc
gives up on a tool call after 60 seconds; the margin leaves room for MosAIc's own work. The server
stays up after a deadline and answers the next call. The engine is synchronous and cannot be
stopped inside its own thread, so it runs in a `worker_threads` worker that is the same file as the
server. One call runs at a time; the others wait in a queue. Each call's 20 seconds start when the
server receives it. When the running call passes its deadline, the server terminates the worker,
starts a new one and answers `DEADLINE`; calls still waiting go to the new worker. A call that is
still waiting at its own deadline is answered `DEADLINE` and dropped, and the worker is left alone.

**A cap on result size.** A result larger than 4 MiB of JSON text is refused with
`RESULT_TOO_LARGE`. Within the input limits of §2.11 this should not happen; the cap is a guard.

**Concurrent calls.** The server answers concurrent calls, each with its own result. The engine
holds no state between requests.

## 4.6 Data directory

The server's own directory, per operating system, holds its log, `distiller.log` and its older
copy `distiller.log.1`, and, once the installer has run, the installed copy of the server in
`server/` (§6.3):
- Linux: `$XDG_DATA_HOME/<package name>/`, or `~/.local/share/<package name>/`;
- macOS: `~/Library/Application Support/<package name>/`;
- Windows: `%LOCALAPPDATA%\<package name>\`.

The directory is created with owner-only permissions. The log rotates at 1 MiB, keeping two files.
