// Opens a finished session's summary in Studio. The native window hands the
// address to the person's browser through the shell's openExternal bridge; with
// no bridge it sends a navigation intent (the Studio tab, or a new one).
import { parseRoute } from "../../../use-studio-route";
import { openExternalThroughHost } from "../../host-adapter";
import { intentHref } from "../overlay-intents";
import { openSummary } from "../studio-links";

export function openSessionSummary(sessionId: string): void {
  const href = intentHref(parseRoute(window.location).base, {
    type: "open-summary",
    sessionId,
  });
  if (
    href &&
    openExternalThroughHost(new URL(href, window.location.origin).href)
  )
    return;
  openSummary(sessionId);
}
