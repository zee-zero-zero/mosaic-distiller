# Stage 4: servers inherit MosAIc's whole environment

**Title:** Stdio MCP servers start with MosAIc's entire environment, including provider keys

**The behaviour.** `electron/integrations/mcp/MCPClient.ts:159-165` at `7af40c8` builds a server's
environment as `{ ...process.env, ...entry.env }`. Every variable MosAIc was started with,
including any provider API key, reaches every stdio server, whatever the server is for.

**The quirk case that pins it.** `QRK-4` (`rigs/e2e/quirks/qrk4-env.spec.ts`): a variable set in
MosAIc's environment and in the entry holds the entry's value. The same merge means a variable
that is only in MosAIc's environment is in the server.

**The consequence.** A server that has no need of a key still holds it, and so does anything the
server starts. A server that handles text meant to be kept private is a poor place for a key.
The distiller deletes every variable it does not need at start (`SRV-2`), but a server that does
not do this holds them.

**The request.** Pass a minimal environment by default (for example `PATH`, `HOME`, the locale
and the temporary directory), plus the entry's own `env`, and let an entry opt in to more.
