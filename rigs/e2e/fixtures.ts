// Provides the launch fixture of the end-to-end rig (step 3.2). Each test gets a fresh temporary
// profile (HOME and the XDG directories), so MosAIc starts as for a new user and the real profile
// is never touched; the real installer runs against that profile; then MosAIc is launched with
// Playwright's `_electron.launch`, as MosAIc's own `tests/e2e/app.spec.ts` does. A test can ask for
// a fake model, whose address the fixture hands to `addAgent`.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { startFakeModel, type FakeModel } from "@mosaic-distiller/fake-model";
import { ensureMosaic } from "./build-mosaic.mjs";
import { S } from "./selectors";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..");
export const installerCli = join(repoRoot, "packages", "installer", "dist", "cli.mjs");

export interface Profile {
  home: string;
  configHome: string;
  dataHome: string;
  /** Where MosAIc keeps its settings: `<configHome>/mosaic-companion`. */
  userData: string;
  /** The environment MosAIc and the installer run with. */
  env: Record<string, string>;
}

export function makeProfile(extra: Record<string, string> = {}): Profile {
  const home = mkdtempSync(join(tmpdir(), "distiller-e2e-"));
  const configHome = join(home, "config");
  const dataHome = join(home, "data");
  const cacheHome = join(home, "cache");
  for (const d of [configHome, dataHome, cacheHome]) mkdirSync(d, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, {
    HOME: home,
    XDG_CONFIG_HOME: configHome,
    XDG_DATA_HOME: dataHome,
    XDG_CACHE_HOME: cacheHome,
    ...extra,
  });
  return { home, configHome, dataHome, userData: join(configHome, "mosaic-companion"), env };
}

/** Runs the real installer against `profile`; returns what it printed. */
export function runInstaller(profile: Profile): string {
  return execFileSync(process.execPath, [installerCli, "install"], {
    env: profile.env,
    encoding: "utf8",
  });
}

export interface Mosaic {
  app: ElectronApplication;
  page: Page;
  profile: Profile;
  installerOutput: string;
  /** The first-run screens that appeared and were passed. */
  firstRun: string[];
  model: FakeModel;
  /**
   * Replaces MosAIc's chat agents with the given ones, all active and all talking to the fake
   * model, and reloads the window so the chat reads them.
   */
  setAgents(agents: Array<{ id: string; name: string; richUI?: boolean }>): Promise<void>;
  /** As `setAgents` for one agent. */
  addAgent(id: string, name: string): Promise<void>;
  /**
   * Loads the test add-on through Settings → Addons → Dev corner (the folder dialog is answered
   * with a copy of `test-addon/`), and waits until it listens. Returns the helper to give it jobs.
   */
  loadTestAddon(): Promise<AddonJobs>;
  /** Calls a tool through MosAIc's MCP client, as the MCP page does. */
  callTool(server: string, tool: string, args: unknown): Promise<any>;
  /** Opens the MCP page and waits until `distiller` is connected. */
  openMcpPage(): Promise<void>;
  /** Starts a new chat with the active agent and sends `prompt`; chat's MCP list is read at open. */
  startChat(prompt: string): Promise<void>;
}

export interface AddonJobs {
  dir: string;
  /** Gives the add-on a call to make and waits for its result. */
  call(server: string, tool: string, args: unknown, timeoutMs?: number): Promise<AddonResult>;
}
export type AddonResult =
  | { ok: true; result: { content?: Array<{ type: string; text?: string }>; isError?: boolean } }
  | { ok: false; code: string; message: string };

export interface Options {
  /** Entries added to `mcp-plugins.json` after the installer ran, before MosAIc starts. */
  extraPlugins: { entries: Array<Record<string, unknown>> };
  /** Variables added to MosAIc's own environment (an object, for the same reason). */
  extraEnv: { vars: Record<string, string> };
  /** Set to run no installer (the seeded defect of §5.7: the fixture skipping it). */
  skipInstaller: boolean;
}

export const test = base.extend<{ mosaic: Mosaic } & Options>({
  skipInstaller: [process.env.DISTILLER_E2E_SKIP_INSTALLER === "1", { option: true }],
  // An object, not an array: Playwright reads a two-element array as its own [value, options] tuple.
  extraPlugins: [{ entries: [] }, { option: true }],
  extraEnv: [{ vars: {} }, { option: true }],
  mosaic: async ({ skipInstaller, extraPlugins, extraEnv }, use) => {
    const mosaicDir = ensureMosaic();
    const profile = makeProfile({ MOSAIC_ADDON_DEV: "1", ...extraEnv.vars });
    const installerOutput = skipInstaller ? "" : runInstaller(profile);
    if (extraPlugins.entries.length > 0) {
      const file = join(profile.userData, "mcp-plugins.json");
      mkdirSync(profile.userData, { recursive: true });
      const current: unknown[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
      writeFileSync(file, JSON.stringify([...current, ...extraPlugins.entries], null, 2));
    }
    const model = await startFakeModel();
    const requireFromMosaic = createRequire(join(mosaicDir, "package.json"));
    const electronPath = requireFromMosaic("electron") as string;
    const app = await electron.launch({
      executablePath: electronPath,
      // The sandbox helper of the downloaded Electron is not set-uid, so Linux needs the flag.
      args: ["--no-sandbox", "."],
      cwd: mosaicDir,
      env: profile.env,
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const firstRun = await passFirstRun(page);
    const mosaic: Mosaic = {
      app,
      page,
      profile,
      installerOutput,
      firstRun,
      model,
      async setAgents(agents) {
        await page.evaluate(
          async ({ agents, baseUrl }) => {
            const api = (window as any).electronAPI;
            await api.aiAgents.set(
              agents.map((a) => ({
                id: a.id,
                name: a.name,
                provider: "ollama",
                baseUrl,
                model: "fake",
                isActive: true,
                createdAt: Date.now(),
                temperature: 0,
                maxTokens: 512,
                richUI: a.richUI === true,
              })),
            );
          },
          { agents, baseUrl: model.url },
        );
        await page.reload();
        await page.waitForLoadState("domcontentloaded");
        await page.locator(S.appReady).or(page.locator(S.sidebarToggle)).first().waitFor();
      },
      async addAgent(id, name) {
        await mosaic.setAgents([{ id, name }]);
      },
      async callTool(server, tool, args) {
        return page.evaluate(
          ([server, tool, args]) => (window as any).electronAPI.mcpAPI.callTool(server, tool, args),
          [server, tool, args] as const,
        );
      },
      async loadTestAddon() {
        // MosAIc requires the manifest id to equal the name of the add-on's directory.
        const dir = join(profile.home, "distiller-test-addon");
        cpSync(testAddonSource, dir, { recursive: true });
        await app.evaluate(({ dialog }, chosen) => {
          dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [chosen] })) as never;
        }, dir);
        if (await page.locator(S.sidebarToggle).count())
          await page.locator(S.sidebarToggle).first().click();
        await page.locator(S.sidebarSettings).click();
        await page.locator(S.loadUnpacked).scrollIntoViewIfNeeded();
        await page.locator(S.loadUnpacked).click();
        // The add-on's page runs in a webview that exists once its tab is open.
        await page.locator(S.addonTab("Distiller Test")).click();
        const data = join(dir, "data");
        const until = Date.now() + 30_000;
        while (!existsSync(join(data, "ready.json"))) {
          if (Date.now() > until) throw new Error("the test add-on did not start");
          await new Promise((r) => setTimeout(r, 200));
        }
        let n = 0;
        const jobs: Array<Record<string, unknown>> = [];
        return {
          dir,
          async call(server, tool, args, timeoutMs = 30_000) {
            const id = `job${++n}`;
            jobs.push({ id, server, tool, args });
            writeFileSync(join(data, "jobs.json"), JSON.stringify(jobs));
            const file = join(data, "results", `${id}.json`);
            const limit = Date.now() + timeoutMs;
            while (!existsSync(file)) {
              if (Date.now() > limit) throw new Error(`no result for ${id}`);
              await new Promise((r) => setTimeout(r, 200));
            }
            return JSON.parse(readFileSync(file, "utf8")) as AddonResult;
          },
        };
      },
      async openMcpPage() {
        // As MosAIc's own tests do: the toggle button exists only while the sidebar is closed.
        if (await page.locator(S.sidebarToggle).count()) {
          await page.locator(S.sidebarToggle).first().click();
        }
        await page.locator(S.sidebarMcp).click();
        await page.locator(S.pluginCard("distiller")).waitFor({ timeout: 15_000 });
        // The chat reads the connected servers once, when it opens: wait until every server of
        // the profile's `mcp-plugins.json` that starts by itself has connected.
        const wanted = (readPlugins(profile) ?? [])
          .map((p) => p as { name: string; autoConnect?: boolean })
          .filter((p) => p.autoConnect)
          .map((p) => p.name);
        await expect
          .poll(
            async () => {
              const up = (await page.evaluate(() =>
                (window as any).electronAPI.mcpAPI.listServers(),
              )) as Array<{
                name: string;
                initialized: boolean;
              }>;
              return wanted.every((n) => up.some((s) => s.name === n && s.initialized));
            },
            { timeout: 20_000 },
          )
          .toBe(true);
      },
      async startChat(prompt) {
        // The chat reads the list of connected servers when it opens, so make sure ours is in it.
        await mosaic.openMcpPage();
        await page.locator(S.sidebarChat).click();
        await page.locator(S.newChat).first().click();
        await page.locator(S.chatInput).fill(prompt);
        await page.locator(S.chatSend).click();
      },
    };
    try {
      await use(mosaic);
    } finally {
      await app.close().catch(() => undefined);
      await model.close();
      if (!process.env.DISTILLER_E2E_KEEP) rmSync(profile.home, { recursive: true, force: true });
    }
  },
});

export { expect };

/** The text of the installer's entry, as written to the profile; null when there is none. */
export function readPlugins(profile: Profile): unknown[] | null {
  const f = join(profile.userData, "mcp-plugins.json");
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as unknown[]) : null;
}

/**
 * Passes the first-run screens of MosAIc, the way a user does, and returns their names. At
 * `7af40c8`, on a fresh profile, MosAIc shows: a "Reduced Security Mode" banner when the sandbox
 * is off (informational; it stays), then the onboarding in four steps: welcome, features, agent
 * (skipped here), and ready.
 */
async function passFirstRun(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page
    .locator(S.onboardingWelcome)
    .or(page.locator(S.appReady))
    .first()
    .waitFor({ timeout: 30_000 });
  if (await page.locator(S.sandboxBanner).count()) seen.push("reduced-security banner");
  if (await page.locator(S.onboardingWelcome).count()) {
    seen.push("onboarding: welcome");
    await page.locator(S.onboardingGetStarted).click();
    seen.push("onboarding: features");
    await page.locator(S.onboardingConfigure).click();
    seen.push("onboarding: agent (skipped)");
    await page.locator(S.onboardingSkip).click();
    seen.push("onboarding: ready");
    await page.locator(S.onboardingExplore).click();
  }
  return seen;
}

/** The directory of `test-addon/`, and a copy of it, so that MosAIc's `data/` lands outside the repository. */
export const testAddonSource = join(here, "test-addon");

/** A stdio entry for the quirk server of that name, as MosAIc's `mcp-plugins.json` holds it. */
export function quirkEntry(
  name: string,
  env: Record<string, string> = {},
): Record<string, unknown> {
  return {
    id: `quirk-${name}`,
    name,
    description: `Quirk server ${name}`,
    transport: "stdio",
    command: process.execPath,
    args: [join(here, "quirk-servers", "quirk-server.mjs"), name],
    env,
    autoConnect: true,
  };
}
