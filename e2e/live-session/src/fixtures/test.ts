// The spec fixture set: every spec imports `test` and `expect` from here.
//  - the signed-in storageState and baseURL of the running stack
//  - `control`: the scripted model's control API, reset before each test
//  - `cleanSlate` (automatic): no session left open by an earlier test, so each
//    spec starts from the setup page
//  - `live`: the web Live page object
//  - `native`: a page with the recording `window.studioHost` shim installed
import {
  type BrowserContext,
  test as base,
  expect,
  type Page,
} from "@playwright/test";
import { controlSession } from "../helpers/api";
import { db } from "../helpers/sql";
import { LivePage } from "../pages/live-page";
import { NativePanel } from "../pages/native-panel";
import { type StackConfig, stackConfig } from "../stack/config";
import { Control } from "../stack/control";
import {
  assertNoRejectedHostCalls,
  type HostShim,
  installHostShim,
} from "./host-shim";
import {
  assertMicrophoneGuarded,
  guardWebkitBrowser,
} from "./webkit-mic-guard";

type Fixtures = {
  stack: StackConfig;
  control: Control;
  // biome-ignore lint/suspicious/noConfusingVoidType: an automatic Playwright fixture with no value is typed void, which is what lets its body call use() with no argument
  cleanSlate: void;
  // biome-ignore lint/suspicious/noConfusingVoidType: an automatic Playwright fixture with no value is typed void, which is what lets its body call use() with no argument
  micGuard: void;
  live: LivePage;
  // Opens the native panel in a fresh context with the host shim.
  native: {
    context: BrowserContext;
    open(page?: Page): Promise<NativePanel>;
    shimFor(page: Page): HostShim;
  };
};

// Ends any session an earlier test left open, through the same control route
// the page uses.
async function endOpenSessions(): Promise<void> {
  for (const session of await db.sessions())
    if (session.status === "active" || session.status === "paused")
      await controlSession(session.id, "end");
}

export const test = base.extend<Fixtures>({
  // WebKit never reaches the real microphone (macOS would show its 'Allow
  // microphone' dialog even headless): every context any spec opens gets the
  // replacement from webkit-mic-guard.ts.
  browser: [
    async ({ browser, browserName }, use) => {
      if (browserName === "webkit") guardWebkitBrowser(browser);
      await use(browser);
    },
    { scope: "worker" },
  ],
  // ...and the test fails if a page loaded without it.
  micGuard: [
    async ({ browser, browserName }, use) => {
      void browser;
      await use();
      if (browserName === "webkit") assertMicrophoneGuarded();
    },
    { auto: true },
  ],
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this destructuring pattern and refuses any other first parameter
  storageState: async ({}, use) => use(stackConfig().storageStatePath),
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this destructuring pattern and refuses any other first parameter
  baseURL: async ({}, use) => use(stackConfig().webUrl),
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this destructuring pattern and refuses any other first parameter
  stack: async ({}, use) => use(stackConfig()),
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this destructuring pattern and refuses any other first parameter
  control: async ({}, use) => {
    const control = new Control(stackConfig().controlUrl);
    await control.reset();
    await use(control);
    // Never leave a held run behind for the next test.
    await control.release();
  },
  cleanSlate: [
    async ({ control }, use) => {
      void control;
      await endOpenSessions();
      await use();
      await endOpenSessions();
    },
    { auto: true },
  ],
  live: async ({ page }, use) => use(new LivePage(page)),
  native: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: stackConfig().storageStatePath,
      viewport: { width: 760, height: 520 },
    });
    const shimFor = await installHostShim(context);
    await use({
      context,
      shimFor,
      open: async (existing) => {
        const page = existing ?? (await context.newPage());
        return new NativePanel(page, shimFor(page));
      },
    });
    const refused = await assertNoRejectedHostCalls(context).then(
      () => undefined,
      (error: unknown) => error,
    );
    await context.close();
    if (refused) throw refused;
  },
});

export { expect };
