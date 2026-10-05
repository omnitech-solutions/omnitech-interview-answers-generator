import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { type WebSocket, WebSocketServer } from "ws";
import { renderEvent } from "./render-event";

export interface TerminalGatewayOptions {
  // 0 picks a free port.
  port: number;
  // When set, a browser must connect with ?token=<token>.
  token?: string | undefined;
  // The internal token the gateway sends when it reads job events.
  serviceToken?: string | undefined;
  platformUrl: string;
  // Browser origins allowed to open the socket besides the platform's own
  // origin and loopback development hosts.
  allowedOrigins?: readonly string[] | undefined;
}

export interface TerminalGateway {
  port: number;
  close(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// [SAFETY] A browser always sends Origin on a WebSocket handshake, so a
// foreign page cannot ride a visitor's local network position to read job
// events. Clients that send none (the CLI, tests) are not a browser's cross-
// site risk and pass.
function originAllowed(
  origin: string | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  if (origin === undefined) return true;
  if (allowed.has(origin)) return true;
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function line(value: string): string {
  return `${value.replaceAll("\n", "\r\n")}\r\n`;
}

export async function startTerminalGateway(
  options: TerminalGatewayOptions,
): Promise<TerminalGateway> {
  const platformUrl = options.platformUrl.replace(/\/$/, "");

  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("agent job event gateway\n");
  });
  const allowedOrigins = new Set([
    new URL(platformUrl).origin,
    ...(options.allowedOrigins ?? []),
  ]);
  const sockets = new WebSocketServer({
    server,
    path: "/terminal",
    verifyClient: ({ origin }: { origin?: string }, done) =>
      originAllowed(origin, allowedOrigins)
        ? done(true)
        : done(false, 403, "Forbidden"),
  });

  sockets.on("connection", (socket: WebSocket, request) => {
    const query = new URL(request.url ?? "/", "http://localhost").searchParams;
    if (options.token && query.get("token") !== options.token) {
      socket.close(1008, "Unauthorized");
      return;
    }
    const jobId = query.get("session");
    // A job's events are tenant-owned, so the platform reads them only inside
    // the tenant the observer names.
    const tenantId = query.get("tenant");
    if (!jobId || !UUID.test(jobId) || !tenantId || !UUID.test(tenantId)) {
      socket.close(1008, "A valid agent job and tenant id are required.");
      return;
    }
    let sequence = 0;
    let closed = false;
    socket.send(line(`Observing agent job ${jobId}`));

    const poll = async () => {
      if (closed) return;
      try {
        const response = await fetch(
          `${platformUrl}/api/platform/v1/agent-jobs/${jobId}/events?after=${sequence}&tenantId=${tenantId}`,
          {
            headers: options.serviceToken
              ? { authorization: `Bearer ${options.serviceToken}` }
              : {},
            signal: AbortSignal.timeout(5_000),
          },
        );
        if (!response.ok) {
          // Only the status number: the service's body and message stay here.
          if (socket.readyState === socket.OPEN)
            socket.send(
              line(
                `[observer] Event service unavailable (${response.status}).`,
              ),
            );
          return;
        }
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
      } catch {
        // A fixed text: error messages can carry URLs, tokens or paths.
        if (socket.readyState === socket.OPEN) {
          socket.send(line("[observer] Unable to read events."));
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

  await new Promise<void>((resolve) =>
    server.listen(options.port, "127.0.0.1", resolve),
  );
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise((resolve) => {
        for (const client of sockets.clients) client.terminate();
        sockets.close();
        server.close(() => resolve());
      }),
  };
}

// Run as the service (`pnpm terminal:dev`, `node dist/index.js`).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const gateway = await startTerminalGateway({
    port: Number(process.env["TERMINAL_GATEWAY_PORT"] ?? 3001),
    token: process.env["TERMINAL_GATEWAY_TOKEN"],
    serviceToken: process.env["AGENT_SERVICE_TOKEN"],
    platformUrl: process.env["PLATFORM_HTTP_URL"] ?? "http://127.0.0.1:3000",
    allowedOrigins: (process.env["TERMINAL_GATEWAY_ALLOWED_ORIGINS"] ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  });
  console.log(
    `Agent job event gateway listening on ws://127.0.0.1:${gateway.port}/terminal`,
  );
}
