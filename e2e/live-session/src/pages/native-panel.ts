// The native single panel as the shell's WKWebView loads it, with the recording
// host shim installed first. Names are the accessible names the page renders.
import type { Locator, Page } from "@playwright/test";
import { type HostShim, nativeOverlayUrl } from "../fixtures/host-shim";
import { stackConfig } from "../stack/config";

export class NativePanel {
  constructor(
    readonly page: Page,
    readonly host: HostShim,
  ) {}

  goto(
    options: {
      panel?: "single" | "settings";
      handsFree?: boolean;
      sessionId?: string;
    } = { panel: "single", handsFree: true },
  ): Promise<unknown> {
    const { webUrl, tenantSlug } = stackConfig();
    return this.page.goto(nativeOverlayUrl(webUrl, tenantSlug, options));
  }

  readonly dot = (name: "Close" | "Minimize" | "Zoom" | string): Locator =>
    this.page.getByRole("button", { name: new RegExp(name, "i") });
  readonly message = (): Locator =>
    this.page.getByRole("textbox", { name: /context|follow-up|message/i });
}
