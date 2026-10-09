// The Record transcript control against a server the test holds by hand: it
// is off until pressed, says plainly when it is on and how many lines it
// holds, reads the count again while on, and never leaves a recording
// running behind a window that has closed.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordTranscriptButton } from "./record-transcript";

const SESSION = "5e551011-0000-4000-8000-00000000000a";
const URL_PATH = `/api/interview/t/local/sessions/${SESSION}/recording`;
const FILE = "2026-10-08T09-40-00-5e551011.txt";

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

  it("starts nothing by itself, and does not read while off", async () => {
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await advance(10_000);
    expect(posts()).toEqual([]);
    expect(button()).toHaveAttribute("data-recording", "off");
  });

  // DEFECT (record-transcript.tsx:33-37, 68-80): the control starts as off
  // and never asks the server, and the stop on closing runs only when React
  // unmounts it. A window that is reloaded (or crashes) while recording
  // leaves the server recording, and the new window shows "Record
  // transcript", off, for a session that IS being recorded: the one thing
  // the control promises not to do ("never left running unseen"). Remove
  // `.fails` when opening the window reads the state, or stops it.
  it.fails("DEFECT: a recording still on at the server when the window opens is shown, or stopped", async () => {
    held = { on: true, lines: 4, file: FILE };
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await flush();
    expect(
      button().getAttribute("data-recording") === "on" || held.on === false,
    ).toBe(true);
  });

  it("cannot be pressed while the session is paused", async () => {
    render(<RecordTranscriptButton sessionId={SESSION} disabled />);
    expect(button()).toBeDisabled();
    await press();
    expect(asked).toEqual([]);
    expect(button()).toHaveAttribute("data-recording", "off");
  });
});

describe("pressing Record transcript", () => {
  it("asks the session's recording to start, and says it is recording with its lines", async () => {
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    expect(asked).toEqual([
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
    expect(asked[0]).toMatchObject({
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
    // Nothing is read for a recording that is not on.
    await advance(10_000);
    expect(reads()).toEqual([]);
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
    expect(reads()).toEqual([]);
    expect(button()).toHaveTextContent("Recording · 0 lines");
    await advance(1);
    expect(reads()).toEqual([
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
    expect(reads()).toHaveLength(2);
    expect(button()).toHaveTextContent("Recording · 7 lines");
    await advance(9_000);
    expect(reads()).toHaveLength(5);
  });

  it("turns off here when the session's recording was stopped elsewhere, and stops reading", async () => {
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    // The session ended: the server stopped the recording.
    held = { on: false, lines: 5, file: FILE };
    await advance(3_000);
    expect(button()).toHaveAttribute("data-recording", "off");
    expect(button()).toHaveTextContent("Record transcript");
    const before = reads().length;
    await advance(30_000);
    expect(reads()).toHaveLength(before);
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
    expect(reads()).toHaveLength(4);
  });

  it("stops reading once it is stopped", async () => {
    render(<RecordTranscriptButton sessionId={SESSION} />);
    await press();
    await advance(3_000);
    await press();
    const before = reads().length;
    await advance(30_000);
    expect(reads()).toHaveLength(before);
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
    expect(asked).toEqual([]);

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
    answer = () => new Response("no", { status: 500 });
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

  // DEFECT (record-transcript.tsx:39-40, 70-73): whether to stop on closing
  // is read from what the window last SHOWED. A window closed while its
  // start is still on the way shows off, so it sends no stop, and the server
  // then starts a recording that no window shows or will stop (until the
  // session ends). Remove `.fails` when a start in flight is stopped too.
  it.fails("DEFECT: stops a recording whose start was still on the way when the window closed", async () => {
    let arrive: () => void = () => undefined;
    answer = (request) =>
      new Promise<Response>((resolve) => {
        arrive = () => resolve(server(request));
      });
    const { unmount } = render(<RecordTranscriptButton sessionId={SESSION} />);
    fireEvent.click(button());
    unmount();
    answer = server;
    arrive();
    await flush();
    expect(held.on).toBe(false);
  });
});
