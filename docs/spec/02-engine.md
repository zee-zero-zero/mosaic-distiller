# 2. The engine

This part says exactly what `packages/core` does. It is written so that two independent
implementations, in any language, give byte-identical output for the same input, rule pack and
profile. Where TypeScript needs particular care to achieve that, a **TypeScript** note says how.

## 2.1 The order of work

For each request the engine does the following, in this order.

1. Validate the request and its limits (§2.11). Any failure refuses the whole request.
2. For each segment, build the scan view (§2.3).
3. Run every pattern rule (§2.4) and every term list (§2.5) over the scan view, collecting hits.
4. Resolve overlapping hits into spans (§2.6).
5. Give each span its action from the profile (§2.7). If any span's action is `block`, stop: the
   result holds no distillate, only the reason (§2.10).
6. Allocate a fake value to each redacted span (§2.8).
7. Build each segment's distillate from the original text (§2.9).
8. Build the records and the provenance (§2.10).

## 2.2 The rule pack

A rule pack is one UTF-8 JSON file:

```json
{"format": "rulepack/1",
 "name": "default", "version": "0.1.0",
 "categories": {"gov_id.us_ssn": {"class": "high", "surrogate": "shape"}},
 "rules": [{"id": "gov_id.us_ssn", "category": "gov_id.us_ssn", "kind": "pattern",
            "pattern": "[0-9]{3}-[0-9]{2}-[0-9]{4}", "flags": "", "edges": "numeric",
            "validators": ["ssn_rules"], "action": "redact"}],
 "dictionaries": [],
 "neutralise_literals": ["<use_tool", "<mosaic_ui", "\"__payment_required\""]}
```

**Fields.**
- `format` is exactly `rulepack/1`.
- `categories` declares every category a rule or dictionary uses. Each has a sensitivity `class`
  (`high`, `medium`, `low` or `defend`) and a fake-value template, `surrogate` (§2.8).
- `rules[]`: each has an `id`, a `category`, a `kind` and an `action`.
  - `kind` is `pattern` or `terms`. There is no third kind: a checksum is a validator on a pattern
    rule.
  - A `pattern` rule also has `pattern`, `flags`, `edges` and `validators` (§2.4).
  - A `terms` rule also has `terms[]`, a list of literal words matched as §2.5 says. It counts under
    its own rule id.
  - `action` is the rule's default: `redact`, `flag`, `neutralise` or `block`. A profile may
    override it (§2.7).
  - A rule may declare a fixed `variant`, as the postcode rules do (`ca`, `gb`, `jp`). A
    validator may also set one: `ipv4_scope` marks a private address with the variant `private`
    (§3.5).
- `categories`: each category's `surrogate` is the name of one of the built-in fake-value
  templates of §2.8 (`shape`, `mask`, `email`, `phone`, `ipv4`, `ipv6`, `mac`, `postal`), or a
  template that contains `{n}`. A pack must declare `hidden.invisible` and
  `inject.consumer_markup`, the two categories the engine reports without a rule (§2.3, §2.7).
- `dictionaries[]`: term lists the pack carries. Each has a `name`, a `category`
  (`dictionary.<name>`), a fake-value `template` that contains `{n}`, and `terms[]`. The default pack carries none:
  dictionaries normally come with each request (§4.2).
- `neutralise_literals[]`: exact strings a consumer must never receive unaltered. They are
  matched as literal text, case-sensitively, and are always neutralised (§2.7). The default pack
  lists MosAIc's own markup, because MosAIc acts on it when it appears in a tool result or a
  model reply: `<use_tool`, `<mosaic_ui` and `"__payment_required"`.

**The loader refuses a pack that has:**
- an unknown `format`, matcher kind, validator, action, flag or edge value;
- a pattern outside the portable subset (§2.4.1);
- a pattern that does not compile;
- a duplicate rule id;
- a rule or dictionary whose category is not declared;
- a term shorter than two code points after folding, or longer than 200 (§2.5);
- no rules at all;
- a category with no usable fake value for any n from 1 to 100 (§2.8). A template that is not
  one of the built-in names and has no `{n}` is also refused. The check cannot be made for the two
  value-dependent templates, `shape` and `postal`; for those a request that runs out of numbers
  fails closed (§2.11).

A refused pack stops the server from starting. There is no partial load.

**Loader codes.** Each refusal has its own code: `PACK_FORMAT`, `PACK_SCHEMA` (a missing, mistyped
or unknown field), `PACK_UNKNOWN_KIND`, `PACK_UNKNOWN_VALIDATOR`, `PACK_UNKNOWN_ACTION`,
`PACK_UNKNOWN_FLAG`, `PACK_UNKNOWN_EDGE`, `PACK_PATTERN_SUBSET`, `PACK_PATTERN_COMPILE`,
`PACK_DUPLICATE_ID`, `PACK_UNDECLARED_CATEGORY`, `PACK_TERM_TOO_SHORT`, `PACK_TERM_TOO_LONG`,
`PACK_NO_RULES` and `PACK_NO_FAKE`. A profile (§2.7) is refused with the codes of the same names
with `PROFILE_` in place of `PACK_`: `PROFILE_FORMAT`, `PROFILE_SCHEMA`, `PROFILE_UNKNOWN_ACTION`
and `PROFILE_UNDECLARED_CATEGORY`.

**Version hash.** SHA-256 of the pack in the JSON Canonicalization Scheme (RFC 8785), written as
lower-case hex. A pack holds no floating-point numbers, so every implementation's canonical form
is the same. Because the order of the file never matters (below), the rules are first put in
code-point order of their ids, the dictionaries of their names, and the terms and the literals of
their text; the order of a rule's `validators` is part of the pack and is kept.

**Order does not matter.** No output may depend on the order of rules, dictionaries, terms or
literals in the file. Every tie is broken by the rules in §2.5, §2.6 and §2.8, never by position
in the file.

## 2.3 The scan view, and positions

Rules never run on the original text. They run on a **scan view** of each segment. The distillate
is built from the **original** text (§2.9).

**Positions.** Every position the engine reports is a Unicode code point index into the original
segment. `start` is inclusive and `end` is exclusive.

> **TypeScript.** JavaScript strings index UTF-16 code units, so an emoji before a match shifts
> every naive position by one. The engine holds each segment as an array of code points, and
> converts at every boundary with the JavaScript string API.

**Invisible characters** fall into two groups:

| Group | Characters | In the scan view | In the distillate |
|---|---|---|---|
| Removed | U+200B zero-width space; U+2060 word joiner; U+2061–U+2064 invisible operators; U+180E; U+00AD soft hyphen; U+FEFF anywhere but the start of a segment; U+202A–U+202E and U+2066–U+2069 bidirectional embeddings, overrides and isolates; U+FFF9–U+FFFB interlinear annotation; U+E0000–U+E007F tag characters outside an emoji tag sequence; U+E0100–U+E01EF and U+FE00–U+FE0D variation selectors; U+200C and U+200D between two ASCII letters or digits | dropped | deleted, and reported as one `hidden.invisible` finding per run of them |
| Kept | U+200C and U+200D elsewhere (joining in Persian, Indic scripts and emoji); U+200E, U+200F and U+061C direction marks; U+FE0E and U+FE0F; a U+FEFF at the start of a segment; emoji tag sequences (U+1F3F4, then U+E0020–U+E007E, ending U+E007F, as in the flags of Scotland and Wales) | dropped | kept |

**Building the scan view.**
1. Drop both groups of invisible characters.
2. Replace each remaining code point by its NFKC form, taken one code point at a time. Full-width
   digits become ASCII digits and ligatures expand (`ﬁ` becomes `fi`). Nothing composes across
   code points, which keeps the map back to the original simple.
3. Each scan-view code point records the original code point it came from.

**Mapping a span back.** A span in the scan view maps to the original range that runs from its
first character's source to its last character's source. That range includes any invisible
characters removed inside it. So `536‍-22-8914`, with a zero-width joiner hidden in it, is still
found, and its whole original range is replaced. A zero-length span (§2.4.1) sits just after the
original character of the scan-view character before it, or at 0 when nothing comes before.

**Unicode version.** Implementations may follow different Unicode versions. Every result records
the engine's Unicode version, and conformance cases avoid characters assigned after Unicode 15.0.

> **TypeScript.** The Unicode version is `process.versions.unicode`.

## 2.4 Pattern rules

### 2.4.1 The portable pattern subset

Patterns must mean the same in every regular-expression engine, and must stay fast on hostile
input. So a pattern is restricted to:
- syntax that RE2 accepts;
- no lookaround, no backreferences, no inline flags;
- at most one capturing group. Group 1 is the span the rule reports, so a secret rule can keep
  `token=` and report only the value. With no group, the whole match is the span. An empty group 1
  is a zero-length span, which the secret mask fills: `token=` becomes `token=***`;
- character classes written in ASCII: `[0-9]`, never `\d`, `\w`, `\s` or `\b`, whose meanings
  differ between engines. A literal may be any character, such as `〒`;
- every repetition bounded, as `{m,n}` with `n` at most 65,536 and at least 1; never `*` or `+`.
  `?` is the bound `{0,1}` and is allowed; a lazy `?` after a bound, and `{m,}`, are not;
- a quantified group only when each iteration begins with a character the repetition before it
  cannot match. `(?:\.[0-9]{1,3}){3}` is allowed; `([a-z]{1,9}){1,9}` is not. This keeps a
  backtracking engine linear on hostile input. The loader checks groups whose maximum is above 1:
  the characters a variable-length repetition just before the group can consume, and the characters
  a variable-length repetition at the end of the group's body can consume, must not include any
  character the group can begin with. A repeated capturing group is refused;
- alternatives that share a prefix written longest first: `NW|N`, never `N|NW`. Every engine
  takes the first alternative that matches, and the edge check would otherwise reject the short
  one instead of trying the long one. The loader refuses this where the alternatives end the
  pattern and are made only of single characters of fixed width. Where something must follow
  (`(?:signature|sig)=`), backtracking tries the next alternative, and the order is free.
- escapes only of the syntax characters `^$\.*+?()[]{}|` and `/`, of `-` inside a class, and
  `\t`, `\n` and `\r`: anything else (`\d`, `\x41`, `\p{L}`, a backreference) is refused. The
  wildcard `.`, empty groups and alternatives, and POSIX classes are refused.

The loader checks the subset by parsing each pattern itself, not by compiling it, because
JavaScript accepts constructs the subset forbids.

### 2.4.2 Flags

- `i`: ASCII case-insensitive.
- `m`: `^` and `$` also match at a line break. **A line break is U+000A only.** A lone `\r`,
  U+2028 and U+2029 are not line breaks.

> **TypeScript.** Patterns are compiled with the flags `g` and `u` (plus `i` when the rule has
> `i`, and `d` when it has a group, to read group 1's position), and driven by `lastIndex`. `u` is
> there so that a negated class such as
> `[^/ \t\r\n@'"<>]` never matches half of a surrogate pair. With `u`, JavaScript's `i` uses
> Unicode case folding. That is still equivalent to ASCII-only here, because the only two
> non-ASCII characters that fold to ASCII letters, the long s (U+017F) and the Kelvin sign
> (U+212A), are already ASCII in the scan view after NFKC.
>
> JavaScript's own `m` flag treats `\r`, U+2028 and U+2029 as line breaks, so it is **not** used.
> The engine rewrites `^` under `m` as "at the start of the segment, or after U+000A", and `$` as
> "at the end of the segment, or before U+000A".

### 2.4.3 Edges

Edges replace `\b` and lookbehind. They are checked in code, after a match.

| `edges` | The match is rejected when |
|---|---|
| `word` | the character before it or after it is `[A-Za-z0-9_]` |
| `numeric` | as `word`; or the character before it is `.` or `-` with a digit before that; or the character after it is `.` or `-` with a digit after that |
| `word_before` | the character before it is `[A-Za-z0-9_-]`. Nothing after it is checked, because a URL's user-info is followed by its host. |
| `word_colon` | as `word`; or the character before it or after it is `:`. Used for IPv6, so that the tail of a rejected address (`db8::8a2e:370:7334` inside `2001:db8::8a2e:370:7334`) is not taken as an address of its own after the scan restarts (§2.4.4) |
| `none` | never |

The characters checked are those of the scan view around the whole match, not around group 1.
So `1.3.6.1` is not taken as an IPv4 address out of the identifier `1.3.6.1.4.1`, and an SSN shape
is not taken out of a longer hyphenated number.

### 2.4.4 The scan

Each rule scans each segment's scan view leftmost-first:
1. Find the leftmost match at or after the current position.
2. If its edges reject it, or any validator rejects it, resume at the rejected match's start
   plus one code point.
3. Otherwise record the hit, and resume at the end of the match. A zero-length match resumes
   one code point later.

Every implementation scans in exactly this way, which is what keeps outputs identical.

> **TypeScript.** The engine drives the scan itself with a sticky or global `RegExp` and
> `lastIndex`, stepping over surrogate pairs when it advances by one code point.

### 2.4.5 Validators

`validators` names functions from the closed list of §3.5. They run in order on the matched text
(the whole match, not group 1). A validator is also given the next two characters of the scan view
after the match, when there are any; only `email_shape` reads them, to refuse `git@host:path`. A hit is recorded only if every one accepts it. A validator may
also set the hit's `variant`.

**No validator depends on the date of the run.** Where an identifier encodes a two-digit year,
every century the issuer could mean is tried. So the same input gives the same output next year.

### 2.4.6 Values that are never hits

Values reserved for documentation or fiction are never hits. The validators enforce this:
- the domains `example.com`, `example.net` and `example.org`, and the top-level domains
  `.example`, `.invalid`, `.test` and `.localhost` (RFC 2606, RFC 6761);
- the telephone numbers 555-0100 to 555-0199;
- the IPv4 ranges 192.0.2.0/24, 198.51.100.0/24 and 203.0.113.0/24 (RFC 5737), and 0.0.0.0/8;
- the IPv6 range 2001:db8::/32 (RFC 3849);
- the MAC addresses `00:00:5e:00:53:00` to `00:00:5e:00:53:ff` (RFC 7042).

Fake values are drawn from these ranges (§2.8), so running the distiller again on a distillate
finds none of its own fakes.

## 2.5 Term lists

A term list is a dictionary of literal words or phrases, such as the user's contacts or a client's
name. A term matches when its **folded** form occurs in the folded scan view between two
boundaries.

**Folding**, one code point at a time:
1. lower-case the code point with Unicode's default mapping and no locale;
2. decompose the result with NFKD;
3. drop every combining mark (general category Mn).

So `Ștefan`, `ŞTEFAN` and `Stefan` all fold to `stefan`. In addition, every run of white space
(the Unicode property White_Space) folds to one space. Each folded code point keeps its map to
the original. `ß` stays `ß`, so `Straße` does not match `Strasse`; that is a known limit.

**Boundaries.** The character before the match and the character after it must not be a letter
or a digit (general categories L and N), or must be the edge of the segment. So `Ana` is not found
in `Banana`, but it is found in `ana@example.com`, in `/home/ana/` and in `ana_smith`. Terms are
not transliterated, so `Ana` does not match `Ана`.

**Choosing among terms.** The leftmost match wins. Among matches at the same start, the longest
wins. Among equal ones, the term whose folded form comes first in code-point order wins.

**Terms are literals.** They are never compiled as patterns, so a term cannot inject a pattern. A
term shorter than two code points after folding is refused. Terms never appear in a record, a
counter or a log line; only the dictionary's name and counts do.

> **TypeScript.** Use `toLowerCase()` on each code point alone, `normalize("NFKD")`, and the
> property escapes `\p{Mn}`, `\p{L}`, `\p{N}` and `\p{White_Space}`. Never `\s`, whose set
> differs from White_Space, and never `toLocaleLowerCase`.

## 2.6 Overlapping hits

Every hit is kept for the counters. For replacement, hits that overlap or touch are merged into
one span. The merged span takes the category of the longest hit. On a tie it takes the first, in
this order of families: `secret`, `gov_id`, `health_id`, `financial`, `contact`, `network`,
`vehicle`, `org_id`, `dictionary`. On a tie within a family, the rule id that comes first in
code-point order wins.

A merged span that holds a neutralise literal (§2.7) takes that literal's category and action,
whatever the lengths. Defend hits (the categories of class `defend`) are not merged with redaction
hits. They are
resolved among themselves the same way, and recorded as findings. Where a defend span lies inside
a redacted span, the redaction covers it and the finding is still recorded.

## 2.7 Actions and profiles

| Action | What happens to the span | Record |
|---|---|---|
| `redact` | replaced by a fake value (§2.8) | a removal |
| `flag` | kept unchanged | a finding |
| `neutralise` | replaced by `[neutralised: <category>]`, which no model reads as a control token | a finding |
| `block` | the whole request returns no distillate (§2.10) | the reason |

A **profile** maps categories to actions, overriding the rules' defaults. A key is a category
(`network.ipv4`) or a category and variant (`network.ipv4/private`); the more specific key wins.
`neutralise_literals` are always neutralised, whatever the profile says.

Two profiles are built in:

| Category | `agent` (the default) | `document` |
|---|---|---|
| Secrets and personal-data categories | redact | redact |
| `network.ipv4` and `network.ipv6`, variants `private`, `loopback`, `link_local` | redact | flag |
| `inject.special_token` (chat-template control tokens) | neutralise | flag |
| `inject.tool_markup` | neutralise | flag |
| `inject.md_image_remote` | neutralise | flag |
| `inject.role_label`, `inject.override_phrase` | flag | flag |
| `hidden.encoded_blob` | flag | flag |
| `hidden.invisible` | flag (the characters are always deleted) | flag |
| `inject.consumer_markup` (the literals) | neutralise | neutralise |

A profile is a file `{"format": "profile/1", "name": "agent", "actions": {"<category>" or
"<category>/<variant>": "<action>"}}`; `profiles/agent.json` and `profiles/document.json` are the
two built-in ones. A category that a profile does not name keeps its rule's default action. A key
may name only a declared category, and a value only a known action (§2.2). `block` also applies to
`hidden.invisible`: a request holding any removed invisible character is then blocked.

`agent` is for text that an AI with tools will read. `document` is for text about prompts and
chats, where role labels and template tokens are content, not attacks. No built-in profile blocks.

An unknown profile name refuses the request.

## 2.8 Fake values

A redacted span is replaced by a fake value of the same kind, drawn from a range reserved for
documentation or fiction. It reads naturally to a person or a model, and it can never be a real
address, number or host. `n` counts 1, 2, 3 … within each category of one request.

| Category | Template | Why it can never be real |
|---|---|---|
| `contact.email` | `person{n}@example.com` | a reserved domain that accepts no mail |
| `contact.phone` | `(202) 555-01{nn}` for n up to 99 (two digits), then `(202) 555-0100 ext. {n}` | 555-0100 to 555-0199 are reserved for fiction |
| `network.ipv4` | the n-th address of 192.0.2.0/24, then of 198.51.100.0/24, then of 203.0.113.0/24 (hosts 1–254 of each) | reserved for documentation |
| `network.ipv6` | `2001:db8::{n in lower-case hex}` | reserved for documentation |
| `network.mac` | `00:00:5e:00:53:{n as two hex digits}` for n up to 255 | reserved for documentation |
| `contact.postal_code`, variant `ca` | the shape-preserving form with `D` for every letter: `D0D 0D1` | Canada Post never uses D |
| `contact.postal_code`, variant `jp` | the shape-preserving form without the `〒` mark: `000-0001` | without the mark it is not a hit, and no postcode is all zeros |
| `secret.*` | `***`, not numbered | a fake key is never invented |
| `dictionary.<name>` | the dictionary's own template, such as `Contact {n}`; by default `Term {n}` | chosen by the caller |
| every other category, and any template that runs out | the **shape-preserving** form: each digit becomes `0`, each letter `X` (`x` if lower case), every other character is kept; then n is written in decimal into the rightmost digit positions. `536-22-8914` becomes `000-00-0001`; `4111 1111 1111 1111` becomes `0000 0000 0000 0001` | all-zero identifiers fail their own rules |

**Allocation.** A value's fake is the template at the smallest n not yet used in its category
such that:
1. no rule in the pack hits the fake, **scanned on its own** as a one-segment text;
2. the fake does not occur anywhere in the request's input, compared on the original text.

The first condition makes the distiller idempotent: run again on a distillate, it finds nothing
it replaced. The second guarantees that each fake stands for exactly one value. Both are checked,
not assumed.

**The same value gets the same fake.** Two hits are the same value when their canonical forms are
equal:
- for e-mail: the whole address in lower case;
- for dictionary terms: the term they matched;
- for everything else: the value with every character that is not a letter or digit removed, and
  ASCII letters upper-cased. So `536-22-8914` and `536 22 8914` are one value.

**Numbering** follows first occurrence: segments in the order given, then start position in the
original text.

**Merged spans** (§2.6) get the fake of their winning category, and are canonicalised from the
whole merged text.

**Details the table leaves open.**
- The built-in template names of a category's `surrogate` (§2.2) are the rows above: `email`,
  `phone`, `ipv4`, `ipv6`, `mac`, `postal` (the `ca` and `jp` forms, and the shape-preserving form
  otherwise), `mask` (`***`) and `shape`. Any other surrogate is a template that contains `{n}`.
- The shape-preserving form is taken from the span's scan-view text, not its original text, so it
  never carries a removed invisible character. Letters and digits are those of Unicode (`\p{L}`,
  `\p{Nd}`).
- The IPv6 template is `2001:db8::{n}` up to n = 65,535, and the MAC template up to 255; after
  that they run out like the others.
- `n` counts per category, not per variant: the third postal code of a request has n = 3 whatever
  its variant.
- "The smallest n not yet used" means not yet given to another value. A number skipped for one
  value (its fake was hit, or taken) stays free for a later value, whose fake may differ.
- If the shape-preserving form cannot hold n, because the value has too few digit positions (a
  role label has none), the fake is `[redacted {n}]`, which is checked like any other fake.
- Two requests' fakes are not tied to each other: only the request's own input is checked.

## 2.9 The distillate

Per segment, the distillate is the original text with three changes:
1. the "removed" invisible characters of §2.3 deleted;
2. each redacted span replaced by its fake;
3. each neutralised span replaced by its marker.

Nothing else changes. In particular the distillate is not NFKC-normalised: a user's own text
keeps its characters.

A neutralised defend span (§2.6) that overlaps a redacted span is united with it, and the
redaction's fake covers the union; the finding of the defend span is still recorded with its own
range.

## 2.10 The result

For the one-segment input `Write to jane.doe@northwind-mail.com.`:

```json
{"mode": "rules",
 "segments": [{"id": "1", "distillate": "Write to person1@example.com."}],
 "removals": [{"segment": "1", "start": 9, "end": 36, "category": "contact.email",
               "rule": "contact.email", "fake": "person1@example.com"}],
 "findings": [],
 "warnings": [],
 "provenance": {
   "rulepack": {"name": "default", "version": "0.1.0", "hash": "<sha256>"},
   "profile": "agent",
   "engine": {"name": "<package name>", "version": "0.1.0", "unicode": "15.1"},
   "certified": false,
   "counters": {"contact.email": {"evaluated": 1, "candidates": 1, "rejected_edge": 0,
                                  "rejected_validator": 0, "fired": 1}}}}
```

- A **removal** is `{segment, start, end, category, variant?, rule, fake}`. `start` and `end`
  are in the original segment. The fake is safe to show.
- A **finding** is `{segment, start, end, category, variant?, rule, action}`.
- **Warnings** are the engine's own notices: `{code, segment}`, one per segment and code. A lone
  surrogate replaced by U+FFFD is `LONE_SURROGATE`.
- **Counters**, per rule: `evaluated` is the number of segments the rule ran on; `candidates`,
  matches before checks; `rejected_edge` and `rejected_validator`; `fired`, hits recorded. Term
  lists count per dictionary.
- **Blocked.** If any span's action is `block`, the result has `"blocked": {"category", "rule"}`,
  no `segments`, no `removals`, no `findings` and no `warnings`, and the provenance, in the order
  `mode`, `blocked`, `provenance`. `blocked` names the first blocking span, in the order of the
  records.
- No part of a result ever holds removed text, a term, or any other input text except inside a
  distillate.

Keys are written in the order shown, removals and findings are sorted by segment order then
`start` then `end` then `rule`, and the result is serialised without insignificant white space.
That makes results comparable byte for byte.

## 2.11 Limits and failures

| Limit | Value | Over it |
|---|---|---|
| Segments per request | 1 to 1,000 | `EMPTY_INPUT`, `TOO_MANY_SEGMENTS` |
| Segment id | 1 to 64 characters of `[A-Za-z0-9._-]`, unique | `INVALID_ARGUMENTS`, `DUPLICATE_SEGMENT_ID` |
| Total text | 1,048,576 UTF-8 bytes | `INPUT_TOO_LARGE` |
| Dictionaries per request | 20 | `TOO_MANY_DICTIONARIES` |
| Terms per request, all dictionaries | 10,000; each 2 to 200 code points after folding | `TOO_MANY_TERMS`, `TERM_TOO_SHORT`, `TERM_TOO_LONG` |

Limits are exact: a request at the limit passes, and one over it is refused with no partial
result. An empty segment text is allowed and gives an empty distillate.

The checks are made in this order, and the first failure is the refusal: the shape of the request
(`INVALID_ARGUMENTS`: a missing, mistyped or unknown argument, or an objective that is not
`store`, `forward` or `task`); the mode; the profile; the number of segments; each segment id in
turn (its form, then whether it repeats); the number of dictionaries; each dictionary (its name is
1 to 32 characters of `[a-z0-9_]`, unique, and not one the pack already carries; its template
contains `{n}`; all otherwise `INVALID_ARGUMENTS`); the number of terms; each term's folded length;
the total size.

**Fail closed.** Any internal error refuses the request with `INTERNAL` and no distillate. A
category that runs out of fakes (§2.8) is an internal error. The
engine never returns the original text in place of a distillate.

**Speed.** One megabyte dense with matches finishes within 2 seconds on an ordinary laptop. A
hostile input built to make one pattern backtrack finishes within 100 milliseconds per pattern.
