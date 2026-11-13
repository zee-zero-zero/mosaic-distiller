# Instructions for AI agents working in this repository

## What this repository is

A distiller for MosAIc Companion: a local MCP server, and the TypeScript engine inside it, that
replaces known kinds of sensitive data in text with fake values. Read [`README.md`](README.md)
first, then the specification in [`docs/spec/`](docs/spec/).

## The specification is authoritative

- Code follows `docs/spec/`. When code and specification disagree, the specification wins until
  it is changed.
- A change of behaviour changes the specification, the tests and the code in the same commit.
- Where the specification is silent or ambiguous, do not guess. Record the question in
  `docs/spec/07-decisions-and-open-questions.md` and ask.

## Rules that are easy to break

- **Neutral names only.** Name no company, internal project or product behind this work, in code,
  comments, tests, documentation, commit messages, package metadata or issues. Maintainers check
  this before every push with a word list kept outside the repository (REP-1, §5.9 of the testing
  specification). Never add such a list here, not even as hashes.
- **No real personal data, ever.** Test values come from the examples in
  `docs/spec/03-detectors.md`, from generators with a fixed seed, or from ranges reserved for
  documentation. Generated secrets are synthetic and must not be live keys.
- **No content in logs.** Log events carry codes and counts, never a string taken from input.
  Stdout carries only the MCP protocol.
- **Positions are Unicode code points**, not UTF-16 units (`02-engine.md` §2.3).
- **Output is deterministic.** No output may depend on rule order, the clock, the locale or the
  machine.
- **Tests first.** Every mechanism has a direct test, and about a third of each mechanism's cases
  are adversarial (`05-testing.md`).

## How to work here

These rules bind every change, by a person or an agent.

1. **Ask when a wrong guess is expensive.** Where an ambiguity has real consequences (a public
   name, an interface, a behaviour other people will rely on), ask before writing. Where it is
   cheap to reverse, decide, and state the assumption in the change.
2. **Do all the work you can before asking.** Read, check and make every edit the task already
   allows first; then ask every open question at once. Stop at a real decision point rather than
   building on a guess.
3. **Documentation never lies about the code.** Every source file opens with a comment saying
   what it provides. A change that alters behaviour updates that comment, the specification and
   any README that describes the file, in the same commit. A commit with known drift is not
   ready. Drift noticed elsewhere is fixed if it is in scope, and reported if it is not.
4. **Long or costly work can resume.** A run that spends real time, compute or paid calls saves
   its progress, so that an interruption costs at most the last step.
5. **Tests try to break things.** Each mechanism is tested from its input space, with
   adversarial cases, before anything costly exercises it; and a failure can be explained from
   its own record.
6. **Write for a reader who was not there.** Reports, commit messages and documents are
   self-contained: say what each named thing is, one fact per sentence where it matters, and end
   when the content ends.

## Commands

Not defined yet. The first commit that adds code defines them here: install, the quick test tier,
the local tier, lint and type-check.
