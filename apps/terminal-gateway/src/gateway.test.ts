import { type ChildProcess, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startTerminalGateway, type TerminalGateway } from "./index.js";

const jobId = "3f2b8c1e-4d5a-4e6f-8a9b-0c1d2e3f4a5b";

// The platform's agent-job event endpoint, as the gateway polls it.
type Reply = { status: number; body: unknown };
let platform: Server;
let platformUrl: string;
let replies: Reply[] = [];
const requests: { url: string; authorization: string | undefined }[] = [];

beforeAll(async () => {
  platform = createServer((request, response) => {
    requests.push({
      url: request.url ?? "",
      authorization: request.headers.authorization,
    });
    const reply = replies.shift() ?? { status: 200, body: [] };
    response.writeHead(reply.status, { "content-type": "application/json" });
    response.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) =>
    platform.listen(0, "127.0.0.1", resolve),
  );
  platformUrl = `http://127.0.0.1:${(platform.address() as AddressInfo).port}/`;
});
afterAll(() => new Promise<void>((resolve) => platform.close(() => resolve())));

let gateway: TerminalGateway | undefined;
afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
  replies = [];
  requests.length = 0;
});

// A browser terminal: everything the gateway writes, and how it closed.
function connect(path: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${gateway!.port}${path}`);
  const received: string[] = [];
  socket.on("message", (data) => received.push(data.toString()));
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    socket.on("close", (code, reason) =>
      resolve({ code, reason: reason.toString() }),
    ),
  );
  const until = async (predicate: (text: string) => boolean) => {
    const deadline = Date.now() + 5_000;
    while (!predicate(received.join(""))) {
      if (Date.now() > deadline)
        throw new Error(`Timed out; received ${JSON.stringify(received)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return received.join("");
  };
  return { socket, received, closed, until };
}

describe("agent job event gateway", () => {
  it("relays a job's events to the terminal and resumes after the last sequence", async () => {
    gateway = await startTerminalGateway({
      port: 0,
      serviceToken: "service-secret",
      platformUrl,
    });
    replies = [
      {
        status: 200,
        body: [
          { sequence: 1, event: { type: "started", sessionId: "s-1" } },
          { sequence: 2, event: { type: "text-delta", text: "Hello\nworld" } },
        ],
      },
      {
        status: 200,
        body: [
          { sequence: 3, event: { type: "tool-started", tool: "command" } },
          {
            sequence: 4,
            event: { type: "tool-finished", tool: "command", success: true },
          },
          { sequence: 5, event: { type: "tool-started" } },
          { sequence: 6, event: { type: "tool-finished", success: false } },
          { sequence: 7, event: { type: "awaiting-input" } },
          { sequence: 8, event: "opaque progress" },
          { sequence: 9, event: { type: "completed", result: {} } },
        ],
      },
    ];

    const terminal = connect(`/terminal?session=${jobId}`);
    const output = await terminal.until((text) =>
      text.includes("[completed] Job finished"),
    );
    terminal.socket.close();

    expect(output).toContain(`Observing agent job ${jobId}`);
    expect(output).toContain("[started] Session s-1");
    expect(output).toContain("Hello\r\nworld");
    expect(output).toContain("[tool] command started");
    expect(output).toContain("[tool] command finished");
    expect(output).toContain("[tool] unknown started");
    expect(output).toContain("[tool] unknown failed");
    expect(output).toContain("[awaiting-input]");
    expect(output).toContain("[event] Progress update");
    expect(requests[0]).toEqual({
      url: `/api/platform/v1/agent-jobs/${jobId}/events?after=0`,
      authorization: "Bearer service-secret",
    });
    expect(requests[1]?.url).toContain("after=2");
  });

  it("tells the terminal when the event service fails, then keeps polling", async () => {
    gateway = await startTerminalGateway({ port: 0, platformUrl });
    replies = [
      { status: 503, body: { error: "unavailable" } },
      {
        status: 200,
        body: [
          { sequence: 1, event: { type: "usage", usage: {} } },
          { sequence: 2, event: { type: "failed" } },
          {
            sequence: 3,
            event: { type: "failed", error: { message: "Quota exceeded" } },
          },
        ],
      },
    ];

    const terminal = connect(`/terminal?session=${jobId}`);
    const output = await terminal.until((text) =>
      text.includes("Quota exceeded"),
    );
    terminal.socket.close();

    expect(output).toContain("[observer] Event service returned 503");
    expect(output).toContain("[usage] Updated");
    expect(output).toContain("[failed] Job failed");
    expect(requests[0]?.authorization).toBeUndefined();
  });

  it("answers typed input with where follow-ups belong", async () => {
    gateway = await startTerminalGateway({ port: 0, platformUrl });

    const terminal = connect(`/terminal?session=${jobId}`);
    await terminal.until((text) => text.includes("Observing"));
    terminal.socket.send("continue please");
    const output = await terminal.until((text) =>
      text.includes("product job controls"),
    );
    terminal.socket.close();

    expect(output).toContain(
      "[observer] Follow-up input is submitted through the product job controls.",
    );
  });

  it("refuses a connection without the browser token", async () => {
    gateway = await startTerminalGateway({
      port: 0,
      token: "browser-secret",
      platformUrl,
    });

    const refused = connect(`/terminal?session=${jobId}&token=wrong`);
    const admitted = connect(`/terminal?session=${jobId}&token=browser-secret`);
    await admitted.until((text) => text.includes("Observing"));
    admitted.socket.close();

    expect(await refused.closed).toEqual({
      code: 1008,
      reason: "Unauthorized",
    });
    expect(refused.received).toEqual([]);
  });

  it("refuses a connection that does not name an agent job", async () => {
    gateway = await startTerminalGateway({ port: 0, platformUrl });

    const missing = connect("/terminal");
    const malformed = connect("/terminal?session=../../etc/passwd");

    for (const terminal of [missing, malformed]) {
      expect(await terminal.closed).toEqual({
        code: 1008,
        reason: "A valid agent job id is required.",
      });
    }
    expect(requests).toEqual([]);
  });

  it("answers a plain HTTP request with its identity", async () => {
    gateway = await startTerminalGateway({ port: 0, platformUrl });

    const response = await fetch(`http://127.0.0.1:${gateway.port}/`);

    expect(await response.text()).toBe("agent job event gateway\n");
  });
});

describe("agent job event gateway service", () => {
  let child: ChildProcess | undefined;
  afterEach(() => {
    child?.kill();
  });

  it("starts from its environment when run as a program", async () => {
    child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("./index.ts", import.meta.url)),
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: {
          ...process.env,
          TERMINAL_GATEWAY_PORT: "0",
          TERMINAL_GATEWAY_TOKEN: "browser-secret",
          PLATFORM_HTTP_URL: platformUrl,
        },
      },
    );
    let stdout = "";
    const port = await new Promise<number>((resolve, reject) => {
      child!.stdout!.on("data", (chunk) => {
        stdout += chunk;
        const match = /ws:\/\/127\.0\.0\.1:(\d+)\/terminal/.exec(stdout);
        if (match) resolve(Number(match[1]));
      });
      child!.on("exit", (code) => reject(new Error(`exited ${code}`)));
    });

    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/terminal?session=${jobId}`,
    );
    const closed = await new Promise<number>((resolve) =>
      socket.on("close", (code) => resolve(code)),
    );

    // The token from the environment is enforced.
    expect(closed).toBe(1008);
  }, 20_000);
});
