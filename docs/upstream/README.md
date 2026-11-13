# Drafts for MosAIc's maintainers

Documentation only. Nothing here has been sent. Each file is the text of an issue or pull request
to `hypercycle-development/mosaic-companion`, written against commit `7af40c8` (the commit the
end-to-end rig builds, `rigs/e2e/mosaic-pin.json`). They follow the stages of
[`06-mosaic-integration.md`](../spec/06-mosaic-integration.md) §6.4.

Rules for these drafts:

- Each states only what the distiller does and does not do as written in the specification
  ([`01-overview.md`](../spec/01-overview.md) §1.2). None calls it anonymisation.
- Each claim about MosAIc names a file and lines at `7af40c8` and a test of this repository that
  pins it (`rigs/e2e/quirks/`). A MosAIc release that changes the behaviour fails that test first.
- MosAIc's contribution guide asks for an issue before substantial work, so the issue in
  `example-pr.md` is opened before its pull request. Nothing is sent without a maintainer of this
  repository deciding to.

| File | Stage of §6.4 |
|---|---|
| [`example-pr.md`](example-pr.md) | 2: the issue, then the pull request that adds an example under `examples/` |
| [`issue-bundling.md`](issue-bundling.md) | 3: shipping the server inside MosAIc, only if invited |
| [`issue-environment.md`](issue-environment.md) | 4: servers inherit MosAIc's whole environment |
| [`issue-chat-history.md`](issue-chat-history.md) | 4: chat history stores tool arguments and results in full |
| [`issue-per-agent-tools.md`](issue-per-agent-tools.md) | 4: every agent sees every tool of every server |
| [`issue-payment-scan.md`](issue-payment-scan.md) | 4: tool results are scanned for payment signals |
