# Stage 3: shipping the server inside MosAIc, only if invited

This is a proposal, not a request. The distiller never depends on it.

**Title:** Proposal: ship a text-cleaning MCP server with MosAIc, as the app does its own plugins

**Body:**

The distiller (a local MCP server that replaces known kinds of sensitive value in text with fake
ones; it is not anonymisation, and it finds names only when the user lists them) installs today
by editing `mcp-plugins.json`, with a backup. That works, but it asks each user to run an
installer.

MosAIc starts some servers itself, as it does `AIM-Node-Tools` at start. Bundling would need a
line in the main process (`electron/main.ts`), which is a change to MosAIc's core. I know the
maintainers steer features out of the core, so I am asking before writing anything, and I will
not send a pull request unless invited.

If the answer is no, nothing changes: the installer stays the way in.

What I would bring if invited: the server as one bundled file, its tests (the end-to-end suite
of the server's repository runs against a pinned MosAIc build), and a short note in the MCP page
saying what the server does and does not do.
