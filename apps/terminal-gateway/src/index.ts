import { createServer } from "node:http";
import { type WebSocket, WebSocketServer } from "ws";
import { renderEvent } from "./render-event.js";

const port = Number(process.env["TERMINAL_GATEWAY_PORT"] ?? 3001);
const token = process.env["TERMINAL_GATEWAY_TOKEN"];
const serviceToken = process.env["AGENT_SERVICE_TOKEN"];
const platformUrl = (
  process.env["PLATFORM_HTTP_URL"] ?? "http://127.0.0.1:3000"
).replace(/\/$/, "");

function authorized(socket: WebSocket, requestUrl: string | undefined) {
  if (!token) return true;
  const supplied = requestUrl
    ? new URL(requestUrl, `http://localhost:${port}`).searchParams.get("token")
    : undefined;
  if (supplied === token) return true;
  socket.close(1008, "Unauthorized");
  return false;
}

function line(value: string): string {
  return `${value.replaceAll("\n", "\r\n")}\r\n`;
}

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("agent job event gateway\n");
});
const sockets = new WebSocketServer({ server, path: "/terminal" });

sockets.on("connection", (socket, request) => {
  if (!authorized(socket, request.url)) return;
  const jobId = request.url
    ? new URL(request.url, `http://localhost:${port}`).searchParams.get(
        "session",
      )
    : null;
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    socket.close(1008, "A valid agent job id is required.");
    return;
  }
  let sequence = 0;
  let closed = false;
  socket.send(line(`Observing agent job ${jobId}`));

  const poll = async () => {
    if (closed) return;
    try {
      const response = await fetch(
        `${platformUrl}/api/platform/v1/agent-jobs/${jobId}/events?after=${sequence}`,
        {
          headers: serviceToken
            ? { authorization: `Bearer ${serviceToken}` }
            : {},
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok)
        throw new Error(`Event service returned ${response.status}`);
      const events = (await response.json()) as Array<{
        sequence: number;
        event: unknown;
      }>;
      for (const persisted of events) {
        sequence = Math.max(sequence, persisted.sequence);
        if (socket.readyState === socket.OPEN) {
          socket.send(renderEvent(persisted.event));
        }
      }
    } catch (error) {
      if (socket.readyState === socket.OPEN) {
        socket.send(
          line(
            `[observer] ${
              error instanceof Error ? error.message : "Unable to read events"
            }`,
          ),
        );
      }
    } finally {
      if (!closed) setTimeout(() => void poll(), 750);
    }
  };
  void poll();

  socket.on("message", () => {
    if (socket.readyState === socket.OPEN) {
      socket.send(
        line(
          "[observer] Follow-up input is submitted through the product job controls.",
        ),
      );
    }
  });
  socket.on("close", () => {
    closed = true;
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    `Agent job event gateway listening on ws://127.0.0.1:${port}/terminal`,
  );
});
