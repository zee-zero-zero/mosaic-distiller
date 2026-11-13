# Stage 4: chat history stores tool arguments and results in full

**Title:** Tool-call arguments and results are saved in the chat history and resent to the next provider

**The behaviour.** In `src/components/Chatview.tsx:666-853` at `7af40c8`, a tool call is saved in
the session with its arguments (the `<use_tool>` tag, kept in the assistant message) and its
result (a `[Tool Output ...]` message). Both are saved with `aiAgentsHistory.save`, and both are
sent again to whichever provider the agent uses on its next turn.

**The quirk case that pins it.** `QRK-5` (`rigs/e2e/quirks/qrk5-history.spec.ts`): a call to a text
cleaning tool from a chat leaves the stored session holding the arguments, which contain the
original text.

**The consequence.** A tool meant to keep text out of what is shared cannot do so when an agent
calls it: the text it was given is already in the chat, and is stored there. The distiller
protects what is passed on after it, and its README says so.

**The request.** A way for a tool to keep its arguments out of history, or at least a visible
mark on a session that holds tool arguments.
