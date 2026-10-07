// Where the native panels send the person in Studio: a navigation intent to the
// Studio tab, which opens a new tab if nothing is listening.
import { parseRoute } from "../../use-studio-route";
import { sendIntent } from "./overlay-intents";

export const openSummary = (sessionId: string): void =>
  sendIntent(parseRoute(window.location).base, {
    type: "open-summary",
    sessionId,
  });
