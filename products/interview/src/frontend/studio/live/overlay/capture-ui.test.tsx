// The overlay's capture controls, dictation, shortcuts, region editor and
// settings, over the real store and client against a scripted service, with a
// fake display stream, canvas and SpeechRecognition.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveCardHost } from "../card-host";
import { presentation } from "../focus-presentation";
import { answerAction } from "../live-view-kit";
import {
  disconnected,
  jsonResponse,
  minutesAfter,
  sessionView,
  snapshot,
  streamPage,
} from "../session-fixtures";
import {
  configureSessionStores,
  resetSessionStores,
} from "../session-registry";
import { answerResult } from "../session-result-fixtures";
import { createTestServer, type TestServer } from "../session-test-server";
import {
  FakeRecognition,
  fakeStream,
  installDisplayMedia,
  installFakeCanvas,
  installRecognition,
  installVideoSize,
  SECRET_TITLE,
} from "./capture-fixtures";
import { resetCaptureTrigger } from "./capture-trigger";
import { resetPosition } from "./card-position";
import { DICTATION_MESSAGES } from "./dictation";
import { MASK_NOTE } from "./mask-editor";

let server: TestServer;
let page: ReturnType<typeof streamPage>;
let session = sessionView();
let display = fakeStream();
type Posted = { entries: [string, FormDataEntryValue][] };
let captures: Posted[] = [];
let inputs: Record<string, unknown>[] = [];

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await flush();
};
const click = async (name: string | RegExp) => {
  fireEvent.click(screen.getByRole("button", { name }));
  await flush();
};
const card = () => screen.getByTestId("overlay-card");
// Alt+M: the one entry to the area editor besides the capture menu.
async function openEditor() {
  fireEvent.keyDown(card(), { key: "µ", code: "KeyM", altKey: true });
  await flush();
}

// A companion that has made contact, so its source lights show.
const connected = () => remote({ lastHeartbeatAt: minutesAfter(0, 59) });
const remote = (over: Parameters<typeof sessionView>[0] = {}) =>
  sessionView({
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "application-audio", "screen"],
    ...over,
  });

function serve(view: ReturnType<typeof sessionView>) {
  session = view;
  page = streamPage({
    session: view,
    observations: [snapshot(1, "Chrome · LeetCode")],
    nextAfterSequence: 1,
    actions: [answerAction(answerResult())],
  });
  server = createTestServer(() => page);
  server.on("GET /current", () => jsonResponse({ session }));
  server.on("POST /:id/capture", ({ body }) => {
    captures.push({ entries: [...(body as FormData).entries()] });
    return jsonResponse(
      {
        input: { requestId: "r", sequence: 9 },
        snapshot: { sourceId: "browser", eventId: "evt-9" },
      },
      202,
    );
  });
  server.on("POST /:id/input", ({ body }) => {
    inputs.push(body as Record<string, unknown>);
    return jsonResponse({ input: { requestId: "r", sequence: 10 } }, 202);
  });
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
  });
}

async function openCard(view = remote()) {
  serve(view);
  render(<LiveCardHost />);
  act(() => presentation.setMode("card"));
  await settle();
}

async function shareSource() {
  await click(/Capture & analyze/);
  fireEvent.click(
    screen.getByRole("menuitem", { name: /Share a window, tab or screen/ }),
  );
  await settle();
}

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(
    type: string,
    init: MouseEventInit & { pointerId?: number } = {},
  ) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

beforeEach(() => {
  resetCaptureTrigger();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetSessionStores();
  presentation.reset();
  resetPosition();
  captures = [];
  inputs = [];
  display = fakeStream();
  installVideoSize();
  installFakeCanvas();
  installDisplayMedia(async () => display.stream);
  installRecognition(true);
});
afterEach(() => {
  cleanup();
  presentation.reset();
  resetSessionStores();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("capture & analyze", () => {
  it("shows the shared source's kind, a live local preview and Stop sharing", async () => {
    await openCard();
    expect(screen.getByTestId("share-none")).toHaveTextContent(
      "No source shared",
    );
    await shareSource();
    expect(screen.getByTestId("share-kind")).toHaveTextContent("Window");
    expect(screen.getAllByTestId("local-preview").length).toBeGreaterThan(0);
    await click("Stop sharing");
    expect(display.track.stop).toHaveBeenCalled();
    expect(screen.getByTestId("share-none")).toBeVisible();
  });

  it("tells the person when the browser's own Stop sharing ends it", async () => {
    await openCard();
    await shareSource();
    act(() => display.endFromBrowser());
    await flush();
    expect(screen.getByTestId("share-none")).toBeVisible();
    expect(within(card()).getByRole("alert")).toHaveTextContent(
      /Sharing stopped/,
    );
  });

  it("explains a cancelled picker and an unsupported browser", async () => {
    await openCard();
    installDisplayMedia(async () => {
      throw Object.assign(new Error("x"), { name: "NotAllowedError" });
    });
    await shareSource();
    expect(within(card()).getByRole("alert")).toHaveTextContent(
      "Nothing was shared.",
    );
    installDisplayMedia(undefined);
    await shareSource();
    expect(within(card()).getByRole("alert")).toHaveTextContent(
      /can’t share a window, tab or screen/,
    );
  });

  it("posts one multipart capture with the right fields, the hints, and no title", async () => {
    window.localStorage.setItem(
      "interview-studio.live.capture-settings.local",
      JSON.stringify({ skill: "dsa", language: "react" }),
    );
    window.localStorage.setItem(
      "interview-studio.live.capture-mask.local",
      JSON.stringify({ x: 0.5, y: 0, w: 0.5, h: 1 }),
    );
    await openCard();
    expect(screen.getByTestId("region-chip")).toHaveTextContent("Cropped");
    await shareSource();
    await click(/Capture & analyze/);
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: /Attach a fresh capture to T1 rev 1/,
      }),
    );
    await settle();
    expect(captures).toHaveLength(1);
    const fields = Object.fromEntries(
      (captures[0] as Posted).entries.filter(([, v]) => typeof v === "string"),
    );
    expect(fields).toMatchObject({
      operation: "analyze",
      targetTaskId: "task-1",
      targetRevision: "1",
      skill: "dsa",
      language: "react",
      label: "Window · region",
    });
    expect(fields["requestId"]).toMatch(/^r-/);
    const image = (captures[0] as Posted).entries.find(
      ([k]) => k === "image",
    )?.[1];
    expect(image).toBeInstanceOf(Blob);
    expect((image as File).type).toBe("image/jpeg");
    // Nothing sent carries the title of the shared window.
    expect(JSON.stringify(captures)).not.toContain(SECRET_TITLE);
    expect(JSON.stringify(server.calls)).not.toContain(SECRET_TITLE);
    expect(server.calls.filter((c) => c.endsWith("/input"))).toEqual([]);
  });

  it("sends no hints when none are chosen, and shows Analyzing… while it works", async () => {
    await openCard();
    await shareSource();
    let release!: (response: Response) => void;
    server.on(
      "POST /:id/capture",
      ({ body }) =>
        new Promise<Response>((resolve) => {
          captures.push({ entries: [...(body as FormData).entries()] });
          release = resolve;
        }),
    );
    await click(/Capture & analyze/);
    fireEvent.click(
      screen.getByRole("menuitem", { name: /New task from a fresh capture/ }),
    );
    await settle();
    expect(screen.getByTestId("analyzing")).toHaveTextContent("Analyzing…");
    expect(screen.getByTestId("bar-status")).toHaveAttribute(
      "data-status",
      "capturing",
    );
    release(
      jsonResponse(
        {
          input: { requestId: "r", sequence: 1 },
          snapshot: { sourceId: "b", eventId: "e" },
        },
        202,
      ),
    );
    await settle();
    const names = (captures[0] as Posted).entries.map(([k]) => k);
    // An unset hint is "auto" (it resets an earlier one); no task is attached.
    expect((captures[0] as Posted).entries).toEqual(
      expect.arrayContaining([
        ["skill", "auto"],
        ["language", "auto"],
      ]),
    );
    expect(names).not.toContain("targetTaskId");
    expect(screen.queryByTestId("analyzing")).toBeNull();
  });

  it("uses the companion's latest capture only when its screen source is receiving", async () => {
    await openCard();
    await click(/Capture & analyze/);
    const item = screen.getByRole("menuitem", {
      name: /Analyze stored capture/,
    });
    expect(item).toBeEnabled();
    fireEvent.click(item);
    await settle();
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ operation: "analyze" });
    expect(captures).toEqual([]);
  });

  it("disables the companion choice when its screen source is lost", async () => {
    serve(remote());
    page = {
      ...page,
      observations: [
        snapshot(1),
        disconnected(2, "screen", "permission-revoked"),
      ],
      nextAfterSequence: 2,
    };
    render(<LiveCardHost />);
    act(() => presentation.setMode("card"));
    await settle();
    await click(/Capture & analyze/);
    expect(
      screen.getByRole("menuitem", { name: /Analyze stored capture/ }),
    ).toBeDisabled();
  });

  it("is disabled in a device-only session, with the sentence, but follow-ups still work", async () => {
    await openCard(remote({ processingPolicy: "device-only" }));
    const button = screen.getByRole("button", { name: /Capture & analyze/ });
    expect(button).toBeDisabled();
    expect(screen.getByTestId("analyze-note")).toHaveTextContent(
      "Device-only mode never sends a screenshot to an assistant.",
    );
    fireEvent.keyDown(card(), {
      key: "A",
      code: "KeyA",
      altKey: true,
      shiftKey: true,
    });
    await settle();
    expect(captures).toEqual([]);
    expect(within(card()).getByRole("alert")).toHaveTextContent(
      "Device-only mode never sends a screenshot",
    );
    fireEvent.change(screen.getByLabelText("Follow-up"), {
      target: { value: "why?" },
    });
    await click("Send follow-up");
    expect(inputs).toHaveLength(1);
  });
});

describe("region editor", () => {
  const rect = () => screen.getByTestId("mask-rect");
  const readout = () => screen.getByTestId("mask-readout");

  it("opens from the bar, says the crop is local, and starts on the whole source", async () => {
    await openCard();
    await openEditor();
    expect(screen.getByTestId("mask-editor")).toBeVisible();
    expect(screen.getByText(MASK_NOTE)).toBeVisible();
    expect(readout()).toHaveTextContent("Everything on the shared screen");
  });

  it("moves with the arrow keys and resizes with Alt+arrows", async () => {
    await openCard();
    await openEditor();
    await click("Middle");
    expect(rect().style.left).toBe("20%");
    fireEvent.keyDown(rect(), { key: "ArrowRight" });
    expect(rect().style.left).toBe("21%");
    fireEvent.keyDown(rect(), { key: "ArrowDown", shiftKey: true });
    expect(rect().style.top).toBe("25%");
    fireEvent.keyDown(rect(), { key: "ArrowRight", altKey: true });
    expect(Number.parseFloat(rect().style.width)).toBeCloseTo(61, 5);
    fireEvent.keyDown(rect(), { key: "ArrowUp", altKey: true });
    expect(Number.parseFloat(rect().style.height)).toBeCloseTo(59, 5);
  });

  it("applies every preset and Reset", async () => {
    await openCard();
    await openEditor();
    const expected: Record<string, [string, string, string, string]> = {
      "Left side": ["0%", "0%", "50%", "100%"],
      "Right side": ["50%", "0%", "50%", "100%"],
      Top: ["0%", "0%", "100%", "50%"],
      Bottom: ["0%", "50%", "100%", "50%"],
      Middle: ["20%", "20%", "60%", "60%"],
      Everything: ["0%", "0%", "100%", "100%"],
    };
    for (const [name, [left, top, width, height]] of Object.entries(expected)) {
      await click(name);
      expect([
        rect().style.left,
        rect().style.top,
        rect().style.width,
        rect().style.height,
      ]).toEqual([left, top, width, height]);
    }
    await click("Right side");
    await click("Reset");
    expect(readout()).toHaveTextContent("Everything on the shared screen");
  });

  it("drags a handle to resize", async () => {
    await openCard();
    await openEditor();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const wide = this.classList.contains("ov-stage");
        return {
          left: 0,
          top: 0,
          right: wide ? 1000 : 0,
          bottom: wide ? 500 : 0,
          width: wide ? 1000 : 0,
          height: wide ? 500 : 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      },
    );
    const east = rect().querySelector('[data-handle="e"]') as HTMLElement;
    fireEvent.pointerDown(east, { clientX: 1000, clientY: 250, button: 0 });
    fireEvent.pointerMove(
      screen
        .getByTestId("mask-editor")
        .querySelector(".ov-stage") as HTMLElement,
      {
        clientX: 700,
        clientY: 250,
      },
    );
    expect(rect().style.width).toBe("70%");
  });

  it("saves per tenant and shows the Region chip; Cancel and Escape keep the old region", async () => {
    await openCard();
    await openEditor();
    await click("Left side");
    await click("Save region");
    expect(
      JSON.parse(
        window.localStorage.getItem(
          "interview-studio.live.capture-mask.local",
        ) ?? "null",
      ),
    ).toEqual({
      x: 0,
      y: 0,
      w: 0.5,
      h: 1,
    });
    expect(screen.getByTestId("region-chip")).toBeVisible();
    // Reopen: the saved region is what is shown.
    await openEditor();
    expect(rect().style.width).toBe("50%");
    await click("Top");
    fireEvent.keyDown(rect(), { key: "Escape" });
    expect(screen.queryByTestId("mask-editor")).toBeNull();
    await openEditor();
    expect(rect().style.width).toBe("50%");
    // Saving the whole source removes the chip.
    await click("Everything");
    await click("Save region");
    expect(screen.queryByTestId("region-chip")).toBeNull();
  });

  it("shows the live preview of the shared source when there is one", async () => {
    await openCard();
    await shareSource();
    await openEditor();
    expect(
      within(screen.getByTestId("mask-editor")).getByTestId("local-preview"),
    ).toBeInTheDocument();
  });
});

describe("settings and hints", () => {
  it("chooses the skill and language, remembers them per tenant, and sends them with a follow-up", async () => {
    await openCard();
    expect(screen.getByRole("button", { name: /Topic: auto/ })).toBeVisible();
    await click("Settings");
    const skill = screen.getByLabelText("Topic") as HTMLSelectElement;
    expect(skill.options).toHaveLength(10);
    fireEvent.change(skill, { target: { value: "system-design" } });
    const language = screen.getByLabelText(
      "Coding language",
    ) as HTMLSelectElement;
    expect([...language.options].map((o) => o.value)).toEqual([
      "",
      "typescript",
      "react",
    ]);
    fireEvent.change(language, { target: { value: "typescript" } });
    expect(
      JSON.parse(
        window.localStorage.getItem(
          "interview-studio.live.capture-settings.local",
        ) ?? "{}",
      ),
    ).toEqual({ skill: "system-design", language: "typescript" });
    expect(screen.getByText(/TypeScript or React today/)).toBeVisible();
    fireEvent.keyDown(screen.getByTestId("settings-popover"), {
      key: "Escape",
    });
    expect(screen.queryByTestId("settings-popover")).toBeNull();
    expect(screen.getByRole("button", { name: "System Design" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Follow-up"), {
      target: { value: "and scale?" },
    });
    await click("Send follow-up");
    expect(inputs[0]).toMatchObject({
      operation: "follow-up",
      text: "and scale?",
      skill: "system-design",
      language: "typescript",
    });
  });

  it("lists the shortcuts", async () => {
    await openCard();
    await click("Settings");
    for (const keys of ["Alt+Shift+A", "Alt+R", "Alt+M", "Alt+,", "Esc"])
      expect(
        within(screen.getByTestId("settings-popover")).getByText(keys),
      ).toBeVisible();
  });
});

describe("dictation", () => {
  const mic = () =>
    screen.getByRole("button", { name: /Dictate|Stop dictation/ });
  const instance = () => FakeRecognition.instances[0] as FakeRecognition;

  it("toggles listening, shows it, appends final phrases to the follow-up input and never sends them", async () => {
    await openCard();
    expect(mic()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(mic());
    await flush();
    expect(instance().start).toHaveBeenCalled();
    expect(instance().continuous).toBe(true);
    expect(instance().interimResults).toBe(true);
    expect(mic()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("bar-status")).toHaveAttribute(
      "data-status",
      "listening",
    );
    act(() => instance().say({ text: "use a hash", final: false }));
    // The words appear live in the input, in the lighter interim style...
    const input = screen.getByLabelText("Follow-up");
    expect(input).toHaveValue("use a hash");
    expect(input).toHaveClass("interim");
    // ...and the hint is gone once something is heard.
    expect(screen.getByTestId("listening-hint")).toHaveTextContent(
      "Listening…",
    );
    expect(screen.getByTestId("listening-hint")).not.toHaveTextContent(
      "speak now",
    );
    act(() => instance().say({ text: "use a hash map", final: true }));
    // Final: solid, no longer interim.
    expect(input).not.toHaveClass("interim");
    act(() => instance().say({ text: "then a heap", final: true }));
    expect(screen.getByLabelText("Follow-up")).toHaveValue(
      "use a hash map then a heap",
    );
    expect(
      within(screen.getByTestId("chat-log")).getAllByText("Dictated"),
    ).toHaveLength(2);
    // Appended, never auto-sent.
    expect(inputs).toEqual([]);
    fireEvent.click(mic());
    await flush();
    expect(mic()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("bar-status")).toHaveAttribute(
      "data-status",
      "ready",
    );
  });

  it("toggles with Alt+R, also while typing in the input", async () => {
    await openCard();
    const input = screen.getByLabelText("Follow-up");
    input.focus();
    fireEvent.keyDown(input, { key: "®", code: "KeyR", altKey: true });
    expect(mic()).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(input, { key: "®", code: "KeyR", altKey: true });
    expect(mic()).toHaveAttribute("aria-pressed", "false");
    // A plain "r" typed in the input is not a shortcut.
    fireEvent.keyDown(input, { key: "r", code: "KeyR" });
    expect(mic()).toHaveAttribute("aria-pressed", "false");
  });

  it("runs on this device in a device-only session", async () => {
    await openCard(remote({ processingPolicy: "device-only" }));
    fireEvent.click(mic());
    await flush();
    expect(instance().processLocally).toBe(true);
    expect(instance().start).toHaveBeenCalled();
  });

  it("establishes on-device recognition before it starts recording", async () => {
    await openCard(remote({ processingPolicy: "device-only" }));
    fireEvent.click(mic());
    await flush();
    expect(FakeRecognition.log[0]).toMatch(
      /^available:.*"processLocally":true/,
    );
    expect(FakeRecognition.log.at(-1)).toBe("start");
    expect(FakeRecognition.log.indexOf("start")).toBeGreaterThan(0);
  });

  it("installs a downloadable on-device pack first, then records", async () => {
    FakeRecognition.availability = "downloadable";
    await openCard(remote({ processingPolicy: "device-only" }));
    fireEvent.click(mic());
    await flush();
    const log = FakeRecognition.log;
    expect(log.indexOf("install")).toBeGreaterThan(0);
    expect(log.indexOf("install")).toBeLessThan(log.indexOf("start"));
  });

  it("refuses without recording when the on-device pack is unavailable or cannot install", async () => {
    FakeRecognition.availability = "unavailable";
    await openCard(remote({ processingPolicy: "device-only" }));
    fireEvent.click(mic());
    await flush();
    expect(instance().start).not.toHaveBeenCalled();
    expect(within(card()).getByRole("alert")).toHaveTextContent(
      DICTATION_MESSAGES.deviceOnlyUnavailable,
    );
    expect(mic()).toHaveAttribute("aria-pressed", "false");
  });

  it("refuses a device-only session when the browser cannot report availability", async () => {
    FakeRecognition.available = undefined;
    await openCard(remote({ processingPolicy: "device-only" }));
    fireEvent.click(mic());
    await flush();
    expect(instance().start).not.toHaveBeenCalled();
    expect(within(card()).getByRole("alert")).toHaveTextContent(
      DICTATION_MESSAGES.deviceOnlyUnsupported,
    );
  });

  it("does not check or restrict a remote session", async () => {
    await openCard();
    fireEvent.click(mic());
    expect(FakeRecognition.log).toEqual(["start"]);
  });

  it("leaves processing to the browser in a remote session", async () => {
    await openCard();
    fireEvent.click(mic());
    await flush();
    expect(instance().processLocally).toBe(false);
    expect(mic().getAttribute("title")).toMatch(
      /may use its own speech service/,
    );
  });

  it("refuses in a device-only session when the browser cannot recognise on-device", async () => {
    FakeRecognition.localCapable = false;
    await openCard(remote({ processingPolicy: "device-only" }));
    fireEvent.click(mic());
    await flush();
    expect(instance().start).not.toHaveBeenCalled();
    expect(within(card()).getByRole("alert")).toHaveTextContent(
      DICTATION_MESSAGES.deviceOnlyUnsupported,
    );
    expect(mic()).toHaveAttribute("aria-pressed", "false");
  });

  it("says so in a browser with no dictation", async () => {
    installRecognition(false);
    await openCard();
    fireEvent.click(mic());
    await flush();
    expect(within(card()).getByRole("alert")).toHaveTextContent(
      DICTATION_MESSAGES.unsupported,
    );
  });

  it.each([
    ["not-allowed", DICTATION_MESSAGES.denied],
    ["no-speech", DICTATION_MESSAGES.noSpeech],
    ["audio-capture", DICTATION_MESSAGES.noMicrophone],
  ])("explains %s", async (code, message) => {
    await openCard();
    fireEvent.click(mic());
    await flush();
    act(() => instance().onerror?.({ error: code }));
    expect(within(card()).getByRole("alert")).toHaveTextContent(message);
  });

  it("keeps listening through the browser's own end after a pause, until toggled off", async () => {
    await openCard();
    fireEvent.click(mic());
    await flush();
    act(() => instance().onend?.());
    expect(instance().start).toHaveBeenCalledTimes(2);
    expect(mic()).toHaveAttribute("aria-pressed", "true");
  });
});

describe("shortcuts", () => {
  it("Alt+Shift+A captures a fresh frame of the shared source and analyzes it", async () => {
    await openCard();
    await shareSource();
    const input = screen.getByLabelText("Follow-up");
    input.focus();
    fireEvent.keyDown(input, {
      key: "Å",
      code: "KeyA",
      altKey: true,
      shiftKey: true,
    });
    await settle();
    expect(captures).toHaveLength(1);
  });

  it("Alt+Shift+A with nothing shared opens the source menu", async () => {
    await openCard();
    fireEvent.keyDown(card(), {
      key: "A",
      code: "KeyA",
      altKey: true,
      shiftKey: true,
    });
    await flush();
    expect(screen.getByRole("menu", { name: "Capture source" })).toBeVisible();
  });

  it("Alt+M opens the region editor and Alt+, opens settings", async () => {
    await openCard();
    fireEvent.keyDown(card(), { key: "µ", code: "KeyM", altKey: true });
    expect(screen.getByTestId("mask-editor")).toBeVisible();
    fireEvent.keyDown(screen.getByTestId("mask-editor"), { key: "Escape" });
    fireEvent.keyDown(card(), { key: "≤", code: "Comma", altKey: true });
    expect(screen.getByTestId("settings-popover")).toBeVisible();
  });

  it("ignores keys without Alt, and Alt during an IME composition", async () => {
    await openCard();
    fireEvent.keyDown(card(), { key: "m", code: "KeyM" });
    fireEvent.keyDown(card(), {
      key: "m",
      code: "KeyM",
      altKey: true,
      isComposing: true,
    });
    expect(screen.queryByTestId("mask-editor")).toBeNull();
  });

  it("shows the shortcut in the tooltips", async () => {
    await openCard();
    expect(screen.getByRole("button", { name: "Dictate" }).title).toContain(
      "Alt+R",
    );
    expect(screen.getByRole("button", { name: "Settings" }).title).toContain(
      "Alt+,",
    );
    expect(
      screen.getByRole("button", { name: "Capture screen" }).title,
    ).toContain("Alt+Shift+A");
  });
});

describe("companion source lights are controls", () => {
  it("shows the reason and the fix for a screen source that lost its device", async () => {
    serve(connected());
    page = {
      ...page,
      observations: [snapshot(1), disconnected(2, "screen", "device-lost")],
      nextAfterSequence: 2,
    };
    render(<LiveCardHost />);
    act(() => presentation.setMode("card"));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /^Screen: lost/ }));
    expect(screen.getByTestId("source-reason")).toHaveTextContent(
      "Device lost: no on-screen window matched the title you selected.",
    );
    expect(screen.getByTestId("source-fix")).toHaveTextContent(
      /pick a window that is on screen/,
    );
  });

  it("shows the exact permission fix and offers to choose what to capture", async () => {
    serve(connected());
    page = {
      ...page,
      observations: [
        snapshot(1),
        disconnected(2, "screen", "permission-revoked"),
      ],
      nextAfterSequence: 2,
    };
    render(<LiveCardHost />);
    act(() => presentation.setMode("card"));
    await settle();
    fireEvent.click(
      screen.getByRole("button", { name: /^Screen: lost-permission/ }),
    );
    expect(screen.getByTestId("source-fix")).toHaveTextContent(
      "allow Screen Recording for the capture companion in System Settings, then restart it.",
    );
    await click("Choose what to capture…");
    expect(screen.getByRole("menu", { name: "Capture source" })).toBeVisible();
  });

  it("the microphone light explains its state and offers browser dictation", async () => {
    await openCard(connected());
    fireEvent.click(
      screen.getByRole("button", { name: /^Microphone: .*Show details/ }),
    );
    expect(
      screen.getByTestId("source-reason").textContent?.length,
    ).toBeGreaterThan(10);
    await click("Dictate in this browser");
    expect(FakeRecognition.instances[0]?.start).toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    await openCard(connected());
    fireEvent.click(
      screen.getByRole("button", { name: /^App audio: .*Show details/ }),
    );
    fireEvent.keyDown(screen.getByTestId("source-popover"), { key: "Escape" });
    expect(screen.queryByTestId("source-popover")).toBeNull();
  });
});

describe("transcript and chat", () => {
  it("lists what was spoken, dictated and typed above the input", async () => {
    serve(connected());
    page = {
      ...page,
      observations: [
        snapshot(1),
        {
          sequence: 2,
          sourceId: "microphone",
          eventId: "evt-2",
          kind: "transcript.final",
          receivedAt: minutesAfter(0, 59),
          content: {
            occurredAt: minutesAfter(0, 59),
            sourceSequence: 2,
            body: {
              speaker: "interviewer",
              text: "Walk me through it",
              startMs: 0,
              endMs: 900,
            },
          },
          screenshotArtifactId: null,
        },
      ],
      nextAfterSequence: 2,
    };
    render(<LiveCardHost />);
    act(() => presentation.setMode("card"));
    await settle();
    const log = within(screen.getByTestId("chat-log"));
    expect(log.getByText("Spoken")).toBeVisible();
    expect(log.getByText("Walk me through it")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Follow-up"), {
      target: { value: "ok then" },
    });
    await click("Send follow-up");
    expect(log.getByText("Typed")).toBeVisible();
    expect(log.getByText("ok then")).toBeVisible();
  });
});

describe("it just works without the companion", () => {
  it("shows ONE line, no waiting empty state and no per-source lights, when the companion has not made contact", async () => {
    await openCard();
    const line = screen.getByTestId("companion-line");
    expect(line).toHaveTextContent("Capture companion: not connected");
    expect(card()).not.toHaveTextContent(/Waiting for the capture companion/i);
    expect(card()).not.toHaveTextContent(/waiting/i);
    expect(screen.queryByTestId("ov-sources")).toBeNull();
    expect(
      document.querySelectorAll('[data-testid="companion-line"]'),
    ).toHaveLength(1);
    // The browser path is all there: capture, dictation, typing.
    expect(
      screen.getByRole("button", { name: /Capture & analyze/ }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Dictate" })).toBeEnabled();
    expect(screen.getByLabelText("Follow-up")).toBeEnabled();
  });

  it("opens a Set up disclosure of three numbered steps, each with a copy button", async () => {
    const written: string[] = [];
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: navigator.mediaDevices,
      clipboard: {
        writeText: vi.fn(async (text: string) => void written.push(text)),
      },
    });
    await openCard();
    expect(screen.queryByTestId("companion-steps")).toBeNull();
    await click("Set up");
    const steps = within(screen.getByTestId("companion-steps"));
    const items = steps.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(screen.getByTestId("companion-steps").tagName).toBe("OL");
    expect(items[0]).toHaveTextContent(/Build and launch the companion app/);
    expect(items[1]).toHaveTextContent(/Paste the pairing credential/);
    expect(items[2]).toHaveTextContent(
      /swift run capture-companion run --screen/,
    );
    const copies = steps.getAllByRole("button", { name: /^Copy command/ });
    expect(copies).toHaveLength(3);
    fireEvent.click(copies[2] as HTMLElement);
    await flush();
    expect(written).toEqual(["swift run capture-companion run --screen"]);
  });

  it("flips to the source lights the moment contact happens, and back when it goes", async () => {
    await openCard();
    expect(screen.getByTestId("companion-line")).toBeVisible();
    page = { ...page, session: connected() };
    await advance(1_500);
    expect(screen.queryByTestId("companion-line")).toBeNull();
    expect(screen.getByTestId("ov-sources")).toBeVisible();
    // Not a stale "waiting": every light says what it is.
    for (const light of screen
      .getByTestId("ov-sources")
      .querySelectorAll("button"))
      expect(light.getAttribute("data-health")).not.toBe("waiting");
    page = { ...page, session: remote() };
    await advance(150_000);
    expect(screen.getByTestId("companion-line")).toBeVisible();
  });

  it("keeps companion state out of Activity", async () => {
    await openCard();
    await click(/Activity/);
    expect(
      screen.getByRole("button", { name: /Activity/ }).parentElement,
    ).not.toHaveTextContent(/companion|waiting/i);
  });
});

describe("capture feels instant", () => {
  it("says Capturing… while the frame is taken, then Analyzing… while it is sent", async () => {
    await openCard();
    await shareSource();
    // Hold the frame encode so the capturing phase is observable.
    let finish!: () => void;
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      value: vi.fn(function (this: HTMLCanvasElement, callback: BlobCallback) {
        finish = () =>
          callback(new Blob([new Uint8Array(4096)], { type: "image/jpeg" }));
      }),
      configurable: true,
    });
    let release!: (response: Response) => void;
    server.on(
      "POST /:id/capture",
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    await click(/Capture & analyze/);
    fireEvent.click(
      screen.getByRole("menuitem", { name: /New task from a fresh capture/ }),
    );
    await flush();
    expect(screen.getByRole("button", { name: /Capturing…/ })).toBeDisabled();
    expect(screen.getByTestId("analyzing")).toHaveTextContent("Capturing…");
    expect(screen.getByTestId("bar-status")).toHaveAttribute(
      "data-status",
      "capturing",
    );
    finish();
    await settle();
    expect(screen.getByRole("button", { name: /Analyzing…/ })).toBeDisabled();
    expect(screen.getByTestId("analyzing")).toHaveTextContent("Analyzing…");
    release(
      jsonResponse(
        {
          input: { requestId: "r", sequence: 1 },
          snapshot: { sourceId: "b", eventId: "e" },
        },
        202,
      ),
    );
    await settle();
    expect(
      screen.getByRole("button", { name: /Capture & analyze/ }),
    ).toBeEnabled();
  });

  it("flashes the frame that was taken, with its size, for a moment", async () => {
    await openCard();
    await shareSource();
    await click(/Capture & analyze/);
    fireEvent.click(
      screen.getByRole("menuitem", { name: /New task from a fresh capture/ }),
    );
    await settle();
    expect(screen.getByTestId("capture-flash")).toHaveTextContent(
      "Captured · 1920 × 1080 · 1 KB",
    );
    await advance(3_000);
    expect(screen.queryByTestId("capture-flash")).toBeNull();
  });

  it("flips Pause to Resume at once", async () => {
    await openCard();
    let release!: (response: Response) => void;
    server.on(
      "POST /:id/control",
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(within(card()).getByRole("button", { name: "Pause" }));
    await flush();
    expect(
      within(card()).getByRole("button", { name: "Resume" }),
    ).toBeVisible();
    expect(screen.getByTestId("ov-status")).toHaveTextContent(/^Paused/);
    // The server agrees: the stream says paused too.
    page = { ...page, session: remote({ status: "paused" }) };
    release(jsonResponse({ session: remote({ status: "paused" }) }));
    await settle();
    expect(
      within(card()).getByRole("button", { name: "Resume" }),
    ).toBeVisible();
  });
});

describe("choosing the area has one clear entry", () => {
  it("has no crop button in the command bar", async () => {
    await openCard();
    const bar = within(screen.getByTestId("command-bar"));
    expect(bar.queryByRole("button", { name: /region|area|crop/i })).toBeNull();
    // Capture, dictate, Auto, topic and settings.
    expect(bar.getAllByRole("button")).toHaveLength(5);
  });

  it("opens from Choose area… in the source menu, with nothing shared and when sharing", async () => {
    await openCard();
    await click(/Capture & analyze/);
    fireEvent.click(screen.getByRole("menuitem", { name: /Choose area…/ }));
    await flush();
    expect(screen.getByTestId("mask-editor")).toBeVisible();
    fireEvent.keyDown(screen.getByTestId("mask-rect"), { key: "Escape" });
    await shareSource();
    await click(/Capture & analyze/);
    fireEvent.click(screen.getByRole("menuitem", { name: /Choose area…/ }));
    await flush();
    expect(screen.getByTestId("mask-editor")).toBeVisible();
  });

  it("shows a Cropped chip only when an area is set, and it opens the editor", async () => {
    await openCard();
    expect(screen.queryByTestId("region-chip")).toBeNull();
    await openEditor();
    await click("Left side");
    await click("Save region");
    const chip = screen.getByTestId("region-chip");
    expect(chip).toHaveTextContent("Cropped");
    fireEvent.click(chip);
    await flush();
    expect(screen.getByTestId("mask-editor")).toBeVisible();
  });

  it("shows presets as icons with names and tooltips, and no text labels", async () => {
    await openCard();
    await openEditor();
    const presets = within(
      screen.getByRole("group", { name: "Presets" }),
    ).getAllByRole("button");
    expect(presets.map((p) => p.getAttribute("aria-label"))).toEqual([
      "Everything",
      "Left side",
      "Right side",
      "Top",
      "Bottom",
      "Middle",
    ]);
    for (const preset of presets) {
      expect(preset.textContent).toBe("");
      expect(preset.querySelector("svg")).not.toBeNull();
      expect(preset.getAttribute("title")).toBe(
        preset.getAttribute("aria-label"),
      );
    }
  });

  it("describes the area in plain words and shows pixels only while dragging", async () => {
    await openCard();
    await shareSource();
    await openEditor();
    expect(screen.getByTestId("mask-readout")).toHaveTextContent(
      "Everything on the shared screen",
    );
    await click("Right side");
    expect(screen.getByTestId("mask-readout")).toHaveTextContent(
      "Right half of the shared screen",
    );
    expect(screen.getByTestId("mask-readout").textContent).not.toMatch(
      /\d+%\s*×|at \d+%/,
    );
    expect(screen.queryByTestId("mask-pixels")).toBeNull();
    // The preview reports the real frame size; dragging shows the pixels.
    const video = within(screen.getByTestId("mask-editor")).getByTestId(
      "local-preview",
    );
    fireEvent.loadedMetadata(video);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const wide = this.classList.contains("ov-stage");
        return {
          left: 0,
          top: 0,
          right: wide ? 1000 : 0,
          bottom: wide ? 500 : 0,
          width: wide ? 1000 : 0,
          height: wide ? 500 : 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
    const south = screen
      .getByTestId("mask-rect")
      .querySelector('[data-handle="s"]') as HTMLElement;
    fireEvent.pointerDown(south, { clientX: 700, clientY: 500, button: 0 });
    fireEvent.pointerMove(
      screen
        .getByTestId("mask-editor")
        .querySelector(".ov-stage") as HTMLElement,
      {
        clientX: 700,
        clientY: 250,
      },
    );
    expect(screen.getByTestId("mask-pixels")).toHaveTextContent("960 × 540 px");
    fireEvent.pointerUp(
      screen
        .getByTestId("mask-editor")
        .querySelector(".ov-stage") as HTMLElement,
    );
    expect(screen.queryByTestId("mask-pixels")).toBeNull();
  });
});

describe("dictation is obviously working", () => {
  const mic = () =>
    screen.getByRole("button", { name: /Dictate|Stop dictation/ });

  it("says 'speak now', then 'Heard nothing' after six quiet seconds, and clears it when words come", async () => {
    await openCard();
    fireEvent.click(mic());
    await flush();
    expect(screen.getByTestId("listening-hint")).toHaveTextContent(
      "Listening… speak now",
    );
    await advance(5_000);
    expect(screen.getByTestId("listening-hint")).toHaveTextContent(
      "Listening… speak now",
    );
    await advance(2_000);
    expect(screen.getByTestId("listening-hint")).toHaveTextContent(
      "Heard nothing — check your microphone",
    );
    act(() =>
      FakeRecognition.instances[0]?.say({ text: "hello", final: false }),
    );
    expect(screen.getByTestId("listening-hint")).toHaveTextContent(
      "Listening…",
    );
    expect(screen.getByTestId("listening-hint")).not.toHaveTextContent(
      "Heard nothing",
    );
  });

  it("pulses the mic while listening, and shows an animated indicator without a meter", async () => {
    await openCard();
    expect(mic()).not.toHaveClass("live");
    fireEvent.click(mic());
    await flush();
    expect(mic()).toHaveClass("live");
    expect(screen.getByTestId("mic-meter")).toHaveClass("anim");
  });

  it("shows a live level meter from the microphone when the browser gives one, all local", async () => {
    const stop = vi.fn();
    let sample = 128;
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop }],
    }));
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: { ...navigator.mediaDevices, getUserMedia },
    });
    const closed = vi.fn();
    class FakeAudioContext {
      createAnalyser() {
        return {
          fftSize: 0,
          getByteTimeDomainData: (data: Uint8Array) => data.fill(sample),
        };
      }
      createMediaStreamSource() {
        return { connect: () => undefined };
      }
      close = closed;
    }
    (window as unknown as { AudioContext: unknown }).AudioContext =
      FakeAudioContext;
    await openCard();
    fireEvent.click(mic());
    await flush();
    await flush();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    await advance(300);
    const meter = screen.getByTestId("mic-meter");
    expect(meter).not.toHaveClass("anim");
    expect(meter.getAttribute("data-level")).toBe("0.00");
    sample = 200;
    await advance(300);
    expect(
      Number(screen.getByTestId("mic-meter").getAttribute("data-level")),
    ).toBeGreaterThan(0.5);
    // Stopping releases the microphone and leaves the text for editing.
    act(() =>
      FakeRecognition.instances[0]?.say({ text: "use a heap", final: true }),
    );
    fireEvent.click(mic());
    await flush();
    expect(stop).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
    expect(screen.queryByTestId("listening-hint")).toBeNull();
    expect(screen.getByLabelText("Follow-up")).toHaveValue("use a heap");
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  });

  it("types over interim words as typed text", async () => {
    await openCard();
    fireEvent.click(mic());
    await flush();
    act(() =>
      FakeRecognition.instances[0]?.say({ text: "use a hash", final: false }),
    );
    const input = screen.getByLabelText("Follow-up");
    fireEvent.change(input, { target: { value: "use a hash map" } });
    expect(input).toHaveValue("use a hash map");
    expect(input).not.toHaveClass("interim");
  });
});
