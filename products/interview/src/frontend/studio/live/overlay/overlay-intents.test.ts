// Navigation intents from the overlay page to the Studio tab.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTENT_ACK_MS,
  INTENT_CHANNEL,
  intentHref,
  listenForIntents,
  sendIntent,
} from "./overlay-intents";

const BASE = "/t/local/p/interview";

// A same-origin BroadcastChannel: every instance of a name hears the others.
const instances = new Map<string, Set<FakeChannel>>();
class FakeChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public name: string) {
    const set = instances.get(name) ?? new Set();
    set.add(this);
    instances.set(name, set);
  }
  postMessage(data: unknown) {
    for (const other of instances.get(this.name) ?? [])
      if (other !== this)
        queueMicrotask(() => other.onmessage?.({ data } as MessageEvent));
  }
  close() {
    instances.get(this.name)?.delete(this);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  instances.clear();
  vi.stubGlobal("BroadcastChannel", FakeChannel);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("intentHref", () => {
  it("names places only", () => {
    expect(intentHref(BASE, { type: "open-start" })).toBe(`${BASE}/live`);
    expect(
      intentHref(BASE, { type: "open-summary", sessionId: "abc-123" }),
    ).toBe(`${BASE}/live/abc-123`);
    expect(
      intentHref(BASE, {
        type: "open-draft",
        workspaceId: "active-session:abc",
        artifactId: "coding:task-1",
      }),
    ).toBe(
      `${BASE}/work?artifact=coding%3Atask-1&workspace=active-session%3Aabc`,
    );
  });

  it("refuses a Workspace id that is not a session's own, and odd ids", () => {
    expect(
      intentHref(BASE, {
        type: "open-draft",
        workspaceId: "interview",
        artifactId: "main",
      }),
    ).toBeNull();
    expect(
      intentHref(BASE, { type: "open-summary", sessionId: "../../x" }),
    ).toBeNull();
  });
});

describe("sending and listening", () => {
  it("a listening Studio tab navigates and acknowledges, so nothing opens", async () => {
    const navigate = vi.fn();
    const stop = listenForIntents(() => BASE, navigate);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    sendIntent(BASE, { type: "open-start" });
    await vi.advanceTimersByTimeAsync(30);
    expect(navigate).toHaveBeenCalledWith(`${BASE}/live`);
    await vi.advanceTimersByTimeAsync(INTENT_ACK_MS + 50);
    expect(open).not.toHaveBeenCalled();
    stop();
  });

  it("only one of several Studio tabs acts: the visible one claims it and the hidden ones stand down", async () => {
    const hidden = vi.fn();
    const shown = vi.fn();
    const other = vi.fn();
    listenForIntents(
      () => BASE,
      hidden,
      () => false,
    );
    listenForIntents(
      () => BASE,
      shown,
      () => true,
    );
    listenForIntents(
      () => BASE,
      other,
      () => false,
    );
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    sendIntent(BASE, { type: "open-start" });
    await vi.advanceTimersByTimeAsync(INTENT_ACK_MS - 50);
    expect(shown).toHaveBeenCalledTimes(1);
    expect(hidden).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(open).not.toHaveBeenCalled();
  });

  it("a hidden-only Studio tab still acts, inside the fallback window", async () => {
    const hidden = vi.fn();
    listenForIntents(
      () => BASE,
      hidden,
      () => false,
    );
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    sendIntent(BASE, { type: "open-start" });
    await vi.advanceTimersByTimeAsync(INTENT_ACK_MS - 50);
    expect(hidden).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(open).not.toHaveBeenCalled();
  });

  it("opens a new tab when no Studio tab answers", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    sendIntent(BASE, { type: "open-summary", sessionId: "s-1" });
    expect(open).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(INTENT_ACK_MS + 50);
    expect(open).toHaveBeenCalledWith(`${BASE}/live/s-1`, "_blank", "noopener");
  });

  it("opens a new tab when the browser has no BroadcastChannel", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    sendIntent(BASE, { type: "open-start" });
    expect(open).toHaveBeenCalledWith(`${BASE}/live`, "_blank", "noopener");
  });

  it("the shell ignores another product or tenant, and invalid intents", async () => {
    const navigate = vi.fn();
    listenForIntents(() => BASE, navigate);
    vi.spyOn(window, "open").mockReturnValue(null);
    const rogue = new FakeChannel(INTENT_CHANNEL);
    const send = async (message: unknown) => {
      rogue.postMessage(message);
      await vi.advanceTimersByTimeAsync(0);
    };
    await send({
      kind: "intent",
      id: "x",
      base: "/t/other/p/interview",
      intent: { type: "open-start" },
    });
    await send({
      kind: "intent",
      id: "y",
      base: BASE,
      intent: { type: "open-draft", workspaceId: "interview", artifactId: "m" },
    });
    // Session control is not an intent at all.
    await send({
      kind: "intent",
      id: "z",
      base: BASE,
      intent: { type: "end" },
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("sends nothing for an invalid intent", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    sendIntent(BASE, {
      type: "open-draft",
      workspaceId: "interview",
      artifactId: "main",
    });
    expect(instances.size).toBe(0);
    expect(open).not.toHaveBeenCalled();
  });
});
