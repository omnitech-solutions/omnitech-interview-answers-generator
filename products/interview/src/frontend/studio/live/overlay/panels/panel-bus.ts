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
//
// The channel is opened on demand and closed when the last listener leaves, but
// the bus object outlives that (React runs effect cleanups and re-runs them,
// notably under StrictMode), so a post after the close must reopen it and never
// throw: a throw inside an effect takes the whole panel down.
export function openPanelBus(): PanelBus {
  if (typeof BroadcastChannel === "undefined")
    return { post: () => undefined, listen: () => () => undefined };
  const listeners = new Set<(message: PanelMessage) => void>();
  let channel: BroadcastChannel | null = null;
  const ensure = (): BroadcastChannel => {
    if (channel) return channel;
    const opened = new BroadcastChannel(CHANNEL);
    opened.onmessage = (event: MessageEvent) => {
      const data = event.data as PanelMessage | null;
      if (!data || typeof data.type !== "string") return;
      for (const listener of listeners) listener(data);
    };
    channel = opened;
    return opened;
  };
  const release = () => {
    channel?.close();
    channel = null;
  };
  return {
    post: (message) => {
      try {
        ensure().postMessage(message);
      } catch {
        // A channel closed under us: reopen once, then give up quietly.
        release();
        try {
          ensure().postMessage(message);
        } catch {
          release();
        }
      }
    },
    listen: (listener) => {
      listeners.add(listener);
      try {
        ensure();
      } catch {
        // No channel: this document just hears nothing.
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) release();
      };
    },
  };
}
