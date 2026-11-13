# 7. Decisions and open questions

## 7.1 Decisions this specification makes

These were chosen while writing the specification. Each is cheap to reverse before the first
release, and each is stated where it applies.

| Decision | Where | Why |
|---|---|---|
| A line break, for the `m` flag, is U+000A only | §2.4.2 | Engines disagree about `\r`, U+2028 and U+2029; one fixed answer keeps output identical across languages |
| A candidate fake value is checked against the rules on its own, not in its place in the text | §2.8 | The two readings can choose different numbers; "on its own" does not depend on neighbouring text |
| Ties in overlap resolution within one family go to the rule id that comes first in code-point order | §2.6 | The family order alone leaves ties; ids give a total order that does not depend on file order |
| Defend hits are resolved separately from redaction hits | §2.6 | A finding should survive even where a redaction covers the same text |
| Edges are checked around the whole match, and validators run on the whole match, not group 1 | §2.4.3, §2.4.5 | Group 1 is what is replaced; the checks are about the shape that was found |
| `end` is exclusive; positions are code points | §2.3 | Language-neutral and unambiguous |
| Result keys in a fixed order, records sorted, compact JSON | §2.10 | Byte-for-byte comparison of results |
| The limits of §2.11 | §2.11 | Large enough for pasted documents, small enough to finish well inside the deadline |
| Two built-in profiles, `agent` and `document`; `agent` is the default | §2.7 | Text sent on through MosAIc is usually read by an AI that has tools; the stricter profile is the safe default |
| Under `agent`, private and loopback IP addresses are replaced; chat-template tokens, tool-call markup and remote Markdown images are neutralised; nothing blocks | §2.7 | Owner's ruling for the first version |
| A term list's class is `high` unless the caller says otherwise | §3.2 | A user lists words because they are sensitive |
| Several rules in one category take suffixed ids | §3.2 | Rule ids must be unique |
| `distill` accepts a single `text` as well as `segments`, and refuses unknown arguments | §4.2 | Chat models call simple tools more reliably; a misspelt argument must not be ignored silently |
| A 20-second deadline per call; a 4 MiB result cap | §4.5 | MosAIc gives up at 60 seconds |
| The installer copies the server to a stable per-user directory and records Node's absolute path | §6.3 | An entry must not point into a temporary cache, and must start from the Finder on macOS |
| The working package name is the constant `PACKAGE_NAME`; every `package.json` is `private` with the licence `UNLICENSED`; nothing is published yet | §1.4 | The name and the licence are open (§7.2, questions 1 and 2); one constant changes in one place |
| The workspace packages are `@mosaic-distiller/core`, `/server` and `/installer`; `core` may import `node:crypto` and nothing else from Node | §1.4 | Scoped names keep the working name out of the import sites; `core` must stay free of files, sockets and processes |
| A profile is a file `{format: "profile/1", name, actions}` whose keys are `category` or `category/variant`; a category it does not name keeps its rule's default | §2.7 | One small, closed, language-neutral format |
| The loader's refusal codes are `PACK_*` and `PROFILE_*` | §2.2 | Each refusal can be tested and reported on its own |
| A `terms` rule carries its own `terms[]`; the hash puts rules, dictionaries, terms and literals in code-point order before canonicalising | §2.2 | The order of the file must never matter (§2.2), and the hash is the proof |
| A pack declares `hidden.invisible` and `inject.consumer_markup` | §2.2 | The engine reports them without a rule, and a profile may name them |
| `?` is the bound `{0,1}` and is allowed in the pattern subset; the alternatives rule applies only where nothing must follow them; the repeated-group rule applies to groups whose maximum is above 1 | §2.4.1 | The patterns of §3 use `?` throughout and some end in alternatives whose order is free; each reading is the narrowest that lets every pattern of §3 load and still refuses every named construct |
| The edge `word_colon`, used for IPv6 | §2.4.3 | The documented not-hit `2001:db8::8a2e:370:7334` cannot hold otherwise: the scan restarts after a rejection and finds the valid tail |
| Patterns compile with the flags `g` and `u` | §2.4.2 | Leftmost-first scanning from `lastIndex` on a 1 MB input needs a global regular expression; a sticky one would try every position |
| A validator also receives the next two characters after the match | §2.4.5 | `email_shape` must see the `:` of `git@host:path` to tell an ssh remote from an address |
| A neutralise literal inside a merged span decides that span | §2.6 | Consumer markup is always neutralised, even beside a longer hit |
| Fake `n` counts per category, not per variant; a number skipped for one value stays free for the next | §2.8 | The table says "per category"; the literal reading of "not yet used" |
| A value with too few digit positions for n gets `[redacted {n}]` | §2.8 | The shape form cannot hold n; the specification gave no further fallback |
| A blocked result has no `warnings`; a warning is `{code, segment}` | §2.10 | §2.10 lists what a blocked result holds and warnings are not in it |
| The validation order of §2.11, and the shape of a dictionary name and template | §2.11 | Tests need one answer when a request breaks two rules |
| `secret.private_key` allows a body of 8,192 characters | §3.4 | At 16,384 a hostile input of 32 KiB took over 100 ms (ENG-20) |
| `not_mask` guards every secret rule whose value can be `***` | §3.4 | A distillate must distil to itself (ENG-10) |
| `gov_id.mrz` and `financial.crypto_address` are each two or three rules | §3.3.5, §3.3.6 | Every validator of a rule must accept a match, and each checks one layout or encoding |
| ENG-3 looks for 4-character substrings that carry content, not runs of separators or of the fake's own filler | §5.3 | A shape-preserving fake keeps separators and zeros, so a literal reading could never pass for a machine-readable zone |
| A request dictionary's template must give some fake in 1 to 100 that no rule hits, else `INVALID_ARGUMENTS`; 10,000 rejected candidates in a row is `INTERNAL` | §2.11, §2.8 | SRV-4 found that a template such as `<use_tool {n}` made the allocator loop for ever; the loader already refuses the same in a pack |
| The engine runs in a worker thread; the 20-second deadline terminates it, starts a new one and answers `DEADLINE`; each call's clock starts when the server receives it | §4.5 | A synchronous engine cannot be interrupted in its own thread |
| In every returned text, `<use_tool`, `<mosaic_ui` and `__payment_required` become `[neutralised: …]`, in any case; quotes round the payment key stay | §4.5 | The replacement keeps JSON valid and removes the quoted key; a replacement that ate the quotes would have broken it. Cost: a segment id of `__payment_required` comes back changed |
| The start-up failure is one line, `DISTILLER_START_FAILED <code>`, with exit status 2; an unreadable or non-JSON pack or profile is `PACK_SCHEMA` or `PROFILE_SCHEMA` | §4.1 | Only a fixed code may reach stderr |
| The environment scrub is the entry's first import | §4.5 | An ES module's body runs after its imports, so a call in the body would come too late |
| The test entry `dist/test-entry.mjs` adds `test_env`, `test_hang`, `test_advance` and `test_pending`, and is never installed | §5.6 | SRV-2 and SRV-8 need to see inside the server |
| The harness owns the child's stdout in "strict" mode and uses the SDK's framing, rather than `StdioClientTransport`; an "sdk" mode uses the SDK's transport | §5.6 | The SDK's transport hides the stream, and SRV-6 must see every byte |
| The installer carries a copy of the built server, and installs it as `<data dir>/server/server.mjs` with `rulepacks/` and `profiles/` beside it; `<data dir>` holds the log too | §4.6, §6.3 | One file and its data, needing no `node_modules`; the entry must not point into a temporary cache |
| An empty `mcp-plugins.json` counts as `[]`; nothing is written when nothing changes; a read-only file that must change is refused | §6.3 | The cases of INS-1 that the specification left open |
| `doctor` reports MosAIc's version as "unknown (not detected)" | §6.3 | Nothing on disk says which version is installed |
| REP-4, a check of nondeterminism by syntax tree; REP-5, a check that every case has a test | §5.9 | The two properties the principles of §1.5 promise must not rest on review |
| The fake model takes a message whose role is `system`, or else the first message that starts `[System Context]`, as the system prompt | §5.8 | MosAIc sends its tool prompt as a user message with that prefix (`Chatview.tsx`, `sendMessage`), so "the system prompt" is that message |
| The rig launches MosAIc with `--no-sandbox` and accepts its "Reduced Security Mode" banner | §5.8 | The downloaded Electron's sandbox helper is not set-uid, and Ubuntu 24.04 restricts user namespaces; the banner is informational |
| The test add-on is loaded by answering the folder dialog with a copy of `rigs/e2e/test-addon/`, named as its manifest id, and gets its calls as `jobs.json` in its data directory | §5.8 | The Dev corner's dialog is native; MosAIc requires the directory name to equal the id; a webview cannot be driven by Playwright |
| The rig's fixture options are objects (`{entries}`, `{vars}`) | §5.8 | Playwright reads a two-element array given to `test.use` as its own `[value, options]` tuple |
| The seeded-defect run has an `e2e` tier: Playwright in `rigs/e2e` of the copy, with MosAIc's build linked from the original | §5.3 | Two rows need a real MosAIc |
| Playwright 1.58.2, the version MosAIc resolves, is pinned in `rigs/e2e` | §5.8 | The same driver as MosAIc's own tests |

## 7.2 Open questions

1. **Licence.** Open source; which licence is chosen before the first release. Until then every
   `package.json` says `UNLICENSED` and there is no `LICENSE` file.
2. **Package and organisation names.** The npm package name and the GitHub organisation are being
   created. Every `<package name>` in this specification is replaced once they exist. Until then
   it means the constant `PACKAGE_NAME` (`mosaic-distiller`), which is the one place to change.
3. **The eight shapes kept with a weak check or none** (§3.1). Each can be moved to "not detected"
   by one decision. Kept for now.
4. **The two name-based secret rules** (`secret.keyed_value`, `secret.query_param`, §3.1). They
   break the precision bar on purpose. Kept for now.
5. **The additional secret shapes** (§3.4). *Answered, 2026-11-13.* They were checked against
   gitleaks' default rules (release v8.30.1). Three are kept (JSON Web Token, Google, npm) and
   three changed (private key, Stripe, Slack webhook); none is dropped. The comparison and the
   reasons are in §3.4.
6. **The TD1 composite check** for identity-card machine-readable zones is not applied: two
   published sample cards disagree on it (§3.3.5). It is added once confirmed against ICAO
   Doc 9303.
7. **Phone numbers outside North America.** They need per-country data. The way to add them
   without a run-time library is to take valid lengths and prefixes from libphonenumber's
   metadata (Apache-2.0) into the rule pack as data. Not in the first version.
8. **A public conformance suite.** None exists for this kind of distiller. Until one does, every
   result says `certified: false` (§5.5).
9. **Requiring Node.js.** The first version needs Node 20 or newer on the user's machine. Whether
   to ship a single-file executable instead is decided before the distiller is offered widely.
10. **A summarising mode.** The interface leaves room for a mode that uses a language model chosen
    by the user (`mode`, `objective`). Nothing about it is specified yet.
11. **Where §3.5 and `python-stdnum` disagree.** Found while writing the validators (VAL-2): (a)
    `cz_rc`: §3.5 says `mod 11 mod 10`, which accepts a remainder of 10 as check digit 0; `stdnum`
    rejects it from the year 1985. (b) `eu_vat` for the Netherlands: with the suffix `B00` we accept
    a number that passes the eleven-test or MOD 97-10; `stdnum` refuses it. (c) `kr_rrn`: `stdnum`
    refuses a region code above 96; §3.5 checks only the date. (d) `stdnum` rejects birth dates in
    the future, which reads the clock (§2.4.5). Each was implemented as §3.5 reads, and the
    comparison tolerates it. Decide whether to follow `stdnum` in (a) to (c).
12. **A number followed by a space and more digits is not found.** The payment-card pattern takes
    up to 19 digits with single separators; if the whole run fails its checks, the scan restarts one
    character later (§2.4.4) and never retries a shorter match from the same start. So
    `4111 1111 1111 1111 123` (a card and its code) and two cards one space apart are not found.
    The same holds for any pattern that ends in a bounded run: precision is kept, recall is lost.
    Options: retry shorter matches at the same start, which changes §2.4.4 for every
    implementation; or write each pattern so that a run cannot extend past its own length. Not
    changed.
13. **The `hostile input` size of ENG-20.** The specification gives none. 32 KiB is used. The cost
    of `secret.private_key` is its bound times the number of header starts in the input, so a longer
    input costs more however the bound is chosen.
14. **Step 2.7, the try in a real MosAIc, is done by the rig, not by hand.** Commit 3's
    `rigs/e2e` builds MosAIc at `7af40c8`, installs the server with the real installer into a fresh
    profile, and MOS-1 calls `distill` from the MCP page; MOS-2 to MOS-5 and QRK-1 to QRK-7 run
    the same way. It opens MosAIc's window on the screen it runs on (use `xvfb-run` where there is
    none). What the rig cannot show is how a real model behaves (MAN-1) and how packaged MosAIc
    on macOS and Windows behaves (MAN-2); both stay manual.
15. **A segment id that is `__payment_required` comes back changed** (§4.5). The server's second
    neutralisation cannot tell an id from other text. An id is chosen by the caller, so the answer
    is to choose another; the alternative is to refuse such an id, which would be a new error code.
