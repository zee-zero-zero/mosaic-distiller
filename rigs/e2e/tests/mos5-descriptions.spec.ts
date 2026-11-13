// MOS-5: every chat agent's system prompt, as the fake model records it, holds both of our tool
// descriptions whole (§5.8). The reference is what the server itself lists.
import { McpHarness } from "@mosaic-distiller/mcp-harness";
import { join } from "node:path";
import { readFileSync, rmSync } from "node:fs";
import { runInstaller, makeProfile, expect, test } from "../fixtures";

async function listedTools() {
  // The built server, started on its own in a throw-away profile.
  const profile = makeProfile();
  try {
    runInstaller(profile);
    const entry = readFileSync(join(profile.userData, "mcp-plugins.json"), "utf8");
    const e = (JSON.parse(entry) as any[]).find((x) => x.name === "distiller");
    const h = await McpHarness.start(
      { command: e.command, args: e.args, env: e.env },
      { parentEnv: profile.env },
    );
    try {
      return await h.listTools();
    } finally {
      await h.close();
    }
  } finally {
    rmSync(profile.home, { recursive: true, force: true });
  }
}

test("MOS-5 each chat agent's system prompt holds both descriptions whole", async ({ mosaic }) => {
  const tools = await listedTools();
  expect(tools.map((t) => t.name).sort()).toEqual(["capabilities", "distill"]);
  for (const t of tools) expect((t.description ?? "").length).toBeGreaterThan(50);

  const agents = [
    { id: "agent-plain", name: "Plain Agent" },
    { id: "agent-rich", name: "Rich Agent", richUI: true },
  ];
  for (const agent of agents) {
    mosaic.model.requests.length = 0;
    mosaic.model.load(["Nothing to do."]);
    await mosaic.setAgents([agent]);
    await mosaic.startChat("hello");
    await mosaic.model.waitForChats(1);
    const prompt = mosaic.model.chatRequests()[0]?.systemPrompt ?? "";
    for (const t of tools) {
      expect(prompt, `${agent.name}: description of ${t.name}`).toContain(t.description as string);
      expect(prompt, `${agent.name}: schema of ${t.name}`).toContain(JSON.stringify(t.inputSchema));
      expect(prompt).toContain(`<use_tool server="distiller" tool="${t.name}">`);
    }
  }
});
