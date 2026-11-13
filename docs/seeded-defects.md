# Seeded defects

For each core mechanism, the tests are run against a copy of the code with that mechanism
disabled, and must fail (`docs/spec/05-testing.md` §5.1). A row whose cases still pass is a test
that could never fail. Written by `scripts/seeded-defects.mjs`; do not edit by hand.

| Mechanism disabled | File | Cases that must fail | Failed / ran | Caught |
|---|---|---|---|---|
| Normaliser off (invisible characters are not classified, so none is dropped from the scan view) | `packages/core/src/text/scanview.ts` | ENG-4, ENG-5 | ENG-4: 3/4; ENG-5: 2/2 | yes |
| Overlap resolution off (hits are never merged) | `packages/core/src/resolve.ts` | ENG-7 | ENG-7: 5/10 | yes |
| Same-value numbering off (every occurrence is a new value) | `packages/core/src/fakes.ts` | ENG-8 | ENG-8: 5/8 | yes |
| Allocation checks off (a fake is not checked against the rules or the input) | `packages/core/src/fakes.ts` | ENG-9, ENG-10 | ENG-9: 5/10; ENG-10: 2/45 | yes |
| Edge check off (every match passes its edges) | `packages/core/src/pattern/scan.ts` | ENG-11 | ENG-11: 1/0 (suite refused to load) | yes |
| Defend rules off (defend hits are dropped) | `packages/core/src/engine.ts` | ENG-16 | ENG-16: 20/323 | yes |
| The redactor skips the last value of a segment | `packages/core/src/distillate.ts` | ENG-1 | ENG-1: 40/43 | yes |
| The environment scrub off (no variable is deleted) | `packages/server/src/safeguards/scrub.ts` | SRV-2 | SRV-2: 5/6 | yes |
| Outbound neutralisation off (a tool result carries its text as it is) | `packages/server/src/app.ts` | SRV-4 | SRV-4: 2/7 | yes |
| The deadline off (no timer is set for a call) | `packages/server/src/pool.ts` | SRV-8 | SRV-8: 4/4 | yes |
| The byte-preserving edit replaced by re-serialisation (other entries are written again from their parsed value) | `packages/installer/src/plugins-file.ts` | INS-1 | INS-1: 11/58 | yes |
| The temporary-file rename replaced by a direct write over the original | `packages/installer/src/plugins-file.ts` | INS-3 | INS-3: 3/4 | yes |
