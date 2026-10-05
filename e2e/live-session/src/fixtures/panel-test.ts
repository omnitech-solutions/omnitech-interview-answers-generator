// `test` for the specs that drive the native panel on a session of its own with
// choices the plain `native` fixture does not make: Auto or Manual from the
// start, a wide window (the three panes need about 1220 px), shim options such
// as page-drawn toasts, and the session's start options. Every context it opens
// is closed when the test ends, pass or fail.

import type { LiveSessionStartRequest } from "@omnitech/interview-contracts";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { startSessionViaApi } from "../helpers/api";
import {
  assertNoRejectedHostCalls,
  type HostShim,
  installHostShim,
  nativeOverlayUrl,
  type ShimOptions,
} from "./host-shim";
import { test as base, expect } from "./test";

export type OpenPanelOptions = {
  // The owner's remembered Auto choice (the panel is hands-free: Auto by default).
  auto?: "on" | "off";
  start?: Partial<LiveSessionStartRequest>;
  // The panel's window size; the default shows all three panes.
  viewport?: { width: number; height: number };
  shim?: ShimOptions;
  // An open session to attach to instead of starting one.
  sessionId?: string;
  // Extra init scripts (source), run before the page's own.
  init?: string[];
};

export type OpenPanel = {
  context: BrowserContext;
  page: Page;
  host: HostShim;
  id: string;
  toolbar: Locator;
  // The toolbar's capture button (Analyze screen / Stop).
  analyze: Locator;
  // The same panel again in a fresh page (a reload keeps the session).
  reload(): Promise<void>;
};

type Fixtures = {
  openPanel: (options?: OpenPanelOptions) => Promise<OpenPanel>;
};

export const WIDE = { width: 1320, height: 900 } as const;

export const test = base.extend<Fixtures>({
  openPanel: async ({ browser, stack }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (options = {}) => {
      const context = await browser.newContext({
        storageState: stack.storageStatePath,
        viewport: options.viewport ?? WIDE,
      });
      contexts.push(context);
      const shimFor = await installHostShim(context, options.shim ?? {});
      if (options.auto)
        await context.addInitScript(
          `try { localStorage.setItem("interview-studio.live.auto.${stack.tenantSlug}", "${options.auto}"); } catch {}`,
        );
      for (const source of options.init ?? [])
        await context.addInitScript(source);
      const page = await context.newPage();
      const id =
        options.sessionId ?? (await startSessionViaApi(options.start)).id;
      const url = nativeOverlayUrl(stack.webUrl, stack.tenantSlug, {
        panel: "single",
        handsFree: true,
        sessionId: id,
      });
      await page.goto(url);
      const toolbar = page.getByRole("toolbar", { name: "Session controls" });
      await expect(toolbar).toBeVisible();
      return {
        context,
        page,
        host: shimFor(page),
        id,
        toolbar,
        analyze: toolbar.getByRole("button", {
          name: /^(Analyze screen|Stop)$/,
        }),
        reload: async () => {
          await page.goto(url);
          await expect(toolbar).toBeVisible();
        },
      };
    });
    // The page must not have made a call the shell's decoder would refuse.
    const refused: unknown[] = [];
    for (const context of contexts)
      await assertNoRejectedHostCalls(context).catch((e) => refused.push(e));
    for (const context of contexts) await context.close().catch(() => {});
    if (refused.length > 0) throw refused[0];
  },
});

export { expect };
