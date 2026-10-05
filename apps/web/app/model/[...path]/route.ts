import { createReadStream, realpathSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";

// The on-device (WebGPU) model's packed files, streamed with HTTP Range so a
// 2 GB download can resume. Served only when ON_DEVICE_MODEL_DIR is set,
// which `pnpm dev` does when a packed model is present; the browser checks
// every file against the pinned manifest digest, never trusting this route.
const TYPES: Record<string, string> = {
  ".json": "application/json",
  ".safetensors": "application/octet-stream",
  ".bin": "application/octet-stream",
};

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const root = process.env["ON_DEVICE_MODEL_DIR"];
  if (!root) return new Response(null, { status: 404 });
  // [GUARD] Only files inside the model directory, never a path out of it.
  const { path } = await context.params;
  // [SAFETY] Compare real paths: a symlink inside the directory must not lead
  // out of it.
  let base: string;
  let file: string;
  let size: number;
  try {
    base = realpathSync(resolve(root));
    file = realpathSync(resolve(base, ...path));
    const stat = statSync(file);
    if (!file.startsWith(base + sep) || !stat.isFile()) throw new Error();
    size = stat.size;
  } catch {
    return new Response(null, { status: 404 });
  }
  const headers = new Headers({
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  });
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (!range) {
    headers.set("Content-Length", String(size));
    return new Response(
      Readable.toWeb(createReadStream(file)) as ReadableStream,
      { headers },
    );
  }
  const start = Number(range[1]);
  const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(
    Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream,
    { status: 206, headers },
  );
}
