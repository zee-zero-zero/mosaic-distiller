# Stage 4: every agent sees every tool of every server

**Title:** Every one-to-one chat agent is told about every connected server's tools

**The behaviour.** `src/components/Chatview.tsx:563-575` reads all connected servers once, and
`getMCPSystemPrompt` (`src/services/ActionParser.ts:177-199`) lists every tool of every server in
each agent's system prompt, at `7af40c8`. There is no per-agent list.

**The quirk case that pins it.** `QRK-6` (`rigs/e2e/quirks/qrk6-every-agent.spec.ts`): with two
other servers and two agents, both agents' system prompts list every server and its tools.

**The consequence.** A tool that is meant for one agent, or for none, is offered to all of them
and can be called by any. The prompt also grows with every server.

**The request.** Per-agent tool lists. A community pull request (#166) proposes per-agent tool
filtering; this issue is a use case for it.
