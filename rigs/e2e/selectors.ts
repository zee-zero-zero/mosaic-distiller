// Every selector the end-to-end rig uses to find something in MosAIc's interface, in one place, so
// that a MosAIc release that changes its interface changes only this file (step 3.2). Taken from
// MosAIc's own `tests/e2e/` where it has them; the others were read from its sources at `7af40c8`.
export const S = {
  appReady: "h1",
  sandboxBanner: "text=Reduced Security Mode",
  onboardingWelcome: "text=Welcome to MosAIc",
  onboardingGetStarted: 'button:has-text("Get Started")',
  onboardingConfigure: 'button:has-text("Configure Your Agent")',
  onboardingSkip: 'button:has-text("Skip for now")',
  onboardingExplore: 'button:has-text("Explore MosAIc")',
  sidebarToggle: "button.absolute.top-4.left-4",
  sidebarMcp: 'button:has-text("MCP Servers")',
  pluginCard: (name: string) =>
    `xpath=//p[contains(@class,"text-sm") and contains(@class,"text-gray-200") and normalize-space()="${name}"]`,
  // The MCP page (`src/components/MCPPage.tsx`).
  toolButton: (name: string) => `xpath=//button[.//p[normalize-space()="${name}"]]`,
  toolArguments: 'textarea[spellcheck="false"]',
  runTool: 'button:has-text("Run Tool")',
  toolResult: 'xpath=//p[normalize-space()="Result"]/following-sibling::pre',
  toolError: 'xpath=//p[normalize-space()="Error"]/following-sibling::pre',
  // The chat (`src/components/Chatview.tsx`).
  sidebarChat: 'button:has-text("AI Chat")',
  newChat: 'button:has-text("New Chat")',
  chatInput: "textarea",
  chatSend: "button[data-auto-send]",
  /** The payment screen: the heading of MosAIc's top-up approval modal (`TransactionApprovalModal.tsx`). */
  paymentModal: 'h2:has-text("Approve Top-Up")',
  // Settings → Addons → Dev corner (`src/components/AddonsSettings.tsx`).
  sidebarSettings: 'button:has-text("Configuration")',
  loadUnpacked: 'button:has-text("Load unpacked addon")',
  /** The sidebar entry of an add-on's tab, by its label. */
  addonTab: (label: string) => `button:has-text("${label}")`,
} as const;
