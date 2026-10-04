// Where the card sends the person in Studio. Inside Studio's own page the card
// moves the Studio route directly. On the overlay page (the PiP window or a
// standalone window) it sends a navigation intent to the Studio tab, which
// opens a new tab if nothing is listening.
import { parseRoute } from "../../use-studio-route";
import { type Intent, intentHref, sendIntent } from "./overlay-intents";

export type CardVariant = "tab" | "overlay";

export function navigateStudio(href: string): void {
  window.history.pushState({}, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function open(intent: Intent, variant: CardVariant): void {
  const base = parseRoute(window.location).base;
  if (variant === "overlay") {
    sendIntent(base, intent);
    return;
  }
  // The same hrefs the shell builds for an intent: one place knows them.
  const href = intentHref(base, intent);
  if (href) navigateStudio(href);
}

export const openStartPage = (variant: CardVariant): void =>
  open({ type: "open-start" }, variant);
export const openSummary = (sessionId: string, variant: CardVariant): void =>
  open({ type: "open-summary", sessionId }, variant);
export const openDraft = (
  target: { workspaceId: string; artifactId: string },
  variant: CardVariant,
): void => open({ type: "open-draft", ...target }, variant);
