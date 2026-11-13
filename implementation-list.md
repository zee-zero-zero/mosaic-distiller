# Implementation list: the distiller, from specification to a server MosAIc can run

This list turns the specification in [`docs/spec/`](docs/spec/) into working code in **three
commits**. When the third commit is done, a user can run the installer and have MosAIc Companion
start the distiller as an MCP server, list its two tools and call them from the MCP page, from an
add-on and from a chat agent.

Read [`AGENTS.md`](AGENTS.md), then the whole specification, before writing anything. The
specification is authoritative. This list says in what order to build it, what each commit holds,
and which tests must pass before each commit. Where this list and the specification disagree, the
specification wins, and the disagreement is reported.

## How to use this list

- Work through the commits in order, and the steps inside each commit in order. Tick a step's box
  when its tests pass.
- **Tests come first.** For every step, write the cases the step names before or with its code
  (`05-testing.md` §5.1). A case's test name starts with its id, such as
  `ENG-11 edges: ...`, so that one case can be run alone with `vitest -t "ENG-11"`.
- **Do not commit and do not push.** When a commit's gate passes, stop and report:
  - the files in the commit;
  - the output of each gate command;
  - the seeded-defect table;
  - a proposed commit message.

  The maintainer reviews the change, commits it in this repository's identity, runs the name
  check (REP-1, `05-testing.md` §5.9) and pushes.
- **The specification moves with the code.** Where this list makes a decision the specification
  does not yet record, the step says so. That step also updates the named section of
  `docs/spec/`, in the same commit. Each such decision is cheap to reverse before the first
  release. Record each one in `07-decisions-and-open-questions.md` §7.1.
- **Stop and ask** when something here cannot be done as written, or when a test shows the
  specification is wrong. Collect such questions in `07-decisions-and-open-questions.md` §7.2 and
  report them together.

## Decisions made in this list

These fill gaps in the specification. Each is written into the specification by the commit that
first needs it.

| Decision | Value | Spec section to update | Commit |
|---|---|---|---|
| Package name (working) | `mosaic-distiller`, held in one constant, `PACKAGE_NAME`, in `packages/core/src/name.ts`. Every `<package name>` in the specification means this value until the name is final (§7.2, question 2). | §7.2 question 2 | 1 |
| Publishing | Nothing is published in this phase. Every `package.json` has `"private": true` and `"license": "UNLICENSED"` until the licence is chosen (§7.2, question 1). No `LICENSE` file yet. | §7.2 question 1 | 1 |
| Workspace package names | `@mosaic-distiller/core`, `@mosaic-distiller/server`, `@mosaic-distiller/installer` | §1.4 | 1 |
| Profile file format | `profiles/agent.json` and `profiles/document.json`, each `{"format": "profile/1", "name": "...", "actions": {"<category>" or "<category>/<variant>": "<action>"}}`. A category that a profile does not name keeps its rule's default action. | §2.7 | 1 |
| Loader refusal codes | `PACK_FORMAT`, `PACK_SCHEMA`, `PACK_UNKNOWN_KIND`, `PACK_UNKNOWN_VALIDATOR`, `PACK_UNKNOWN_ACTION`, `PACK_UNKNOWN_FLAG`, `PACK_UNKNOWN_EDGE`, `PACK_PATTERN_SUBSET`, `PACK_PATTERN_COMPILE`, `PACK_DUPLICATE_ID`, `PACK_UNDECLARED_CATEGORY`, `PACK_TERM_TOO_SHORT`, `PACK_NO_RULES`, `PACK_NO_FAKE`. The same codes apply to profiles, with `PROFILE_` in place of `PACK_`. | §2.2 | 1 |
| Determinism check | REP-4: a test fails if `packages/core/src` uses `Date`, `Math.random`, `toLocaleLowerCase`, `toLocaleUpperCase`, `localeCompare`, `Intl`, `\d`, `\w`, `\s` or `\b`. The one exception is `src/pattern/subset.ts`, which must name those escapes in order to refuse them. Sorting compares code points. | §5.9 | 1 |
| Case coverage check | REP-5: a test reads every case id in `docs/spec/05-testing.md` and fails if any id has no test whose name starts with it. The exception is ids listed in `scripts/case-ids-pending.txt`. That file shrinks with each commit and is deleted in commit 3. | §5.9 | 1 |
| Deadline mechanism | The engine runs in a `worker_threads` worker. When a call passes 20 seconds, the server terminates that worker, answers `DEADLINE` and starts a new one. A synchronous engine cannot be interrupted in the same thread. | §4.5 | 2 |
| Outbound neutralisation strings | In every text the server returns, `<use_tool` becomes `[neutralised: use_tool]`, `<mosaic_ui` becomes `[neutralised: mosaic_ui]`, and `__payment_required` becomes `[neutralised: payment_required]`, in any case of letters; quotes round the payment key stay, so that JSON stays valid and no longer holds `"__payment_required"` (as built; §7.1). None of these contains `"` or `\`. MosAIc opens a payment screen when a tool result's first text block contains `"__payment_required"` (with the quotes) and parses as JSON with that key set. | §4.5 | 2 |
| Start-up failure on stderr | One line: `DISTILLER_START_FAILED <code>`, where `<code>` is a loader code. Nothing else. | §4.1 | 2 |
| Test-only server entry | `packages/server/src/test-entry.ts`, built to `dist/test-entry.mjs`. It adds the hooks that SRV-2 and SRV-8 need. The installer never copies it. | §5.6 | 2 |
| MosAIc's settings directory on Linux | `$XDG_CONFIG_HOME/mosaic-companion/` when `XDG_CONFIG_HOME` is set, otherwise `~/.config/mosaic-companion/`. On Windows, `%APPDATA%\mosaic-companion\`. This is where Electron puts MosAIc's user data, and MosAIc's own example (`examples/mcp/mcp-hello/setup.js`) resolves it the same way. | §6.1 | 2 |
| Our entry's fixed id | `0f107eda-796d-44e2-b910-37c18e2bc535` | §6.3 | 2 |
| The installed server | One file bundled with esbuild, `server.mjs`, holding the engine, the server and the MCP SDK, plus `rulepacks/default.json` and `profiles/*.json` next to it. The installed copy needs no `node_modules`. | §6.3 | 2 |

## Toolchain

- Node.js 20 or newer; CI runs Node 20 and Node 22.
- npm workspaces. `package-lock.json` is committed, and CI installs with `npm ci`.
- TypeScript in `strict` mode, compiled to ES2022 ECMAScript modules.
- vitest for every unit and integration test. `@vitest/coverage-v8` reports coverage; there is
  no coverage threshold.
- ESLint (flat config, `typescript-eslint`) and Prettier.
- esbuild for the server bundle.
- `@modelcontextprotocol/sdk` pinned **exactly** to `1.28.0`. MosAIc at `7af40c8` asks for
  `^1.27.0`, which resolves to 1.28.0. `zod` comes in only as the SDK needs it.
- Test-only dependencies:
  - `fast-check`, for generated pools with a fixed seed;
  - `stdnum`, for VAL-2;
  - `@playwright/test`, for commit 3.
- No run-time dependency in `packages/core`.

**Commands.** Commit 1 defines these in the root `package.json` and lists them in `AGENTS.md`
under "Commands", replacing "Not defined yet":

| Command | What it runs | Budget |
|---|---|---|
| `npm run lint` | ESLint, Prettier check, `tsc --noEmit` over every workspace | — |
| `npm run test:quick` | the quick tier: unit tests of every package, a fixed seeded sample of each pool, and REP-2 to REP-5 | 60 s |
| `npm run test:local` | the local tier: the quick tier, plus the full pools, the conformance runner in full, the stdio server cases and the installer cases that start processes (commit 2 on) | 15 min |
| `npm run test:seeded` | the seeded-defect run (below) | 15 min |
| `npm run build` | compiles every workspace and bundles the server (commit 2 on) | — |
| `npm run test:e2e` | the MosAIc end-to-end suite (commit 3) | — |
| `npm run test:quirks` | the MosAIc quirk suite (commit 3) | — |

**Seeded defects** (`scripts/seeded-defects.mjs`, `05-testing.md` §5.1). The script holds a
table. Each row names:
- a mechanism;
- a file;
- an exact piece of source text, and what to replace it with, so that the mechanism is
  disabled;
- the case ids that must then fail.

For each row, the script copies the repository to a temporary directory and applies the
replacement. **If the source text is not found, the run fails**, so a refactor cannot quietly
disarm a row. The script then runs the named cases and records whether they failed. It writes
the table to `docs/seeded-defects.md`. A row whose cases still pass is a test that could never
fail, and blocks the commit.

## CI

`.github/workflows/ci.yml`. Every job uses `npm ci`. Every job caches npm's cache directory
under the key of `package-lock.json`.

| Job | Trigger | Runs on | Commands |
|---|---|---|---|
| `quick` | every push and pull request | ubuntu-latest, Node 20 and 22 | `npm run lint`, `npm run test:quick` |
| `local` | every push and pull request | ubuntu-latest, Node 20 | `npm run build`, `npm run test:local` |
| `installer-os` (commit 2) | every push to `master` | macos-latest and windows-latest, Node 20 | the installer's tests only. macOS and Windows minutes cost more, so nothing else runs there. |
| `pools-full` | every push to `master` | ubuntu-latest | every pool in full, and the conformance runner in full |
| `e2e-mosaic` (commit 3) | every push to `master` | ubuntu-latest under `xvfb-run` | `npm run test:e2e` |
| `quirks-mosaic` (commit 3) | manual (`workflow_dispatch`), with the MosAIc commit as an input that defaults to the pinned one | ubuntu-latest under `xvfb-run` | `npm run test:quirks` |

---

## Commit 1: the engine library, its rule pack and its conformance cases

**Delivers** `packages/core`, complete: everything in `02-engine.md` and `03-detectors.md`.
Also the default rule pack, the two profiles, the conformance cases and their runner, the
repository checks, and CI's `quick`, `local` and `pools-full` jobs. Nothing here touches a
file, the network, the clock or MosAIc.

**Public API of `@mosaic-distiller/core`** (`packages/core/src/index.ts`). The server in commit
2 uses nothing else.

```ts
loadRulePack(json: unknown): RulePack               // throws RulePackError { code } (loader codes above)
loadProfile(json: unknown, pack: RulePack): Profile // throws RulePackError { code: "PROFILE_..." }
createEngine(opts: { pack: RulePack; profiles: Profile[]; defaultProfile: string }): Engine
engine.distill(req: DistillRequest): DistillResult | DistillRefusal
engine.capabilities(): Capabilities                  // the content of 04-mcp-server.md §4.3
serializeResult(r: DistillResult | DistillRefusal): string  // §2.10: fixed key order, compact
PACKAGE_NAME, ENGINE_VERSION, LIMITS
```

- `DistillRequest` is `{segments: {id, text, kind?}[], dictionaries?, profile?, mode?, objective?}`.
  The engine has no `text` shorthand; the server converts `text` into the segment `"1"`.
- `DistillRefusal` is `{error: {code, message}}`, with a fixed message per code (§2.11, §4.2).
- Any exception inside `distill` becomes `INTERNAL` (§2.11, "Fail closed").

### Steps

- [x] **1.1 Repository.**
  - Create the root `package.json` with the workspaces and the commands above, plus
    `tsconfig.base.json`, the ESLint and Prettier configs, `.gitignore` (`node_modules/`,
    `dist/`, `coverage/`, `rigs/e2e/.mosaic/`) and `.nvmrc` (`20`).
  - Create `packages/core` with `src/name.ts`.
  - Create `.github/workflows/ci.yml` with the `quick`, `local` and `pools-full` jobs.
  - Every source file opens with a comment saying what it provides (`AGENTS.md`, rule 3).
  - *Tests:* REP-2 (claims), REP-3 (every `§` reference in `docs/spec/` resolves), REP-4
    (determinism) and REP-5 (case coverage), in `scripts/repo-checks/`. Start
    `scripts/case-ids-pending.txt` with every case id.
  - *Spec:* add REP-4 and REP-5 to §5.9.
- [x] **1.2 Schema and types** (`src/schema.ts`).
  - Types for the rule pack, the profile, the request, the result, a removal, a finding, a
    refusal and the counters, exactly as §2.2, §2.10 and §4.2 give them.
  - Hand-written validators for each; no schema library.
  - *Tests:* each field of each type accepted, refused when missing, refused when of the wrong
    type, and refused when unknown.
- [x] **1.3 The pattern subset** (`src/pattern/subset.ts`).
  - A parser that accepts exactly §2.4.1 and refuses everything else, with `PACK_PATTERN_SUBSET`.
    It refuses:
    - lookaround, backreferences and inline flags;
    - `\d`, `\w`, `\s`, `\b` and `\B`;
    - `*`, `+` and `?` used as quantifiers, and any unbounded `{m,}`;
    - more than one capturing group;
    - a quantified group whose iterations can begin with a character the repetition before it
      can match;
    - alternatives that share a prefix, written shortest first.

    A lazy `?` after a bound is refused as well.
  - The parser is the authority on the subset; JavaScript is used only to compile.
  - A compiler (`src/pattern/compile.ts`) builds a `RegExp` with the flags `u` and `y`, plus `i`
    when the rule has `i`. Under the rule's `m` flag it rewrites `^` as `(?:^|(?<=\n))` and `$`
    as `(?:$|(?=\n))`, and never passes JavaScript's own `m` (§2.4.2).
  - *Tests (part of ENG-23):* every construct named above refused, with its code. Every pattern
    of `03-detectors.md` accepted. A pattern that parses but does not compile gets
    `PACK_PATTERN_COMPILE`.
  - Adversarial cases include:
    - `\d` hidden inside a class (`[\d]`);
    - `{1,}`;
    - a nested group with two captures;
    - `(?i)`;
    - `N|NW`.
- [x] **1.4 The rule-pack loader and hash** (`src/rulepack.ts`, `src/jcs.ts`).
  - Every refusal of §2.2, each with its own code. There is no partial load.
  - The version hash is SHA-256 of the RFC 8785 canonical form, in lower-case hex. Write the
    canonicaliser yourself; the pack holds no floating-point numbers. Use `node:crypto` for
    SHA-256.

    Note: `packages/core` may import `node:crypto` and nothing else from Node. Say so in §1.4.
  - Profiles are loaded with `loadProfile`. A profile that names an undeclared category or an
    unknown action is refused.
  - *Tests:* ENG-23 (each refusal, its own code, no engine built) and ENG-24.

    ENG-24 checks three things:
    - changing each field of each rule changes the hash;
    - reordering the rules leaves it unchanged;
    - a fixed test pack gives a hash written into the test.

    That last hash is computed once, outside the code, with Python:
    `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)` encoded as
    UTF-8 and hashed. This matches RFC 8785 when no key has a character outside the Basic
    Multilingual Plane; the test pack keeps to that.
- [x] **1.5 Segments, positions and the scan view** (`src/text/codepoints.ts`, `src/text/scanview.ts`).
  - Each segment becomes an array of code points.
  - A lone surrogate is replaced by U+FFFD, with the warning `LONE_SURROGATE`.
  - The scan view is built exactly as §2.3 says:
    - both groups of invisible characters dropped;
    - NFKC applied one code point at a time;
    - for each scan-view code point, the original index it came from.
  - The scan view's JavaScript string comes with a table from each UTF-16 index to its
    code-point index.
  - Runs of "removed" invisible characters are recorded for the `hidden.invisible` findings.
  - *Tests:*
    - ENG-17 (each removed and each kept character);
    - ENG-18 (the distillate is not normalised; it can be checked once the distillate exists in
      step 1.10, and until then as a scan-view test);
    - ENG-6 (code points; an emoji, the flag of Scotland and a CJK character before a match);
    - ENG-5 (random invisible characters inserted; the mapping covers them).
- [x] **1.6 The scan, edges and flags** (`src/pattern/scan.ts`, `src/pattern/edges.ts`).
  - Leftmost-first scan driven by `lastIndex`, exactly as §2.4.4 says:
    - after a rejection, resume at the rejected match's start plus one code point, stepping over
      a surrogate pair;
    - after a zero-length match, step one code point.
  - The edges `word`, `numeric`, `word_before` and `none` are checked on the scan view around
    the whole match (§2.4.3).
  - Group 1 gives the reported span when present; validators see the whole match.
  - Counters: `evaluated`, `candidates`, `rejected_edge`, `rejected_validator` and `fired`.
  - *Tests:* ENG-11, ENG-12, ENG-13 and ENG-22. Run them on small test packs in
    `packages/core/test/packs/`, so that each mechanism is tested directly and not only through
    the default pack.
- [x] **1.7 Validators** (`src/validators/`, one file per group of §3.5).
  - The closed list of §3.5, every function, each taking the matched text and returning
    `{ok: false}` or `{ok: true, variant?}`.
  - No validator reads the clock. Where a two-digit year is encoded, every possible century is
    tried (§2.4.5).
  - The reserved values of §2.4.6 are rejected where §3.5 says.
  - The registry of validator names is a frozen object; the loader refuses a name not in it.
  - *Tests:*
    - VAL-1 (once the default pack exists, step 1.9; before that, each validator's own cases);
    - VAL-2 against `stdnum`, 10,000 generated valid values and 10,000 changed by one character
      per validator that `stdnum` also has (full counts in `pools-full`; 200 each in the quick
      tier);
    - VAL-3, run with vitest's fake timers set to 1990, to the real date and to 2090;
    - VAL-4;
    - VAL-5.
  - Each validator also has direct cases: its source's own test values, a value one digit off,
    the empty string and the longest the pattern allows.
- [x] **1.8 Term lists** (`src/terms.ts`).
  - Folding exactly as §2.5 says, one code point at a time: `toLowerCase()` on the code point
    alone, `normalize("NFKD")`, then drop `\p{Mn}`. Each run of `\p{White_Space}` folds to one
    space. Every folded code point keeps its map back.
  - Matching is literal, never compiled as a pattern: a sorted structure such as a trie over
    folded terms.
  - Boundaries use `\p{L}` and `\p{N}`.
  - Ties: leftmost, then longest, then the folded form first in code-point order.
  - Terms shorter than 2 or longer than 200 code points after folding are refused.
  - Terms never reach a record, a counter or a log.
  - *Tests:* ENG-14 and ENG-15.
- [x] **1.9 The default rule pack, the profiles and the rule cases.**
  - `rulepacks/default.json` holds:
    - every rule of `03-detectors.md` §3.3, §3.4 and §3.7, with its categories and fake
      templates;
    - the neutralise literals.
  - `profiles/agent.json` and `profiles/document.json` follow the table of §2.7.
  - A JSON schema for packs goes in `rulepacks/rulepack.schema.json`.
  - `conformance/rules.jsonl` holds every hit and not-hit example of every rule of §3. It also
    holds the secret test values of §3.4: for each secret rule, at least one synthetic hit and
    one look-alike that must not hit. Look-alikes are:
    - git commit hashes, UUIDs, hashes and base64 images;
    - `YOUR_API_KEY`, `sk-xxxx` and `***`;
    - `git@host:path`.

    Synthetic secrets are generated, never live keys, and are built so that no scanner takes
    them for a real key: a repeating filler after the prefix.
  - **Check the additional secret shapes of §3.4 against gitleaks' default rules** (§7.2,
    question 5):
    - Fetch `config/gitleaks.toml` from the latest gitleaks release (MIT licence). Keep its
      licence notice, and record the release tag at the top of the file.
    - For each of our six additional shapes, compare our pattern with gitleaks' rule for the
      same prefix.
    - Write the comparison into §3.4: each shape kept, changed or dropped, with the reason.
    - Update §7.2 question 5.
    - A test asserts that each of our additional shapes hits the sample value gitleaks' rule
      carries, where it carries one.
  - *Tests:*
    - VAL-1 over `conformance/rules.jsonl`;
    - a test that every rule id in the pack has at least one hit case and one not-hit case;
    - a test that every category in the pack is used.
- [x] **1.10 Overlaps, actions, fakes, the distillate and the result**
  (`src/resolve.ts`, `src/actions.ts`, `src/fakes.ts`, `src/distillate.ts`, `src/result.ts`).
  - Merging follows §2.6:
    - longest hit first;
    - then the family order;
    - then the rule id in code-point order;
    - defend hits are resolved separately.
  - Actions and profiles follow §2.7. The more specific key wins, and the literals are always
    neutralised. A span whose action is `block` stops the request, as §2.10 says.
  - Fake allocation follows §2.8:
    - the templates;
    - the smallest free n that no rule hits on its own and that occurs nowhere in the input;
    - the same canonical value gets the same fake;
    - numbering by first occurrence;
    - merged spans canonicalised from the whole merged text.
  - The distillate follows §2.9; the result, with its key order and sorting, follows §2.10.
  - Limits follow §2.11, exactly at the limit. The 1,048,576-byte limit counts UTF-8 bytes,
    not characters.
  - *Tests:*
    - ENG-7, ENG-8, ENG-9 and ENG-10;
    - ENG-16 (every category × every action × both profiles);
    - ENG-19;
    - ENG-25;
    - the §2.10 example, byte for byte.
- [x] **1.11 The engine and its pool** (`src/engine.ts`, `test/pool/`).
  - `createEngine` and `distill` run the order of §2.1.
  - `capabilities` reports what §4.3 lists.
  - The segment pool is generated by a fixed-seed generator that plants values at known
    positions (§5.3). Its members cover:
    - every category;
    - mixed categories;
    - no values;
    - adjacent values;
    - values at the start and end of a segment;
    - non-Latin scripts;
    - invisible characters inside values.
  - The generator writes the expected spans alongside each member.
  - *Tests:*
    - ENG-1, ENG-2 (the guard), ENG-3 and ENG-4;
    - ENG-20: 1 MB under 2 s; for each pattern, a backtracking input under 100 ms. The budgets
      are checked in `local` and `pools-full`. In `quick`, a 64 KB input stands in;
    - ENG-21: the pool twice, with rules, dictionaries and terms shuffled by a seeded shuffle,
      giving identical bytes.
- [x] **1.12 Golden cases and the conformance runner** (`conformance/golden.jsonl`, `packages/core/src/conformance.ts`, `scripts/conformance.mjs`).
  - At least one golden case for each behaviour of §2, as a request and its whole expected
    result. The behaviours are:
    - each action;
    - each profile;
    - a merge;
    - a fake skipped because it was taken;
    - a term list;
    - an invisible character;
    - a block;
    - each limit refusal.
  - The runner reads both files, writes one result line per case to `conformance/results.jsonl`
    (git-ignored), and exits non-zero on any failure. It runs a fixed sample in `quick` and
    everything in `local` and `pools-full`.
  - `certified` stays `false`.
- [x] **1.13 Seeded defects.**
  - `scripts/seeded-defects.mjs` gets the seven rows of §5.3 ("Seeded defects"). Run it; every
    row must show its cases failing.
  - Write `docs/seeded-defects.md`.
- [x] **1.14 Documentation.**
  - In `README.md`:
    - the status line becomes "Engine implemented; server not yet";
    - the layout loses its "(planned)" mark for the parts that now exist;
    - a short section, "Using the engine as a library", shows the API above.
  - `AGENTS.md` gets "Commands".
  - Shrink `scripts/case-ids-pending.txt` to the SRV, INS, MOS and QRK ids.

### Status of commit 1 (done 2026-11-13; committed by the maintainer as `d4dc84b`)

All of steps 1.1 to 1.14 are done and every gate command passes:

| Gate | Result |
|---|---|
| `npm ci && npm run lint` | clean |
| `npm run test:quick` | 2,336 passed, 1 skipped, in 7.8 s (budget 60 s) |
| `npm run test:local` | 2,673 passed, in 132 s (budget 15 min) |
| `npm run test:seeded` | all 7 rows caught (`docs/seeded-defects.md`) |
| `npm run conformance` | 318 cases (271 rule, 47 golden), 0 failed |
| REP-5 | every ENG and VAL case has a test; pending file holds only SRV, INS, MOS, QRK |

Where the work differs from this list (each is recorded in `docs/spec/07-decisions-and-open-questions.md`):

- **`?` is allowed** in the pattern subset, as the bound `{0,1}`. The spec forbids only `*` and `+`,
  and the pack uses `?` throughout; step 1.3 said to refuse it, and the spec won.
- **Flags are `g` and `u`**, not `u` and `y` (step 1.3): a global regexp driven by `lastIndex` is
  what keeps a 1 MB scan fast. §2.4.4 allows either.
- **New edge `word_colon`**, used for IPv6, so that the spec's own not-hit
  `2001:db8::8a2e:370:7334` holds after the scan restarts (§2.4.3).
- **Two spec rules became several**: `gov_id.mrz` is three rules and `financial.crypto_address` two,
  because every validator on a rule must accept a match and each checks one layout or encoding.
- **Validators get the next two characters** after a match, so `email_shape` can see the `:` of
  `git@host:path`.
- **Added `not_git` and `not_mask`** to the validator registry, and `not_mask` to every secret rule
  whose value can be `***`, so that a distillate distils to itself (ENG-10).
- **`secret.private_key` body bound is 8,192**, not 16,384 (ENG-20 budget); hostile inputs are
  32 KiB.
- **Fallback fake `[redacted {n}]`** for a value with no digit to number; `n` counts per category.
- **ENG-3 looks only at 4-grams that carry content** (not separators or the fake's own `0`/`X`
  filler); ENG-15 uses `\\` because a one-character term is refused.
- **Timing checks use the best of 3 wall-clock runs**, and the test runner is limited to 4 workers.
- **Dev dependencies beyond the list:** `tsx` (runs the TypeScript conformance and seeded scripts).
  vitest is pinned to 3.2.7 and ESLint to 9.39.5, because vitest 5 needs Node 22.
- **Extra repository checks:** `scripts/repo-checks/source-headers.test.ts` (AGENTS rule 3) and
  `scripts/golden-regen.ts` (writes `conformance/golden.jsonl`; read every change).

Open questions raised for the maintainer (§7.2, questions 11 to 13): where §3.5 and `stdnum`
disagree (`cz_rc`, NL VAT `B00`, `kr_rrn`); a card followed by a space and more digits is not found
(§2.4.4); the size of ENG-20's hostile input. Question 5 (gitleaks) is answered: three shapes kept,
three changed, none dropped.

### Gate for commit 1

All of these must hold before the commit is proposed:
- [x] `npm ci && npm run lint` is clean.
- [x] `npm run test:quick` passes within 60 seconds.
- [x] `npm run test:local` passes within 15 minutes.
- [x] `npm run test:seeded`: every row fails as expected.
- [x] The conformance runner in full: zero failures, with the number of cases reported.
- [x] REP-5: every ENG and VAL case exists.
- [x] `git status` shows no generated file outside `.gitignore`.
- [x] The specification sections named in "Decisions made in this list" for commit 1 are updated.

Proposed subject: `feat(core): implement the engine, the default rule pack and its conformance cases`.

---

## Commit 2: the MCP server and the installer

**Delivers** `packages/server` and `packages/installer`, and the stdio test harness
`rigs/mcp-harness`. At the end of this commit a user can run, from a clone:

```
npm ci && npm run build
node packages/installer/dist/cli.mjs install
```

then press Refresh on MosAIc's MCP page and see `distiller` with its two tools.

### Steps

- [x] **2.1 The stdio harness** (`rigs/mcp-harness/`).
  - It starts a server as a child process and talks to it with the MCP SDK's client, at the
    pinned SDK version. As built, the default "strict" mode spawns the child itself and uses the
    SDK's framing (so it can read every stdout byte); an `sdk` mode uses `StdioClientTransport`.
  - It builds the child's environment the way MosAIc does: the parent's environment with the
    entry's `env` laid over it, and undefined values dropped. That is
    `electron/integrations/mcp/MCPClient.ts:151-201` in MosAIc at `7af40c8`.
  - It exposes:
    - `listTools`;
    - `callTool`;
    - a strict protocol reader on stdout, which fails on any byte that is not a protocol
      message;
    - the server's stderr;
    - a way to kill the client mid-call.
- [x] **2.2 Safeguards** (`packages/server/src/safeguards/`).
  - `scrubEnvironment()` runs as the very first statement of the entry. It deletes every
    variable outside the allow-list of §4.5 and keeps `DISTILLER_*`.
  - `neutraliseOutbound(text)` uses the strings decided above. Every text the server returns
    passes through it, results and errors alike, in one place: the function that builds a tool
    result.
  - `ContentFreeLog` writes JSON-lines events made only of codes and numbers. It:
    - writes to the data directory of §4.6, created with mode `0700` on Linux and macOS;
    - rotates at 1 MiB, keeping two files;
    - never writes to stdout;
    - writes to stderr only the start-up failure line.

    Its event type admits no string field except a fixed code.
  - *Tests:*
    - SRV-2 (through `test-entry.mjs`, which reports the names of the variables it sees);
    - SRV-3 (`NODE_OPTIONS=--require marker.js`; started with the installer's entry, the marker
      never runs);
    - SRV-4;
    - SRV-5.
- [x] **2.3 The server** (`packages/server/src/`).
  - Use the SDK's low-level `Server` class, with handlers for `tools/list` and `tools/call`, so
    that argument validation and error results are ours. Do not use `registerTool` with zod
    shapes: that path would let unknown arguments through, and would answer `{}` with the SDK's
    own error.
  - Each tool's input schema is JSON Schema with `additionalProperties: false`, written to match
    §4.2 and §4.3 exactly.
  - Start-up follows §4.1, in order:
    1. scrub the environment;
    2. load and verify the pack and profiles from the directory of the running file
       (`import.meta.url`);
    3. start the engine worker;
    4. connect stdio.

    A refused pack writes `DISTILLER_START_FAILED <code>` to stderr and exits with status 2,
    before connecting.
  - `distill`:
    - validates its arguments itself, refusing missing, wrong-typed, `null`, unknown, both
      `text` and `segments`, neither, and `{}`;
    - converts `text` into segment `"1"`;
    - sends the request to the worker;
    - returns one text block holding `serializeResult(...)`.

    A refusal is returned with `isError: true`. A result over 4 MiB gets `RESULT_TOO_LARGE`.
  - `capabilities` ignores any argument.
  - The deadline: 20 s per call, on a timer that the test entry can replace with a fake clock.
    On expiry the worker is terminated and replaced, and the server answers `DEADLINE`. Each
    concurrent call is matched to its own answer.
  - Shutdown: when stdin ends, exit within 2 s.
  - The tool descriptions are the exact texts of §4.2 and §4.3.
  - `npm run build` bundles `packages/server/src/main.ts` with esbuild into
    `packages/server/dist/server.mjs` (platform `node`, target `node20`, format `esm`). It copies
    `rulepacks/default.json` and `profiles/` into `packages/server/dist/`.
  - *Tests:* SRV-1 and SRV-6 to SRV-12. SRV-12 runs the pool through `distill` and through
    `packages/core` and compares the bytes.
- [x] **2.4 The installer** (`packages/installer/src/`, CLI `dist/cli.mjs`). Subcommands:
  `install`, `doctor`, `uninstall` and `serve`. `serve` runs the bundled server; it exists for
  the by-hand route of §6.3.
  - `install` does exactly §6.3:
    1. Find Node 20 or newer. Try `process.execPath` first, then `PATH`, then
       `/opt/homebrew/bin`, `/usr/local/bin` and the `nvm` default. Record its absolute path.
    2. Copy `server.mjs`, the pack and the profiles into the per-user directory of §6.3.
    3. Find MosAIc's settings directory as decided above.
    4. Edit `mcp-plugins.json`:
       - parse it; refuse an unparseable file or a non-array, and say so;
       - keep every other entry byte for byte, as its original text slice, not re-serialised;
       - add or replace our entry, matched by `name: "distiller"` or our fixed id;
       - write `mcp-plugins.json.bak`, then a temporary file, then rename it over the original.

       Create the file as `[]` plus our entry when it is absent. Create the settings directory
       if MosAIc has never run, and say that MosAIc has not been started yet.
    5. Print what to press in MosAIc.
  - Our entry is the JSON of §6.3, with the fixed id and the absolute paths.
  - `doctor` makes each check of §6.3 and prints the fix for each failure. It starts the
    installed server with the SDK's client (inside the installer, not the harness) to list its tools. A missing MosAIc version is
    reported as "unknown", not as a failure.
  - `uninstall` removes our entry with the same byte-preserving edit and removes our installed
    copy. It removes the data directory only after a `y` answer, or with `--yes`.
  - Every path is built with `node:path` for the running platform. The tests run with `HOME`,
    `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `APPDATA` and `LOCALAPPDATA` pointed at temporary
    directories, and never touch the real ones.
  - *Tests:*
    - INS-1 to INS-6;
    - INS-3: the rename is replaced by a function that throws, standing in for the kill;
    - INS-4: fake `node` scripts on a fake `PATH`, printing chosen versions;
    - INS-5: the exact entry started with `PATH=/usr/bin:/bin`.
  - Add the `installer-os` CI job.
- [x] **2.5 README for users.** New sections:
  - **Install into MosAIc**, giving:
    - the commands above;
    - `doctor`;
    - `uninstall`;
    - the by-hand route and its two costs (§6.3).
  - **What it does and does not do**, from §1.2 and §6.5, including the chat-history point:
    when a chat agent calls the distiller, the original text is already in that chat.
  - *Test:* INS-7 runs each documented command from the README, extracted from its fenced
    blocks, in a temporary home, and checks the documented outcome.
- [x] **2.6 Seeded defects and pending ids.**
  - Add rows for:
    - the environment scrub off (SRV-2 fails);
    - outbound neutralisation off (SRV-4 fails);
    - the deadline off (SRV-8 fails);
    - the byte-preserving edit replaced by re-serialisation (INS-1 fails);
    - the temporary-file rename replaced by a direct write (INS-3 fails).
  - Shrink `scripts/case-ids-pending.txt` to the MOS and QRK ids.
- [ ] **2.7 Try it in a real MosAIc by hand** (Linux, a development build of MosAIc at
  `7af40c8`, a throwaway profile directory through `XDG_CONFIG_HOME`).
  1. Run `install`.
  2. Start MosAIc and open the MCP page.
  3. Check that `distiller` is listed and connects.
  4. Call `distill` with `Write to jane.doe@northwind-mail.com.`
  5. Check that the distillate `Write to person1@example.com.` is shown.

  Record the result and the MosAIc version in the commit report. This is a smoke check, not a
  case; commit 3 automates it as MOS-1.

### Status of commit 2 (done 2026-11-13 except step 2.7; proposed, not committed)

Steps 2.1 to 2.6 are done and ticked; the work is in the tree, unstaged. Step 2.7 (the try in a real MosAIc) is **not** done: it needs a
development build of MosAIc and opens its window on the maintainer's screen (§7.2, question 14).
What was checked instead, against MosAIc's source at `7af40c8`: the entry's fields, the path of
`mcp-plugins.json` and the environment merge.

| Gate | Result |
|---|---|
| `npm run lint` | clean |
| `npm run build` | builds the engine, `packages/server/dist/server.mjs` and `packages/installer/dist/cli.mjs` |
| `npm run test:quick` | 2,500 passed, 60 skipped (the cases that start processes), in 9.6 s |
| `npm run test:local` | 2,896 passed, in 125 s (budget 15 min) |
| `npm run test:seeded` | all 12 rows caught, the 5 new ones included (`docs/seeded-defects.md`) |
| `npm run conformance` | 318 cases, 0 failed |
| REP-5 | every ENG, VAL, SRV and INS case has a test; the pending file holds only MOS and QRK |
| The lone copy | `server.mjs` with its pack and profiles and no `node_modules` answers (SRV-1) |

Where the work differs from this list (each is in `docs/spec/07-decisions-and-open-questions.md`):
- **A bug the server tests found in the engine, fixed in `packages/core`:** a dictionary template
  that a rule always hits (`<use_tool {n}`) made the fake allocator loop for ever. The engine now
  refuses such a template with `INVALID_ARGUMENTS` and ends a run of 10,000 rejected fakes with
  `INTERNAL` (§2.8, §2.11; new tests under ENG-9). `refusal` is now exported from `core`.
- **The harness owns the child's stdout** in its default mode and uses the SDK's framing, because
  `StdioClientTransport` hides the stream that SRV-6 must read; an `sdk` mode uses that transport.
- **The scrub is the entry's first import**, because an ES module body runs after its imports.
- **Neutralisation keeps the quotes** round `__payment_required`, so JSON stays valid; a segment id
  of that name comes back changed (question 15).
- **A global set-up builds the server and the installer** in the local and full tiers
  (`scripts/vitest-global-setup.mjs`); seeded rows have a `tier`.
- **The installer's choices:** an empty plugins file counts as `[]`; nothing is written when
  nothing changes; a read-only file that must change is refused; duplicates of our entry collapse
  to one; `doctor` reports MosAIc's version as "unknown (not detected)". The entry's argument is
  `server/server.mjs`, not `server/index.js`.
- **Added `rigs/*` to the workspaces**, and `esbuild` as a pinned dev dependency.

Not verified: the `installer-os` job (macOS and Windows) has never run. The installer's tests
assume POSIX paths in places, such as `/usr/bin:/bin` and `new URL(...).pathname`, so that job may
fail on Windows until it is run once.

### Gate for commit 2

All of these must hold before the commit is proposed:
- [x] Commit 1's gate still holds.
- [x] `npm run build` produces `packages/server/dist/server.mjs`, which runs with no
  `node_modules` beside it. A test copies it alone to a temporary directory and calls it through
  the harness.
- [x] `npm run test:local` passes, including SRV-1 to SRV-12 and INS-1 to INS-7.
- [x] `npm run test:seeded`: every row fails as expected, the new ones included.
- [ ] Step 2.7 done, with its result in the report. **Not done** (question 14).
- [x] The specification sections named for commit 2 are updated.

Proposed subject: `feat(server): add the MCP server and the MosAIc installer`.

---

## Commit 3: proven inside a real MosAIc

**Delivers:**
- `rigs/e2e`: Playwright against a real MosAIc build;
- `rigs/fake-model`: a scripted model that speaks Ollama's API;
- the MOS cases;
- the quirk suite;
- CI's `e2e-mosaic` and `quirks-mosaic` jobs;
- the drafts for MosAIc's maintainers.

After this commit every automated tier of §5.2 exists and passes.

### Steps

- [ ] **3.1 Build MosAIc for the rig** (`rigs/e2e/build-mosaic.mjs`).
  - Clone `https://github.com/hypercycle-development/mosaic-companion` into
    `rigs/e2e/.mosaic/<commit>/` at the pinned commit, `7af40c8`, held in
    `rigs/e2e/mosaic-pin.json`.
  - Run `npm ci` and MosAIc's own build, the steps its `tests/e2e/` expects before launching
    with `args: ["."]`.
  - Reuse the build when the directory for that commit already exists and its build finished. A
    marker file is written last, so an interrupted build is redone and a finished one is not
    (`AGENTS.md`, rule 4).
  - CI caches the directory under the commit as key.
- [ ] **3.2 The launch fixture** (`rigs/e2e/fixtures.ts`).
  - Each test gets a fresh temporary `XDG_CONFIG_HOME`, so MosAIc gets a fresh profile and the
    user's real one is never touched.
  - It runs the **real installer** against that profile.
  - It launches MosAIc with Playwright's `_electron.launch`, the way MosAIc's
    `tests/e2e/app.spec.ts` does.
  - If MosAIc shows first-run screens, the fixture passes them the way MosAIc's own tests do.
    Write down which screens appeared.
  - Selectors are kept in one file, `rigs/e2e/selectors.ts`, taken from MosAIc's own
    `tests/e2e/mcp.spec.ts` where it has them. When a MosAIc release changes its UI, only that
    file changes.
- [ ] **3.3 The fake model** (`rigs/fake-model/`).
  - An HTTP server on `127.0.0.1` with a random port, speaking the part of Ollama's API that
    MosAIc's ollama provider uses. Read MosAIc's `src/services/AIService.ts` for which endpoints,
    and for the NDJSON stream format.
  - Each test loads a script of replies. A reply may contain MosAIc's tool-call markup; read
    `src/services/ActionParser.ts` for its exact form.
  - It records every request it receives, including the system prompt.
  - It can misbehave on request: a truncated stream, a stalled stream, malformed JSON.
  - *Tests of the fake itself:* it replays a script exactly, and records the system prompt.
    Prove this with a plain HTTP client before any MosAIc test uses it.
- [ ] **3.4 The MOS cases** (`rigs/e2e/tests/`).
  - MOS-1: the MCP page lists `distiller` and calls `distill`; the distillate is shown.
  - MOS-2: a test add-on with the `mcp:call` permission, loaded from a directory through MosAIc's
    Dev corner (`MOSAIC_ADDON_DEV=1`; MosAIc's `docs/build-an-extension.md`), calls `distill`.
    The add-on lives in `rigs/e2e/test-addon/`.
  - MOS-3: a one-to-one chat agent pointed at the fake model emits a valid tool call, and the
    result reaches the chat.
  - MOS-4: every misbehaviour listed in §5.8. Our server stays up and no payment screen opens.
    Assert this from the DOM: the payment modal's selector is absent.
  - MOS-5: every chat agent's system prompt, as the fake model records it, holds both
    descriptions whole.
- [ ] **3.5 The quirk suite** (`rigs/e2e/quirks/`).
  - QRK-1 to QRK-7, each against a small test server in `rigs/e2e/quirk-servers/`, not ours, as
    §5.8 says.
  - QRK-3 also confirms that our neutralisation defeats MosAIc's detection.
  - QRK-1 sleeps 61 s, so it runs only in `quirks-mosaic`, never in `e2e-mosaic`.
- [ ] **3.6 Drafts for MosAIc's maintainers** (`docs/upstream/`). Documentation only; nothing is
  sent from here.
  - `example-pr.md`: the stage-2 pull request of §6.4. It holds the issue text that comes first,
    the PR description, and the files of a short `examples/` entry calling the distiller from an
    add-on and from a chat agent.
  - `issue-bundling.md`: the stage-3 proposal.
  - One file per stage-4 issue of §6.4. Each states:
    - the behaviour, with the file and lines at `7af40c8`;
    - the quirk case that pins it;
    - the consequence;
    - the request.
- [ ] **3.7 Finish.**
  - Delete `scripts/case-ids-pending.txt`; REP-5 now requires every case.
  - Add rows to the seeded-defect table for:
    - the fixture skipping the installer (MOS-1 fails);
    - outbound neutralisation off (MOS-4 fails).
  - In `README.md`:
    - the status becomes "Stage 1 implemented; manual tests pending";
    - the layout loses every "(planned)" mark.
  - Add the `e2e-mosaic` and `quirks-mosaic` jobs.

### Gate for commit 3

All of these must hold before the commit is proposed:
- Commits 1 and 2's gates still hold.
- `xvfb-run npm run test:e2e` passes locally, twice in a row, from a fresh profile each time.
- `xvfb-run npm run test:quirks` passes against `7af40c8`.
- REP-5 passes with no pending ids.
- `npm run test:seeded`: every row fails as expected.
- `docs/upstream/` holds the drafts. They contain no claim beyond §1.2.

Proposed subject: `test(e2e): run the distiller inside a real MosAIc, and draft the upstream issues`.

---

## After the three commits: the maintainer's part

These close stage 1 of §6.4. None is done by an agent.

1. **MAN-1** (§5.10). With a real provider key, check that a real model calls `distill` when
   asked to clean text before sharing it. Save the replies as fake-model fixtures.
2. **MAN-2** (§5.10). On packaged MosAIc for macOS and for Windows, check that `install` gives a
   server that MosAIc starts.
3. Record both results in `docs/manual-tests.md`. Tick stage 1 as done in §6.4.
4. Decide the licence and the package name (§7.2, questions 1 and 2) before anything is
   published.
5. Open the issue of `docs/upstream/example-pr.md` on `mosaic-companion` before its pull request.
