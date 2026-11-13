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

## 7.2 Open questions

1. **Licence.** Open source; which licence is chosen before the first release.
2. **Package and organisation names.** The npm package name and the GitHub organisation are being
   created. Every `<package name>` in this specification is replaced once they exist.
3. **The eight shapes kept with a weak check or none** (§3.1). Each can be moved to "not detected"
   by one decision. Kept for now.
4. **The two name-based secret rules** (`secret.keyed_value`, `secret.query_param`, §3.1). They
   break the precision bar on purpose. Kept for now.
5. **The additional secret shapes** (§3.4) were written from memory and must be checked against
   gitleaks' default rules before the first release.
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
