// A request body is untrusted input: it is counted while it streams, so an
// oversize body is refused before it is buffered whole or parsed, whatever
// content-length claims (or omits). Refusals carry no request content.
export type BoundedJson =
  | { ok: true; value: unknown }
  | { ok: false; reason: "too-large" | "invalid" };

export async function readBoundedJson(
  request: Request,
  limitBytes: number,
): Promise<BoundedJson> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > limitBytes) {
    await request.body?.cancel().catch(() => undefined);
    return { ok: false, reason: "too-large" };
  }
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: "invalid" };
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limitBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "too-large" };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
