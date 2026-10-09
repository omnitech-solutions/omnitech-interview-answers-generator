// The Record transcript control against a server the test holds by hand: it
// is off until pressed, says plainly when it is on and how many lines it
// holds, reads the count again while on, and never leaves a recording
// running behind a window that has closed. Opening the window reads the
// server's state once (and stops a recording found on), so every case begins
// with that one GET.
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RecordTranscriptButton,
  useTranscriptRecording,
} from "./record-transcript";

const SESSION = "5e551011-0000-4000-8000-00000000000a";
const URL_PATH = `/api/interview/t/local/sessions/${SESSION}/recording`;
const FILE = "2026-10-08T09-40-00-000-5e551011.txt";

type Recording = { on: boolean; lines: number; file?: string };
type Asked = {
  method: string;
  url: string;
  body: unknown;
  contentType: string | null;
  tenant: string | null;
  keepalive: boolean;
};
// The server's side: what it holds, what it was asked, and how it answers.
let held: Recording;
let asked: Asked[];
let answer: (asked: Asked) => Response | Promise<Response>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
// Answers as the routes do: a press sets the state, a read gives it.
const server = (request: Asked) => {
  if (request.method === "POST") {
    const on = (request.body as { on: boolean }).on;
    held = on
      ? { on: true, lines: held.on ? held.lines : 0, file: FILE }
      : { ...held, on: false };
  }
  return json({ recording: held });
};

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const button = () => screen.getByTestId("pn-record-transcript");
const press = async () => {
  fireEvent.click(button());
  await flush();
};
const posts = () => asked.filter((each) => each.method === "POST");
const reads = () => asked.filter((each) => each.method === "GET");
// The reads made while recording: every one after the read on opening.
const polls = () => reads().slice(1);

beforeEach(() => {
  vi.useFakeTimers();
  held = { on: false, lines: 0 };
  asked = [];
  answer = server;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const request: Asked = {
        method: init?.method ?? "GET",
        url: String(input),
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        contentType: headers.get("content-type"),
        tenant: headers.get("x-omnitech-tenant"),
        keepalive: init?.keepalive === true,
      };
      asked.push(request);
      return answer(request);
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

describe("Record transcript, off", () => {
  it("is a quiet button that says what it would do, not pressed", () => {
    render(<RecordTranscriptButton sessionId={SESSION} />);
    expect(button()).toHaveTextContent("Record transcript");
    expect(button()).toHaveAttribute("data-recording", "off");
    expect(button()).toHaveAttribute("aria-pressed", "false");
    expect(button()).toBeEnabled();
    expect(button()).toHaveAttribute(
      "title",
      "Record what this session hears as a transcript file on this machine.",
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("starts nothing by itself, and reads once on opening and not again while off", async () => {
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await advance(10_000);
    expect(posts()).toEqual([]);
    expect(asked).toEqual([
      {
        method: "GET",
        url: URL_PATH,
        body: undefined,
        contentType: null,
        tenant: null,
        keepalive: false,
      },
    ]);
    expect(button()).toHaveAttribute("data-recording", "off");
  });

  it("cannot be pressed while the session is paused", async () => {
    render(<RecordTranscriptButton sessionId={SESSION} disabled />);
    expect(button()).toBeDisabled();
    await press();
    expect(posts()).toEqual([]);
    expect(button()).toHaveAttribute("data-recording", "off");
  });
});

describe("opening the window", () => {
  it("shows what the server holds of a recording that is off: the file last kept", async () => {
    held = { on: false, lines: 6, file: FILE };
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await flush();
    expect(asked.map((each) => each.method)).toEqual(["GET"]);
    expect(button()).toHaveAttribute("data-recording", "off");
    expect(button()).toHaveAttribute(
      "title",
      `Record a transcript. The last one is kept as ${FILE}.`,
    );
  });

  it("stops a recording still on at the server, and shows off: it is never resumed", async () => {
    held = { on: true, lines: 4, file: FILE };
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await flush();
    expect(asked.map((each) => [each.method, each.url, each.body])).toEqual([
      ["GET", URL_PATH, undefined],
      ["POST", URL_PATH, { on: false }],
    ]);
    expect(posts()[0]).toMatchObject({
      contentType: "application/json",
      keepalive: false,
    });
    expect(held.on).toBe(false);
    expect(button()).toHaveAttribute("data-recording", "off");
    expect(button()).toHaveTextContent("Record transcript");
    expect(button()).toHaveAttribute(
      "title",
      `Record a transcript. The last one is kept as ${FILE}.`,
    );
    // Off: nothing more is asked.
    await advance(30_000);
    expect(asked).toHaveLength(2);
  });

  it.each([
    ["the server breaks", () => new Response("no", { status: 500 })],
    [
      "the network fails",
      () => Promise.reject(new TypeError("Failed to fetch")),
    ],
    ["the answer holds no recording", () => json({})],
  ])(
    "is off, with no failure shown and nothing sent, when %s on that read",
    async (_name, how) => {
      answer = how as typeof answer;
      render(<RecordTranscriptButton sessionId={SESSION} />);
      await flush();
      expect(posts()).toEqual([]);
      expect(button()).toHaveTextContent("Record transcript");
      expect(button()).toHaveAttribute("data-recording", "off");
      // And it can still be pressed.
      answer = server;
      await press();
      expect(button()).toHaveAttribute("data-recording", "on");
    },
  );

  it("asks nothing with no session", async () => {
    const { result, unmount } = renderHook(() => useTranscriptRecording(null));
    await act(() => result.current.set(true));
    await advance(10_000);
    unmount();
    await flush();
    expect(asked).toEqual([]);
    expect(result.current.recording).toEqual({ on: false, lines: 0 });
  });

  it("a window closed before that read is answered sends nothing more", async () => {
    let arrive: () => void = () => undefined;
    answer = (request) =>
      new Promise<Response>((resolve) => {
        arrive = () => resolve(server(request));
      });
    const { unmount } = render(<RecordTranscriptButton sessionId={SESSION} />);
    unmount();
    arrive();
    await flush();
    expect(asked.map((each) => each.method)).toEqual(["GET"]);
  });

  // DEFECT (record-transcript.tsx:45-49): the read on opening is applied
  // whenever it arrives. When Record is pressed (and answered) before that
  // read is, the read's older "off" is written over the recording that has
  // since started: the window shows "Record transcript", off, while the
  // server records, and closing the window then sends no stop (it reads what
  // the window showed). Remove `.fails` when a read answered after a press is
  // dropped, or the recording it hides is stopped.
  it("DEFECT: the read on opening, answered after a press, does not hide the recording that press started", async () => {
    let arrive: () => void = () => undefined;
    answer = (request) => {
      if (request.method !== "GET") return server(request);
      // Answered as the server stood when it was read: off.
      const then = json({ recording: held });
      return new Promise<Response>((resolve) => {
        arrive = () => resolve(then);
      });
    };
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    expect(button()).toHaveAttribute("data-recording", "on");
    arrive();
    await flush();
    expect(
      button().getAttribute("data-recording") === "on" || held.on === false,
    ).toBe(true);
  });

  // DEFECT, minor (record-transcript.tsx:50-58): when the recording found on
  // cannot be stopped (the stop is refused or lost), the window shows off and
  // does not try again, so the server goes on recording behind a control
  // that says it is not, and closing the window sends no stop. Remove
  // `.fails` when it shows the recording as on, or stops it.
  it("DEFECT: a recording found on that could not be stopped is not shown as off", async () => {
    held = { on: true, lines: 4, file: FILE };
    answer = (request) =>
      request.method === "POST"
        ? new Response("no", { status: 500 })
        : server(request);
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await flush();
    expect(
      button().getAttribute("data-recording") === "on" || held.on === false,
    ).toBe(true);
  });
});

describe("pressing Record transcript", () => {
  it("asks the session's recording to start, and says it is recording with its lines", async () => {
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    expect(posts()).toEqual([
      {
        method: "POST",
        url: URL_PATH,
        body: { on: true },
        contentType: "application/json",
        tenant: null,
        keepalive: false,
      },
    ]);
    expect(button()).toHaveTextContent("Recording · 0 lines");
    expect(button()).toHaveAttribute("data-recording", "on");
    expect(button()).toHaveAttribute("aria-pressed", "true");
    expect(button().getAttribute("title")).toMatch(/Click to stop\.$/);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("names the tenant of the page it is on, in the path and for the host", async () => {
    window.history.pushState({}, "", "/t/harbour%20line/live");
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    expect(asked.map((each) => each.method)).toEqual(["GET", "POST"]);
    for (const each of asked)
      expect(each).toMatchObject({
        url: `/api/interview/t/harbour%20line/sessions/${SESSION}/recording`,
        tenant: "harbour line",
      });
  });

  it.each([
    [1, "Recording · 1 line"],
    [2, "Recording · 2 lines"],
    [120, "Recording · 120 lines"],
  ])("counts %i as it should read", async (lines, label) => {
    answer = () => json({ recording: { on: true, lines, file: FILE } });
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    expect(button()).toHaveTextContent(label);
    expect(button().textContent).toBe(label);
  });

  it("pressed again, asks it to stop and is off, naming the file that was kept", async () => {
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    await press();
    expect(posts().map((each) => each.body)).toEqual([
      { on: true },
      { on: false },
    ]);
    expect(posts()[1]).toMatchObject({ url: URL_PATH, keepalive: false });
    expect(button()).toHaveTextContent("Record transcript");
    expect(button()).toHaveAttribute("data-recording", "off");
    expect(button()).toHaveAttribute("aria-pressed", "false");
    expect(button()).toHaveAttribute(
      "title",
      `Record a transcript. The last one is kept as ${FILE}.`,
    );
  });

  it("can be stopped while the session is paused, though not started", async () => {
    const { rerender } = render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    rerender(<RecordTranscriptButton sessionId={SESSION} disabled />);
    expect(button()).toBeEnabled();
    await press();
    expect(posts().at(-1)?.body).toEqual({ on: false });
    expect(button()).toHaveAttribute("data-recording", "off");
    expect(button()).toBeDisabled();
  });
});

describe("a start that fails", () => {
  it.each([
    [
      "the server refuses",
      () => json({ error: { code: "invalid_input" } }, 400),
    ],
    [
      "the session is not found",
      () => json({ error: { code: "not_found" } }, 404),
    ],
    ["the server breaks", () => new Response("no", { status: 500 })],
    [
      "the network fails",
      () => Promise.reject(new TypeError("Failed to fetch")),
    ],
    ["the answer holds no recording", () => json({})],
  ])("says it could not record and stays off when %s", async (_name, how) => {
    answer = how as typeof answer;
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    expect(button()).toHaveTextContent("Could not record");
    expect(button()).toHaveAttribute("data-recording", "off");
    expect(button()).toHaveAttribute("aria-pressed", "false");
    expect(button()).toHaveAttribute(
      "title",
      "The recording could not be started.",
    );
    // Nothing is read for a recording that is not on, after the one read
    // on opening.
    await advance(10_000);
    expect(polls()).toEqual([]);
    expect(reads()).toHaveLength(1);
  });

  it("can be pressed again, and a start that works clears the failure", async () => {
    answer = () => new Response("no", { status: 500 });
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    expect(button()).toHaveTextContent("Could not record");
    answer = server;
    await press();
    expect(posts().map((each) => each.body)).toEqual([
      { on: true },
      { on: true },
    ]);
    expect(button()).toHaveTextContent("Recording · 0 lines");
  });

  it("a stop that fails leaves it showing as recording, which it still is", async () => {
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    answer = () => new Response("no", { status: 500 });
    await press();
    expect(button()).toHaveAttribute("data-recording", "on");
    expect(button()).toHaveTextContent("Recording · 0 lines");
  });
});

describe("while it is on", () => {
  it("reads the count again every 3 seconds, and not sooner", async () => {
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    held = { ...held, lines: 3 };
    await advance(2_999);
    expect(polls()).toEqual([]);
    expect(button()).toHaveTextContent("Recording · 0 lines");
    await advance(1);
    expect(polls()).toEqual([
      {
        method: "GET",
        url: URL_PATH,
        body: undefined,
        contentType: null,
        tenant: null,
        keepalive: false,
      },
    ]);
    expect(button()).toHaveTextContent("Recording · 3 lines");
    held = { ...held, lines: 7 };
    await advance(3_000);
    expect(polls()).toHaveLength(2);
    expect(button()).toHaveTextContent("Recording · 7 lines");
    await advance(9_000);
    expect(polls()).toHaveLength(5);
  });

  it("turns off here when the session's recording was stopped elsewhere, and stops reading", async () => {
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    // The session ended: the server stopped the recording.
    held = { on: false, lines: 5, file: FILE };
    await advance(3_000);
    expect(button()).toHaveAttribute("data-recording", "off");
    expect(button()).toHaveTextContent("Record transcript");
    const before = polls().length;
    await advance(30_000);
    expect(polls()).toHaveLength(before);
    expect(posts()).toHaveLength(1);
  });

  it("keeps what it shows when a read fails, and goes on reading", async () => {
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    held = { ...held, lines: 2 };
    await advance(3_000);
    answer = (request) =>
      request.method === "GET"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : server(request);
    await advance(3_000);
    answer = (request) =>
      request.method === "GET"
        ? new Response("no", { status: 503 })
        : server(request);
    await advance(3_000);
    expect(button()).toHaveTextContent("Recording · 2 lines");
    answer = server;
    held = { ...held, lines: 9 };
    await advance(3_000);
    expect(button()).toHaveTextContent("Recording · 9 lines");
    expect(polls()).toHaveLength(4);
  });

  it("stops reading once it is stopped", async () => {
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    await advance(3_000);
    await press();
    const before = polls().length;
    await advance(30_000);
    expect(polls()).toHaveLength(before);
  });
});

describe("closing the window", () => {
  it("stops a recording that is on: one last press of off, sent to outlive the page", async () => {
    const { unmount } = render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    unmount();
    await flush();
    expect(posts().map((each) => [each.body, each.keepalive])).toEqual([
      [{ on: true }, false],
      [{ on: false }, true],
    ]);
    expect(posts()[1]).toMatchObject({
      url: URL_PATH,
      contentType: "application/json",
    });
    expect(held.on).toBe(false);
    // And nothing is read afterwards.
    const before = asked.length;
    await advance(30_000);
    expect(asked).toHaveLength(before);
  });

  it("asks nothing when it is off: never pressed, already stopped, or failed to start", async () => {
    const never = render(<RecordTranscriptButton sessionId={SESSION} />);
    never.unmount();
    await flush();
    // The read on opening, and nothing else.
    expect(asked.map((each) => each.method)).toEqual(["GET"]);

    const stopped = render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    await press();
    stopped.unmount();
    await flush();
    expect(posts().map((each) => each.body)).toEqual([
      { on: true },
      { on: false },
    ]);

    asked = [];
    answer = (request) =>
      request.method === "POST"
        ? new Response("no", { status: 500 })
        : server(request);
    const failed = render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    failed.unmount();
    await flush();
    expect(posts().map((each) => each.body)).toEqual([{ on: true }]);
  });

  it("does not throw when the last press cannot be sent", async () => {
    const { unmount } = render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    answer = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(() => unmount()).not.toThrow();
    await flush();
  });

  it("stops a recording whose start was still on the way when the window closed", async () => {
    let arrive: () => void = () => undefined;
    answer = (request) =>
      request.method === "POST" && (request.body as { on: boolean }).on
        ? new Promise<Response>((resolve) => {
            arrive = () => resolve(server(request));
          })
        : server(request);
    const { unmount } = render(<RecordTranscriptButton sessionId={SESSION} />);
    await flush();
    fireEvent.click(button());
    // The start is on its way, unanswered, and the window still shows off.
    expect(button()).toHaveAttribute("data-recording", "off");
    unmount();
    await flush();
    // The stop is sent after the start, to outlive the page.
    expect(posts().map((each) => [each.body, each.keepalive])).toEqual([
      [{ on: true }, false],
      [{ on: false }, true],
    ]);
    arrive();
    await flush();
    expect(asked).toHaveLength(3);
  });

  it("a start that was answered with a failure leaves nothing to stop on closing", async () => {
    answer = (request) =>
      request.method === "POST"
        ? new Response("no", { status: 500 })
        : server(request);
    const { unmount } = render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    unmount();
    await flush();
    expect(posts().map((each) => each.body)).toEqual([{ on: true }]);
  });
});
