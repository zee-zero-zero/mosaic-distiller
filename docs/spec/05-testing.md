# 5. Testing

This part says how each piece is tested: the engine on its own, the server over stdio, the
installer, and finally the whole thing inside a real MosAIc. Case ids are stable; a case keeps its
id when it is changed, and a removed id is not reused.

## 5.1 Principles

- **Tests first.** A mechanism's tests are written before or with its code, never after.
- **Every mechanism has a direct test.** A mechanism is a part whose behaviour this
  specification states: the normaliser, each validator, the edge check, the scan, term folding,
  overlap resolution, fake allocation, each safeguard. Testing it only through the whole engine
  is not enough.
- **About a third of each mechanism's cases are adversarial**: inputs built to break it, not to
  confirm it. The rest are abstract (generated over a space of inputs, with a property checked)
  or confirmatory (one typical case). Each case table says which kind each case is.
- **Seeded defects.** For each core mechanism, the tests are run once against a copy of the code
  with that mechanism disabled, and must fail. The results are kept in a table, so a test that
  could never fail is caught.
- **Pools have guards.** A generated pool of inputs comes with a test that fails if the pool loses
  its hostile members, so the pool cannot quietly drift towards easy cases.
- **No clock, network or real data.** No test depends on the date, the network or the machine.
  Generators take a fixed seed. Test values are documentation values, generated synthetic values,
  or the examples of §3.
- **Budgets.** Each tier has a time budget (§5.2), and every case runs inside it.

## 5.2 Tiers

| Tier | What runs | Budget | When |
|---|---|---|---|
| quick | Unit tests of every package, with a fixed seeded sample of each pool; repository checks (§5.9) | 60 seconds for the whole repository | every save; every push |
| local | The server over stdio (§5.6); installer tests that start processes (§5.7); the full pools of the packages a change touches | within 15 minutes | before every commit |
| CI | `pools-full` (every pool in full); `e2e-mosaic` (§5.8, against a real MosAIc under a virtual display); `quirks-mosaic` (§5.8) | — | every merge; `quirks-mosaic` also on each new MosAIc release |
| manual | §5.10 | each case states its own | once per release, after every automated tier passes |

## 5.3 The engine (`packages/core`)

**The segment pool.** About 200 generated segments, each with sensitive values planted at known
positions by the generator: every category; several categories mixed; none at all; values
adjacent to each other; values at the very start and end of a segment; text in non-Latin scripts;
invisible characters inside values. Because the generator planted the values, the expected spans
are known without asking the engine. The guard (ENG-2) fails if any of those kinds of member is
missing.

| Id | Case | Kind | Input → expected |
|---|---|---|---|
| ENG-1 | Nothing a rule matched survives | abstract | Every pool member → running the engine again on its distillate finds nothing it replaced, and every planted value is gone |
| ENG-2 | The pool keeps its hostile members | guard | Fails if any kind of member listed above is missing |
| ENG-3 | Records hold no removed text | abstract | Over the pool, no field of any removal or finding contains any 4-character substring of a removed value that carries content: one holding a letter or a digit other than `0`, `X` and `x`. A run of separators (`<<<<` in a machine-readable zone) or of filler is the shape that a shape-preserving fake keeps (§2.8), not removed text. The pool's values are chosen so that no value shares such a substring with its own fake or with a rule id |
| ENG-4 | Values hidden by invisible characters are found | adversarial | `al​ice@northwind-mail.com` with a zero-width space; a soft hyphen inside an IBAN; a zero-width joiner inside `536-22-8914` → each removed, over its whole original range |
| ENG-5 | Positions map back exactly | abstract | Random invisible characters inserted into planted values → each removal's `start` and `end` cover the planted value and the inserted characters |
| ENG-6 | Positions are code points | adversarial | An emoji, a Scottish-flag tag sequence and a CJK character before each value → every `start` and `end` counts code points; the flag survives in the distillate |
| ENG-7 | Overlaps resolve as §2.6 says | adversarial | A credential URL containing an e-mail address; an `Authorization: Bearer` header; two touching values of different categories; a tie in length → one span each, of the category §2.6 names |
| ENG-8 | Same value, same fake | adversarial | One e-mail address in two segments, once in upper case → the same fake; two different addresses → `person1@…` and `person2@…`; `536-22-8914` written twice → one fake |
| ENG-9 | Fakes skip taken and caught values | adversarial | Input already holding `person1@example.com` and `000-00-0001`; a category whose first fakes another rule would hit → the next free n each time |
| ENG-10 | Running twice changes nothing | abstract | Over the pool, distilling a distillate gives the same distillate and no removals |
| ENG-11 | Edges | adversarial | `536-22-8914` inside `1-536-22-8914-2`; `ghp_` plus 36 letters then `_x`; `1.3.6.1.4.1`; `icon@2x.png` → no hit in each |
| ENG-12 | The scan restarts one code point after a rejection | adversarial | A rejected match followed one character later by a valid one → the valid one found |
| ENG-13 | Line starts | adversarial | `Human: ` after `\n`, after `\r\n`, after a lone `\r`, and after U+2028 → a finding after `\n` and `\r\n` only |
| ENG-14 | Term folding and boundaries | adversarial | Term `Ștefan` against `ŞTEFAN`, `Stefan`, `stefan.p@northwind-mail.com` and `/home/stefan/`; term `Ana` against `Banana` and `Ана`; two terms sharing a prefix → found ×4; not found ×2; the longer term wins |
| ENG-15 | Terms are literals | adversarial | Terms `a.b`, `(x)`, `[0-9]{3}`, `\\` (two backslashes: a term of one code point is refused, §2.5) → each matches only itself |
| ENG-16 | Actions and profiles | abstract | Every category × every action, and both built-in profiles: `redact` → a fake; `flag` → kept, with a finding; `neutralise` → the marker; `block` → no distillate, only the reason; the MosAIc literals → neutralised under every profile |
| ENG-17 | Invisible characters | adversarial | Each "removed" character → deleted and reported once per run; each "kept" character (a Persian joiner, an emoji joiner, a leading byte-order mark, the flag of Wales) → kept |
| ENG-18 | The distillate is not normalised | adversarial | Full-width digits and a `ﬁ` ligature outside any value → unchanged in the distillate |
| ENG-19 | Structural limits | adversarial | No segments → `EMPTY_INPUT`; an empty text → an empty distillate; duplicate ids → `DUPLICATE_SEGMENT_ID`; a lone surrogate → replaced, with `LONE_SURROGATE`; each limit of §2.11 at the limit → passes, and one over → refused with no partial result |
| ENG-20 | Large and hostile input stays fast | adversarial | 1 MB dense with matches → under 2 seconds; for each pattern, an input of 32 KiB built to make it backtrack (the hit repeated and glued, the hit minus its last character repeated, half of it repeated, its first character repeated) → under 100 ms. In the quick tier the dense input is 64 KiB |
| ENG-21 | Output is deterministic | abstract | The pool run twice, with rules, dictionaries and terms shuffled → identical bytes |
| ENG-22 | Counters | adversarial | No match → `evaluated` equals segments for every rule and `fired` is 0; one e-mail → that rule's `fired` is 1; a rejected edge and a rejected checksum → counted where §2.10 says |
| ENG-23 | The loader refuses bad packs | adversarial | Each refusal of §2.2 → its own code, and no engine is built: unknown kind, validator, action, flag or edge; a lookbehind, `\d`, `+`, two groups; a duplicate id; an undeclared category; a one-letter term; no rules; a category with no usable fake |
| ENG-24 | The pack hash | abstract | Each field of each rule changed → a different hash; rules reordered → the same hash; a known pack → a known hash, computed independently |
| ENG-25 | A typical paragraph | confirmatory | One paragraph with an e-mail address and a phone number → the expected distillate, byte for byte |

A rule that can match the empty string hits every fake, so the loader cannot give it a usable one
(§2.2); the scan's handling of a zero-length match is therefore tested on the scan alone.

**Seeded defects.** Normaliser off → ENG-4, ENG-5 fail. Overlap resolution off → ENG-7 fails.
Same-value numbering off → ENG-8 fails. Allocation checks off → ENG-9, ENG-10 fail. Edge check
off → ENG-11 fails. Defend rules off → ENG-16 fails. The redactor skipping the last value of a
segment → ENG-1 fails.

## 5.4 Validators

| Id | Case | Kind | Input → expected |
|---|---|---|---|
| VAL-1 | Every example of §3 | adversarial | Each rule's hit examples → hit; each not-hit example → no hit, rejected by the validator §3 names |
| VAL-2 | Against an independent implementation | abstract | For each validator that the `stdnum` npm package (MIT licence) also implements: 10,000 values generated valid and 10,000 changed by one character → our answer equals `stdnum`'s. Where `stdnum` decides a century from today's date, either answer is accepted. `stdnum` is a test-only dependency. |
| VAL-3 | No validator reads the clock | adversarial | All examples run with the clock set to 1990, to today and to 2090 → identical results |
| VAL-4 | Checksums decide | abstract | Generated valid card numbers, IBANs and crypto addresses → hit; each with one character changed → no hit |
| VAL-5 | Reserved values are never hits | adversarial | Every range of §2.4.6 at its edges (`555-0100`, `555-0199`, `192.0.2.0`, `192.0.2.255`, `2001:db8::`, `user@sub.example.org`) → no hit; the neighbours just outside (`555-0200`, `192.0.3.1`) → hit where the shape is valid |

## 5.5 Conformance cases

`conformance/` holds cases that any engine build must pass, as JSON Lines:

```json
{"id": "gov_id.us_ssn/hit/1", "rule": "gov_id.us_ssn", "text": "536-22-8914", "expect": "hit", "category": "gov_id.us_ssn"}
{"id": "gov_id.us_ssn/not/1", "rule": "gov_id.us_ssn", "text": "078-05-1120", "expect": "none"}
{"id": "golden/paragraph-1", "request": {"text": "…"}, "result": {"…": "…"}}
```

- **Rule cases** come from §3: every hit and not-hit example of every rule, and the secret test
  values of §3.4.
- **Golden cases** pair a whole request with its whole expected result, byte for byte, covering
  each behaviour of §2 at least once.
- The runner reads the cases, runs each, and writes one result line per case. It is run in the
  quick tier on a sample and in CI in full.

If a public, language-neutral conformance suite for this kind of distiller appears later, a second
runner is written for its format, and `certified` becomes true only by passing it.

## 5.6 The server over stdio

These start the real server as a child process and talk to it with the MCP SDK client at
MosAIc's version, merging the environment the way MosAIc does (the entry's `env` over the
parent's). The harness is `rigs/mcp-harness`. It has two modes. The default, "strict", spawns the
child itself and reads its stdout with the SDK's own framing, line by line, recording as a protocol
violation any line that is not UTF-8, JSON and one JSON-RPC message, and any bytes left without a
newline; the SDK's `StdioClientTransport` cannot do that, because it owns the stream. The "sdk" mode
uses `StdioClientTransport`, as MosAIc does, and records its parse errors as violations. The
cases run the built `dist/server.mjs`. SRV-2 and SRV-8 need to see inside the server, so they run
`dist/test-entry.mjs`, which is the server plus four tools that exist only there: `test_env` (the
names of the environment variables the server holds), `test_hang` (a call whose worker never
answers), `test_advance` (moves a fake clock that the deadline runs on) and `test_pending`
(how many calls the server holds). The installer never copies it. The cases that start a process
run in the local and full tiers, after a global set-up has built the server.

| Id | Case | Kind | Input → expected |
|---|---|---|---|
| SRV-1 | Lists and calls the tools | confirmatory | List tools → `distill` and `capabilities`; call `distill` with `text` → a result |
| SRV-2 | The environment is scrubbed | adversarial | Parent environment holding `OPENAI_API_KEY`, `AWS_SECRET_ACCESS_KEY` and an unrelated `MY_TOKEN` → a test build of the server reports only allow-listed names |
| SRV-3 | `NODE_OPTIONS` never takes effect | adversarial | Started with `NODE_OPTIONS=--require marker.js` and the installer's entry → the marker never runs |
| SRV-4 | No result carries MosAIc's markup | abstract | The markers in every argument, escaped, upper-cased and split across segments, through every tool and every error path → no result contains a raw marker, and a copy of MosAIc's payment-signal detector finds no signal |
| SRV-5 | Logs hold no content | abstract | A unique canary string in every argument of every call → no canary in the log file or on stderr |
| SRV-6 | Stdout carries only the protocol | adversarial | The pool through every tool, read with a strict protocol reader → no stray byte |
| SRV-7 | Argument validation | adversarial | Every tool × a missing argument, a wrong type, `null`, an unknown argument, a 10 MB string, `{}`, both `text` and `segments` → an error result with its code; the server stays up |
| SRV-8 | The deadline | adversarial | A handler made to hang, on a fake clock → `DEADLINE` at 20 seconds; the next call answers |
| SRV-9 | Concurrent calls and a disconnect | adversarial | 20 concurrent calls → each answer matches its request; the client killed mid-call → the server exits within 2 seconds |
| SRV-10 | A refused rule pack | adversarial | The server started with a corrupted pack → exits non-zero before connecting, with only the fixed code on stderr |
| SRV-11 | The descriptions follow §4.4 | abstract | Each description → at most 600 characters, no forbidden word, every argument it names exists in the schema |
| SRV-12 | The same answer as the library | abstract | The pool through `distill` and through `packages/core` directly → identical results |

## 5.7 The installer

These run with `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `APPDATA` and `LOCALAPPDATA` set to
temporary directories, and never touch the real ones. Where a case needs the server it uses the
built bundle. The cases that start a process run in the local and full tiers.

| Id | Case | Kind | Input → expected |
|---|---|---|---|
| INS-1 | Every prior state of MosAIc's server list | abstract | The file absent, empty, malformed, holding only other entries, holding an older entry of ours, holding our current entry, read-only × install, upgrade, uninstall → other entries byte-equal; exactly one entry of ours; a backup made; a malformed file left untouched, with a message |
| INS-2 | Installing twice equals installing once | adversarial | Install, install → one entry |
| INS-3 | A kill during the write | adversarial | Killed between writing the temporary file and renaming it → the file is the old one or the new one, never truncated |
| INS-4 | Finding Node | adversarial | No Node; Node 18; Node only in `/opt/homebrew/bin`; a path with spaces → an absolute path recorded, or a clear refusal |
| INS-5 | The entry starts under MosAIc's conditions | adversarial | The harness starts the exact entry the installer wrote, with a minimal `PATH` like a Finder launch → the server answers |
| INS-6 | Uninstall removes ours, and only ours | adversarial | A file with several entries → only ours removed; our data directory removed only after confirmation |
| INS-7 | The README's procedures work | confirmatory | Install, `doctor` and uninstall, run exactly as documented, in a temporary home directory → each documented outcome |

**Seeded defects, server and installer.** The environment scrub off → SRV-2 fails. Outbound
neutralisation off → SRV-4 fails. The deadline off → SRV-8 fails. The byte-preserving edit replaced
by re-serialisation → INS-1 fails. The temporary-file rename replaced by a direct write → INS-3
fails.

## 5.8 Inside a real MosAIc

`rigs/e2e` builds MosAIc Companion at a pinned commit (`7af40c8` today) and drives it with
Playwright's Electron support, which MosAIc's own `tests/e2e/` also uses. Each run has a fresh
profile, and our server is registered by the real installer.

`rigs/fake-model` is a scripted HTTP server that speaks Ollama's API. MosAIc's "ollama" provider
accepts any address, so a chat agent can be pointed at it and runs for free. Per test it emits
chosen replies, including MosAIc's `<use_tool>` markup, misbehaves on request, and records the
system prompt it received.

| Id | Case | Kind | Input → expected |
|---|---|---|---|
| MOS-1 | The MCP page lists and calls `distill` | confirmatory | Installed by the real installer → the tool listed; a call renders the distillate |
| MOS-2 | An add-on calls `distill` | confirmatory | A test add-on with the `mcp:call` permission → the result arrives |
| MOS-3 | A chat agent's call reaches `distill` | confirmatory | The fake model emits a valid tool call → the result reaches the chat |
| MOS-4 | A misbehaving model does no harm | adversarial | The fake model emits a wrong server name, arguments as a string, prose inside the arguments, two tool tags, a truncated tag, and arguments holding `"__payment_required"` → our server stays up; no payment screen opens; each outcome recorded |
| MOS-5 | Every chat agent receives our descriptions intact | abstract | The fake model records each agent's system prompt → each description present, whole |

**The quirk suite (`quirks-mosaic`).** These pin each MosAIc behaviour this design relies on, so
that a MosAIc release that changes one fails here first. Each runs against a small test server,
not ours. Before the pinned commit moves, this suite runs on the new release.

| Id | MosAIc behaviour relied on | Where, at `7af40c8` | Input → expected |
|---|---|---|---|
| QRK-1 | A tool call times out after 60 seconds | `MCPClient.ts:369-377`; the SDK's default | A test server sleeping 61 s → MosAIc's timeout error |
| QRK-2 | Only text content is shown | `MCPClient.ts:503-512` | A result with an image block → only the text shown |
| QRK-3 | How a payment signal is detected in a tool result | `electron/addons/api/mcp.ts:17-71`; `src/services/ActionParser.ts:132-139` | The signal in the second block; prose before the JSON; the key set to `false` → not detected, on both the chat and add-on paths. Our neutralisation (§4.5) is then confirmed to defeat detection. |
| QRK-4 | The entry's `env` overrides MosAIc's environment | `MCPClient.ts:159-165` | A variable set in both → the entry's value |
| QRK-5 | Chat history keeps tool arguments and results | `src/components/Chatview.tsx:666-853` | A `distill` call from chat → the stored session holds the arguments, which contain the original text |
| QRK-6 | Every chat agent sees every server's tools | `Chatview.tsx:563-575`; `ActionParser.ts:177-199` | Two servers and two agents → both agents' prompts list both |
| QRK-7 | Arguments that are not an object become `{}` | `electron/addons/api/mcp.ts:51` | An add-on passing a string → our server receives `{}` and refuses it |

QRK-5 matters to users: when a chat agent calls the distiller, the original text is already in the
chat, and the call's arguments are stored again in the chat history. The distiller protects what
is passed on after it, not what the chat already holds (§6.5).

## 5.9 Repository checks

| Id | Check | Input → expected |
|---|---|---|
| REP-1 | Names | Before every push, maintainers run a name check against a list of words kept outside this repository. Tracked files, package metadata, commit messages and author identities, split into words on every character that is not a letter and between a lower-case and an upper-case letter, each lower-cased → no listed word. The list is never committed, in any form: a hash of a short word reveals the word to anyone who hashes a guess. CI does not run REP-1. |
| REP-2 | Claims | Documentation and descriptions → the whole words "anonymise", "anonymised", "anonymous", "anonymisation", "isolated" and "isolation", in either spelling, appear only in a sentence that denies them. Unicode's "isolates", a kind of invisible character, is not one of them. |
| REP-3 | Specification links | Every `§` reference in `docs/spec/` resolves to a heading |
| REP-4 | Determinism | `packages/core/src` uses none of `Date`, `Math.random`, `toLocaleLowerCase`, `toLocaleUpperCase`, `localeCompare`, `Intl`, and none of the regular-expression escapes `\d`, `\w`, `\s`, `\b` (read from the syntax tree, so comments do not count). The one exception is `src/pattern/subset.ts`, which names the escapes in order to refuse them. Sorting compares code points |
| REP-5 | Case coverage | Every case id in this document has at least one test whose name starts with it, except the ids listed in `scripts/case-ids-pending.txt` (which shrinks with each commit and is deleted when the last automated case exists, and in which an id that already has a test is an error), and the cases that are manual by nature: REP-1 and MAN-* |

## 5.10 Manual tests

Each runs only after every automated tier passes. Each records its configuration, its result and
what it measured. Real model replies are saved as fixtures for the fake model.

| Id | Question | Expected answer | Budget | Smallest input |
|---|---|---|---|---|
| MAN-1 | Does a real model, given our description in MosAIc's tool prompt, call `distill` with the user's text when asked to clean it before sharing? If not, the description is rewritten. | Yes, in at least 4 of 5 tries | 5 prompts; at most 20,000 tokens and $0.10; 10 minutes. A person supplies a provider key and watches. | A three-line paragraph holding one e-mail address |
| MAN-2 | On packaged MosAIc for macOS and for Windows, does the installer register a server that MosAIc starts? If not, the installer or its README changes. | Yes, on both | 30 minutes per system; no money | The installer, then one `distill` call from the MCP page |

## 5.11 MosAIc behaviours this design works around

Each has a test that fails against a naive server.

| Behaviour | Consequence | Response | Test |
|---|---|---|---|
| MosAIc starts servers with its whole environment | Our process would hold the user's provider keys | Scrub at start; blank `NODE_OPTIONS` and `NODE_PATH` in the entry | SRV-2, SRV-3 |
| MosAIc acts on its own markup in tool results | Text being distilled could open a payment screen or inject markup | Neutralise in the engine and again on every result | SRV-4, MOS-4 |
| Non-object arguments silently become `{}` | A tool could run with nothing | `{}` is refused | SRV-7, QRK-7 |
| MosAIc launched from the macOS Finder may not see the shell's `PATH` | A bare `node` command could fail | The installer records Node's absolute path | INS-4, INS-5 |
| A tool call times out at 60 seconds | A slow call would fail in MosAIc's terms | Our own 20-second deadline | SRV-8, QRK-1 |
