# Stage 4: tool results are scanned for payment signals

**Title:** Any MCP server's tool result can open the payment screen

**The behaviour.** At `7af40c8`, when the first text block of a tool result contains
`"__payment_required"` and parses as JSON with that key set, MosAIc routes it to the payment
handler: in chat at `src/services/ActionParser.ts:132-139`, and for add-ons at
`electron/addons/api/mcp.ts:17-71`. This applies to every server, not only servers that talk to
AIM nodes.

**The quirk case that pins it.** `QRK-3` (`rigs/e2e/quirks/qrk3-payment-signal.spec.ts`): a
signal in the first block opens the payment screen on both paths (the control). A signal in the
second block, after prose, or set to false is not detected.

**The consequence.** A server, or text that a server returns, can make the approval screen
appear. The screen asks the user to approve, but a user cannot tell that it did not come from the
node they were using. The distiller rewrites the key in everything it returns (`SRV-4`, `MOS-4`),
because text it is given may hold it.

**The request.** Limit the scan to servers the user has allowed to request payment.
