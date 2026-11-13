// QRK-6: every chat agent sees every server's tools (`Chatview.tsx:563-575`;
// `ActionParser.ts:177-199`). With two servers and two agents, both agents' system prompts list
// both servers, with their tools.
import { expect, quirkEntry, test } from "../fixtures";

test.use({ extraPlugins: { entries: [quirkEntry("alpha"), quirkEntry("beta")] } });

test("QRK-6 two agents, two other servers: each agent's prompt lists every server and its tools", async ({
  mosaic,
}) => {
  const agents = [
    { id: "agent-1", name: "Agent One" },
    { id: "agent-2", name: "Agent Two" },
  ];
  for (const agent of agents) {
    mosaic.model.requests.length = 0;
    mosaic.model.load(["Nothing to do."]);
    await mosaic.setAgents([agent]);
    await mosaic.startChat("hello");
    await mosaic.model.waitForChats(1);
    const prompt = mosaic.model.chatRequests()[0]?.systemPrompt ?? "";
    for (const server of ["distiller", "alpha", "beta"]) {
      expect(prompt, `${agent.name} sees ${server}`).toContain(`Server: ${server}\n`);
      expect(prompt).toContain(`<use_tool server="${server}" tool="`);
    }
    expect(prompt).toContain("Tool: whoami\n  Description: Returns this server's name (alpha)");
    expect(prompt).toContain("Tool: whoami\n  Description: Returns this server's name (beta)");
  }
});
