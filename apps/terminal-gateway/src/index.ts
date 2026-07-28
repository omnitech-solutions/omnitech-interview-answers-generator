import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { spawn } from "node-pty";
import { type WebSocket, WebSocketServer } from "ws";
import { ensureNodePtySpawnHelperExecutable } from "./node-pty-helper.js";
import { startConceptSession } from "./concept-session.js";

const port = Number(process.env["TERMINAL_GATEWAY_PORT"] ?? 3001);
const token = process.env["TERMINAL_GATEWAY_TOKEN"];
const shell = existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash";

ensureNodePtySpawnHelperExecutable({
  platform: process.platform,
  arch: process.arch,
});

function projectRoot(startDirectory: string) {
  let directory = startDirectory;
  while (true) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return startDirectory;
    directory = parent;
  }
}

const cwd =
  process.env["INTERVIEW_PROJECT_ROOT"] ??
  projectRoot(process.env["INIT_CWD"] ?? process.cwd());

function authorized(socket: WebSocket, requestUrl: string | undefined) {
  if (!token) return true;
  const supplied = requestUrl
    ? new URL(requestUrl, `http://localhost:${port}`).searchParams.get("token")
    : undefined;
  if (supplied === token) return true;
  socket.close(1008, "Unauthorized");
  return false;
}

const server = createServer((request, response) => {
  if (request.method === "POST" && request.url === "/concept-sessions") {
    if (token && request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          topic?: unknown;
        };
        if (typeof body.topic !== "string") {
          throw new TypeError("A concept topic is required.");
        }
        const session = startConceptSession(body.topic, { cwd });
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify(session));
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    });
    return;
  }
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("terminal gateway\n");
});
const sockets = new WebSocketServer({ server, path: "/terminal" });

sockets.on("connection", (socket, request) => {
  if (!authorized(socket, request.url)) return;
  const requestedSession = request.url
    ? new URL(request.url, `http://localhost:${port}`).searchParams.get(
        "session",
      )
    : null;
  const sessionName =
    requestedSession &&
    /^(?:workspace|concept-[a-z0-9-]+)$/.test(requestedSession)
      ? requestedSession
      : "workspace";

  const terminal = spawn(
    shell,
    [
      "-ilc",
      `tmux set-option -g mouse on && tmux set-option -g history-limit 10000 && exec tmux new-session -A -s ${sessionName}`,
    ],
    {
      cwd,
      env: process.env as Record<string, string>,
      cols: 120,
      rows: 32,
      name: "xterm-256color",
    },
  );

  terminal.onData((data) => {
    if (socket.readyState === socket.OPEN) socket.send(data);
  });
  terminal.onExit(() => socket.close());
  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(String(raw)) as {
        type?: string;
        data?: unknown;
        cols?: unknown;
        rows?: unknown;
      };
      if (message.type === "input" && typeof message.data === "string") {
        terminal.write(message.data);
      }
      if (
        message.type === "resize" &&
        typeof message.cols === "number" &&
        typeof message.rows === "number"
      ) {
        terminal.resize(Math.max(2, message.cols), Math.max(2, message.rows));
      }
    } catch {
      socket.close(1003, "Invalid terminal message");
    }
  });
  socket.on("close", () => terminal.kill());
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Terminal gateway listening on ws://127.0.0.1:${port}/terminal`);
  console.log(`Terminal project root: ${cwd}`);
});
