# 1. Overview

## 1.1 Purpose

People paste text into AI tools that they would not want copied wholesale to someone else:
configuration with keys in it, an e-mail thread, a document with identity numbers. The distiller
takes such text and gives back a version with the sensitive values of known shapes replaced, so
that the version can be passed on.

It runs where the data is: on the user's machine, as a program MosAIc Companion starts. A remote
service cannot do this job, because the raw text would have to reach that service first.

It is offered to everything in MosAIc that can call an MCP server:
- one-to-one chat agents, as a tool;
- add-ons, through MosAIc's `mcp:call` permission;
- MosAIc's MCP page, by hand;
- MosAIc's own code.

Other programs can embed the engine library directly.

## 1.2 What it promises, and what it does not

The distiller makes one promise, and every description of it must stay within it:

> Known sensitive shapes and listed terms are replaced with fake values, and the result says
> exactly what was replaced.

**It replaces:**
- secrets of known shapes: vendor API keys, bearer tokens, credentials in URLs, values written
  after names like `password=` or `api_key:`, private keys, JSON Web Tokens;
- national, tax and health identifiers of North America, Europe, Asia-Pacific, Latin America and
  Africa, written in their issuers' own formats; the machine-readable zones of passports and
  identity cards;
- e-mail addresses, and North American phone numbers written with separators;
- IBANs, payment card numbers and crypto addresses, confirmed by their checksums;
- IP and MAC addresses, vehicle identification numbers, and Canadian, UK and Japanese postcodes;
- every word or phrase on lists the caller supplies.

**It flags,** and depending on the profile neutralises:
- chat-template control tokens, role labels, "ignore previous instructions" phrasing, tool-call
  markup, and remote Markdown images, which are how text tries to instruct or exfiltrate through
  an AI that later reads it;
- long Base64 runs;
- invisible characters, which it also removes.

**It does not:**
- find names, places or organisations that are not on a supplied list;
- find phone numbers outside North America, or identifiers whose format is shared with ordinary
  numbers (§3.6 lists each, with its false-positive rate);
- find combinations of harmless facts that together identify someone;
- find instructions written in plain language;
- decide what is relevant.

So it must never be called anonymisation, and its output must never be described as anonymous.

**The bar: precision first.** A rule is included only if a match is close to certain to be the
kind of value it claims, from the value alone. No rule looks at the words around a value. Recall
is given up for precision, because a distiller that mangles ordinary numbers is not used. §3.1
states the bar exactly.

## 1.3 Terms

| Term | Meaning |
|---|---|
| Segment | One piece of input text with an id. A request holds one or more. |
| Distillate | The output text: the input with replacements made. |
| Rule | One detector: a pattern with validators, or a term list. Rules are data, not code. |
| Rule pack | The file that holds the rules, their categories and their fake-value templates (§2.2). |
| Category | What a matched value is, such as `contact.email` or `gov_id.us_ssn`. |
| Validator | A check a pattern match must pass, such as a checksum. The list is closed (§3.5). |
| Fake value | What replaces a removed value: a value of the same kind that can never be real (§2.8). |
| Removal | The record of one replacement. It never holds the removed text. |
| Finding | The record of something flagged rather than replaced. |
| Profile | Which action each category gets: replace, flag, neutralise or block (§2.7). |
| Mode | How the distiller works. Only `rules` exists. A mode using a language model may follow; the interface already allows for it. |
| Scan view | The normalised form of a segment that rules run on. The distillate is built from the original text, not the scan view (§2.3). |

## 1.4 Components

| Component | What it is | Depends on |
|---|---|---|
| `packages/core` | The engine. A pure TypeScript library: text and rules in, distillate and records out. No file, network, clock or MosAIc access. | Nothing at run time |
| `rulepacks/default.json` | The default rule pack, shipped with the code (§3) | — |
| `profiles/` | The built-in profiles, as data (§2.7) | — |
| `packages/server` | The MCP server. Two tools, `distill` and `capabilities`, over stdio (§4). | `core`, the MCP SDK |
| `packages/installer` | Registers the server in MosAIc, checks the setup, uninstalls (§6.3) | — |
| `conformance/` | Example cases with their expected results (§5.5) | — |
| `rigs/` | Test harnesses (§5) | — |

The workspace packages are named `@mosaic-distiller/core`, `@mosaic-distiller/server` and
`@mosaic-distiller/installer`. `packages/core` may import `node:crypto`, for SHA-256, and nothing
else from Node: it reads no file, opens no socket and starts no process. The licence is Apache-2.0, the
licence of MosAIc itself, and every `package.json` says so. The package name is `ai-distiller`, held
in the one constant `PACKAGE_NAME` in `packages/core/src/name.ts`. The scoped names above stay until
the GitHub organisation exists. Every `package.json` is still `"private": true`, because nothing is
published yet. The distiller needs Node.js 20 or newer on the user's machine, because it runs as a
plugin inside MosAIc's own setup.

## 1.5 Principles

1. **Runs where the data lives.** Nothing the distiller does reaches the network.
2. **Rules are data.** Which values are detected is decided by the rule pack, not by code. The
   engine implements a fixed set of mechanisms: the pattern subset, the edge checks, the
   validators, term matching, the fake values.
3. **Deterministic.** The same input, rule pack and profile give the same bytes, on every
   machine, today and in ten years. No output depends on rule order, the clock or the locale. A
   second engine in another language, following this specification, must give the same bytes.
4. **Fails closed.** An error gives no distillate, never the unchecked text.
5. **Observable without content.** Every result counts what each rule did. No log line, record or
   counter holds input text.
6. **Never more than it can do.** Every result states the mode it ran in and the rule pack it
   used, and says it is uncertified (`certified: false`) until a public conformance suite exists.
