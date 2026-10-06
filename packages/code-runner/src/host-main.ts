// The code runner service for the Docker stack, run on the host (Docker is only
// reachable from there). The containerised web app calls it through
// RemoteCodeRunner; it runs submitted code in the runner's sandboxed containers.
// Bundled and started by scripts/docker-host-services.sh. Not part of the
// package's public surface (index.ts does not export it).
//
// [SAFETY] Loopback only, a shared bearer token on every call, a bounded body.
// The token and body rules live in createRunnerHandler (tested); this file only
// adapts Node's HTTP server to it.
import { createServer, type IncomingMessage } from "node:http";

import { DockerCodeRunner } from "./index";
import { createRunnerHandler } from "./serve";

const port = Number(process.env["CODE_RUNNER_PORT"] ?? 3002);
const MAX_BODY_BYTES = 1024 * 1024 + 1024;
const handle = createRunnerHandler(
  new DockerCodeRunner(),
  process.env["CODE_RUNNER_TOKEN"] ?? "",
);

// null: the body is over the limit, and the rest of it is not read.
async function readBounded(request: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

createServer(async (incoming, outgoing) => {
  try {
    const body =
      incoming.method === "POST" ? await readBounded(incoming) : undefined;
    const response =
      body === null
        ? new Response(JSON.stringify({ error: "too_large" }), { status: 413 })
        : await handle(
            new Request(`http://127.0.0.1:${port}${incoming.url ?? "/"}`, {
              method: incoming.method ?? "GET",
              headers: incoming.headers as Record<string, string>,
              ...(body ? { body: new Uint8Array(body) } : {}),
            }),
          );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500).end();
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`code runner listening on 127.0.0.1:${port}`);
});
