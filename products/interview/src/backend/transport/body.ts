// Every body format uses the same streamed byte bound before decoding.
export class BodyRefused extends Error {
  constructor(readonly code: "body-too-large" | "invalid-request") {
    super(code);
    this.name = "BodyRefused";
  }
}

export async function readBytes(
  request: Request,
  limitBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 0)
    throw new RangeError("Body limit must be a non-negative safe integer.");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > limitBytes) {
    await request.body?.cancel().catch(() => undefined);
    throw new BodyRefused("body-too-large");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new BodyRefused("invalid-request");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Refuse before retaining this chunk, even if the header lied.
      if (value.byteLength > limitBytes - length) {
        await reader.cancel().catch(() => undefined);
        throw new BodyRefused("body-too-large");
      }
      length += value.byteLength;
      // Copy: a stream may reuse its backing buffer on its next read.
      if (value.byteLength > 0) chunks.push(value.slice());
    }
    return Buffer.concat(chunks, length);
  } catch (error) {
    if (error instanceof BodyRefused) throw error;
    await reader.cancel().catch(() => undefined);
    throw new BodyRefused("invalid-request");
  } finally {
    reader.releaseLock();
  }
}

export async function readJson(
  request: Request,
  limitBytes: number,
): Promise<unknown> {
  const bytes = await readBytes(request, limitBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BodyRefused("invalid-request");
  }
}

export async function readUpload(
  request: Request,
  limitBytes: number,
  field: string,
): Promise<{ file: File; form: FormData }> {
  const bytes = await readBytes(request, limitBytes);
  try {
    const form = await new Response(new Uint8Array(bytes), {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
    const file = form.get(field);
    // Native multipart parsing produces a File; do not accept a text field.
    if (!file || typeof file === "string")
      throw new BodyRefused("invalid-request");
    return { file, form };
  } catch {
    throw new BodyRefused("invalid-request");
  }
}
