// Panels are separate documents (separate native windows). The server is the
// authority for the session; this channel only carries what exists in one
// document's memory: the owner's live mic/Auto state, typed lines and requests
// from a panel that does not own the microphone. Settings, the capture region
// and the Auto preference travel through localStorage (the `storage` event).
// Nothing here is persisted; no session content leaves the origin.
export type PanelState = {
  auto: boolean;
  mic: "listening" | "denied" | "off";
  interim: string;
  sharing: boolean;
  // What the owner is doing for a capture, so every panel shows it at once.
  phase: "capturing" | "analyzing" | null;
};

export type PanelMessage =
  | { type: "state"; state: PanelState }
  // A line the owner (or another panel) added: typed, dictated or auto-captured.
  | {
      type: "line";
      sessionId: string | null;
      kind: "Typed" | "Dictated" | "Auto";
      text: string;
      at: number;
    }
  // A request to the owner, which alone holds the microphone and the screen.
  | { type: "command"; command: "capture" | "toggle-mic" }
  // Forget this session's lines and draft in every panel (session.clear).
  | { type: "clear"; sessionId: string | null }
  // A panel just opened and asks the owner to say its state again.
  | { type: "hello" };

const CHANNEL = "interview-studio.panels";

export type PanelBus = {
  post(message: PanelMessage): void;
  listen(listener: (message: PanelMessage) => void): () => void;
};

// A page without BroadcastChannel has no other panel to talk to.
export function openPanelBus(): PanelBus {
  if (typeof BroadcastChannel === "undefined")
    return { post: () => undefined, listen: () => () => undefined };
  const channel = new BroadcastChannel(CHANNEL);
  const listeners = new Set<(message: PanelMessage) => void>();
  channel.onmessage = (event: MessageEvent) => {
    const data = event.data as PanelMessage | null;
    if (!data || typeof data.type !== "string") return;
    for (const listener of listeners) listener(data);
  };
  return {
    post: (message) => channel.postMessage(message),
    listen: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          channel.close();
        }
      };
    },
  };
}
