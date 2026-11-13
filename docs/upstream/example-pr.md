# Stage 2: an example under `examples/`

Two texts, in the order they are sent: the issue first (MosAIc's contribution guide asks for an
issue before anything beyond small fixes), then the pull request once the issue is answered.

## The issue

**Title:** An example MCP server that replaces sensitive values in text with fake ones

**Body:**

I would like to add `examples/mcp/distiller/`, a short README that shows how to call a local MCP
server, `distiller`, from an add-on and from a chat agent. It is documentation only; it changes
no MosAIc code.

What the server does: it takes text and returns the same text with known kinds of sensitive
value replaced by fake values that cannot be real, for example `person1@example.com`. The kinds
are secrets and API keys, e-mail addresses, North American phone numbers, card numbers, IBANs,
national ID numbers, IP addresses, and words the user lists. It runs on the user's machine, uses
fixed rules and no language model, and has no network access.

What it does not do: it does not find names or facts that are not on the user's list, and it is
not anonymisation.

It registers itself the way `examples/mcp/mcp-hello` does, by adding an entry to
`mcp-plugins.json`, and the user presses Refresh on the MCP page.

One thing the example must say, and I would like the maintainers' view on its wording: when a
chat agent calls any tool, MosAIc keeps the call's arguments and result in the chat history
(`src/components/Chatview.tsx:666-853`). So text given to an agent to distil is already in that
chat. The example says to distil from the MCP page or an add-on first when that matters.

## The pull request

**Title:** docs(examples): add a distiller example, called from an add-on and from a chat agent

**Description:**

Adds `examples/mcp/distiller/README.md` and `examples/mcp/distiller/addon-call.js`. No code under
`src/` or `electron/` changes. Refs the issue above.

- The README shows installing the server, pressing Refresh, calling `distill` from the MCP page,
  from an add-on with the `mcp:call` permission, and from a chat agent.
- It states what the server replaces and what it does not, and that when a chat agent calls it
  the original text is already in that chat.
- The add-on snippet is the one the end-to-end rig of the server's repository runs against MosAIc
  `7af40c8`, so it is known to work there.

**Files**

`examples/mcp/distiller/README.md`

````markdown
# distiller

A local MCP server that replaces known kinds of sensitive value in text with fake ones.

| Tool | Arguments | What it does |
|------|-----------|--------------|
| `distill` | `text` (string), or `segments`; optional `dictionaries` | Returns the text with secrets, e-mail addresses, phone numbers, card numbers, IBANs, ID numbers, IP addresses and your listed words replaced by fakes such as `person1@example.com`, and a list of what was replaced (never the values) |
| `capabilities` | none | Reports the rule pack and its categories |

It does not find names that are not on your list, and it is not anonymisation.

## Setup

Install it with its installer (it adds one entry to `mcp-plugins.json`, keeps every other entry
as it was, and writes a backup), then press **Refresh** on the MCP page.

## Call it

- **From the MCP page:** choose `distiller`, then `distill`, and give `{"text": "..."}`.
- **From an add-on** that declares the `mcp:call` permission: see `addon-call.js`.
- **From a chat agent:** ask it to clean the text before sharing it.

## Read this first

When a chat agent calls a tool, MosAIc stores the call's arguments and result in the chat history.
Text you give an agent to distil is therefore already in that chat. To keep text out of a chat,
distil it first from the MCP page or an add-on, and paste the distillate into the chat.
````

`examples/mcp/distiller/addon-call.js`

```js
// In an add-on whose manifest declares "permissions": ["mcp:call"].
const result = await window.addonAPI.mcp.callTool("distiller", "distill", {
  text: "Write to jane.doe@northwind-mail.com.",
});
console.log(result.content[0].text); // JSON; each segment's `distillate` holds the fakes
```
