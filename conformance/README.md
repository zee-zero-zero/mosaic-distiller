# Conformance cases

Cases every engine build must pass, as JSON Lines. The format and the two kinds of case (rule
cases and golden cases) are specified in [`docs/spec/05-testing.md` §5.5](../docs/spec/05-testing.md#55-conformance-cases).

- `rules.jsonl`: one case per example of [`docs/spec/03-detectors.md`](../docs/spec/03-detectors.md),
  and the secret test values of §3.4. `{"id", "rule", "text", "expect": "hit"|"none", "category"?,
  "variant"?, "why"?}`. A `hit` case says the rule fires on the text; a `none` case says it does not,
  and `why` says where it stopped: `pattern` (never matched), `edge` (an edge rejected it) or
  `validator` (a validator did).
- `golden.jsonl`: `{"id", "profiles"?, "request", "result"}`, a whole request and its whole expected
  result, compared byte for byte. `profiles` adds profile files to the two built-in ones. In a
  request, three expansions keep limit cases small: `{"$repeat": [text, count]}` is a string,
  `{"$list": [count, template]}` a list of strings (`{i}` is the index) and
  `{"$segments": [count, text]}` a list of segments `s1`, `s2`, …. In a result, `"<unicode>"` stands
  for the engine's Unicode version, which differs by machine.
- `results.jsonl` is written by the runner and is not tracked.

Run the runner with `npm run conformance`. `golden.jsonl` is written by
`npx tsx scripts/golden-regen.ts`; read every change against the specification before keeping it.
