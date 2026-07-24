import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { spawn } from "node-pty";
import { type WebSocket, WebSocketServer } from "ws";
import { ensureNodePtySpawnHelperExecutable } from "./node-pty-helper.js";

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

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("terminal gateway\n");
});
const sockets = new WebSocketServer({ server, path: "/terminal" });

sockets.on("connection", (socket, request) => {
  if (!authorized(socket, request.url)) return;

  const terminal = spawn(
    shell,
    ["-ilc", "exec tmux new-session -A -s workspace"],
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
