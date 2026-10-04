// Navigation intents from the overlay page to the Studio tab, over a
// same-origin BroadcastChannel. An intent names a place (the start page, a
// finished session's summary, a session draft in the Workspace) and nothing
// else: no session control, no content, no credentials. The Studio shell
// listens and moves its own route; if no Studio tab answers, the overlay opens
// the place in a new tab instead.
import { routeHref, SESSION_WORKSPACE_PREFIX } from "../../use-studio-route";

export const INTENT_CHANNEL = "interview-studio.live.intents";
export const INTENT_ACK_MS = 400;

export type Intent =
  | { type: "open-start" }
  | { type: "open-summary"; sessionId: string }
  | { type: "open-draft"; workspaceId: string; artifactId: string };

type Message =
  | { kind: "intent"; id: string; base: string; intent: Intent }
  | { kind: "ack"; id: string };

const ID = /^[A-Za-z0-9._:-]{1,160}$/;

// The Studio place an intent names, or null when it is not a valid one.
export function intentHref(base: string, intent: Intent): string | null {
  switch (intent.type) {
    case "open-start":
      return routeHref({ base, view: "live", rest: [], artifact: "main" });
    case "open-summary":
      return ID.test(intent.sessionId)
        ? routeHref({
            base,
            view: "live",
            rest: [intent.sessionId],
            artifact: "main",
          })
        : null;
    case "open-draft":
      // [GUARD] Only a session's own Workspace id may be written to a route.
      return intent.workspaceId.startsWith(SESSION_WORKSPACE_PREFIX) &&
        ID.test(intent.workspaceId) &&
        ID.test(intent.artifactId)
        ? routeHref({
            base,
            view: "work",
            rest: [],
            artifact: intent.artifactId,
            workspace: intent.workspaceId,
          })
        : null;
  }
}

const channelApi = (): typeof BroadcastChannel | null =>
  typeof BroadcastChannel === "function" ? BroadcastChannel : null;

// From the overlay page: ask a listening Studio tab to go there; open a new tab
// when none answers (or the browser has no BroadcastChannel).
export function sendIntent(base: string, intent: Intent): void {
  const href = intentHref(base, intent);
  if (!href) return;
  const fallback = () => window.open(href, "_blank", "noopener");
  const Channel = channelApi();
  if (!Channel) {
    fallback();
    return;
  }
  const channel = new Channel(INTENT_CHANNEL);
  const id = `i-${Math.random().toString(36).slice(2)}`;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const done = () => {
    if (timer !== null) clearTimeout(timer);
    channel.close();
  };
  channel.onmessage = (event: MessageEvent<Message>) => {
    if (event.data?.kind === "ack" && event.data.id === id) done();
  };
  timer = setTimeout(() => {
    done();
    fallback();
  }, INTENT_ACK_MS);
  channel.postMessage({ kind: "intent", id, base, intent } satisfies Message);
}

// How long a tab that is not showing waits before acting, so a visible tab
// claims the intent first. It must stay below INTENT_ACK_MS.
export const HIDDEN_TAB_DELAY_MS = 120;
const JITTER_MS = 20;

// In the Studio shell: handle intents addressed to this tenant's product. One
// tab acts per intent: every listening tab schedules itself (the visible one
// first, the others later, with a little jitter), the first to fire claims it by
// acknowledging, and the rest see that acknowledgement and stand down.
// Returns the remover.
export function listenForIntents(
  currentBase: () => string,
  navigate: (href: string) => void,
  visible: () => boolean = () => document.visibilityState === "visible",
): () => void {
  const Channel = channelApi();
  if (!Channel) return () => undefined;
  const channel = new Channel(INTENT_CHANNEL);
  const claimed = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  channel.onmessage = (event: MessageEvent<Message>) => {
    const message = event.data;
    if (message?.kind === "ack" && typeof message.id === "string") {
      claimed.add(message.id);
      return;
    }
    if (message?.kind !== "intent" || typeof message.id !== "string") return;
    // [GUARD] Only this product's own place (same tenant and product).
    const base = currentBase();
    if (base === "" || message.base !== base) return;
    const href = intentHref(base, message.intent);
    if (!href) return;
    const id = message.id;
    const delay =
      (visible() ? 0 : HIDDEN_TAB_DELAY_MS) + Math.random() * JITTER_MS;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (claimed.has(id)) return;
      claimed.add(id);
      channel.postMessage({ kind: "ack", id } satisfies Message);
      navigate(href);
    }, delay);
    timers.add(timer);
  };
  return () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    channel.close();
  };
}
