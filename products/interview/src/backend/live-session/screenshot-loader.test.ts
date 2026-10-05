// The screenshot loader's verification without a database: observation ids
// only, an owner's active session, media type re-detected from the bytes, the
// stored digest, and byte and header-parsed dimension caps (ADR-0016).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  loadVerifiedScreenshot,
  readImageSize,
  SCREENSHOT_LOAD_LIMITS,
  ScreenshotLoadError,
  type SnapshotRead,
  type StoredSnapshot,
} from "./screenshot-loader";

const SESSION = "11111111-1111-4111-8111-111111111111";
const REF = `snap/${SESSION}/screen/shot-1`;
const owner = { tenantId: "t", userId: "u" };

function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.alloc(14)]);
  const sof = Buffer.from([
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    0x03,
    ...Buffer.alloc(9),
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}
function webp(kind: "VP8X" | "VP8L" | "VP8 ", width: number, height: number) {
  const body = Buffer.alloc(30);
  body.write("RIFF", 0);
  body.write("WEBP", 8);
  body.write(kind, 12);
  if (kind === "VP8X") {
    body.writeUIntLE(width - 1, 24, 3);
    body.writeUIntLE(height - 1, 27, 3);
  } else if (kind === "VP8L") {
    body[20] = 0x2f;
    body.writeUInt32LE(((height - 1) << 14) | (width - 1), 21);
  } else {
    body[23] = 0x9d;
    body[24] = 0x01;
    body[25] = 0x2a;
    body.writeUInt16LE(width, 26);
    body.writeUInt16LE(height, 28);
  }
  return body;
}

describe("readImageSize", () => {
  it("reads PNG, JPEG and every WebP encoding from the header alone", () => {
    expect(readImageSize(png(640, 480), "image/png")).toEqual({
      width: 640,
      height: 480,
    });
    expect(readImageSize(jpeg(800, 600), "image/jpeg")).toEqual({
      width: 800,
      height: 600,
    });
    expect(readImageSize(webp("VP8X", 1024, 768), "image/webp")).toEqual({
      width: 1024,
      height: 768,
    });
    expect(readImageSize(webp("VP8L", 300, 200), "image/webp")).toEqual({
      width: 300,
      height: 200,
    });
    expect(readImageSize(webp("VP8 ", 320, 240), "image/webp")).toEqual({
      width: 320,
      height: 240,
    });
  });

  it("refuses a truncated or malformed header", () => {
    expect(readImageSize(png(1, 1).subarray(0, 20), "image/png")).toBeNull();
    expect(
      readImageSize(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2]), "image/jpeg"),
    ).toBeNull();
    expect(readImageSize(Buffer.alloc(10), "image/webp")).toBeNull();
  });
});

const stored = (
  bytes: Buffer,
  over: Partial<StoredSnapshot> = {},
): StoredSnapshot => ({
  bytes,
  artifactMediaType: "image/png",
  observationMediaType: "image/png",
  artifactSha256: createHash("sha256").update(bytes).digest("hex"),
  ...over,
});
const readOf =
  (found: StoredSnapshot | "session_closed" | null): SnapshotRead =>
  async () =>
    found;
const attachment = (reference = REF) => ({
  kind: "image" as const,
  id: reference,
  reference,
});
const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as ScreenshotLoadError).code;
  }
  return "loaded";
};

describe("loadVerifiedScreenshot", () => {
  const good = png(1280, 720);
  const load = (
    found: StoredSnapshot | "session_closed" | null,
    reference = REF,
    signal?: AbortSignal,
  ) =>
    loadVerifiedScreenshot(readOf(found), owner, attachment(reference), signal);

  it("returns the bytes ingest stored once every check passes", async () => {
    expect(Buffer.from(await load(stored(good))).equals(good)).toBe(true);
  });

  it("passes the owner scope and the parsed ids to the read, nothing else", async () => {
    const seen: unknown[] = [];
    await loadVerifiedScreenshot(
      async (who, ref) => {
        seen.push(who, ref);
        return stored(good);
      },
      owner,
      attachment(),
      undefined,
    );
    expect(seen).toEqual([
      { tenantId: "t", actorId: "u" },
      { sessionId: SESSION, sourceId: "screen", eventId: "shot-1" },
    ]);
  });

  it("refuses anything that is not a well-formed observation reference", async () => {
    for (const reference of [
      "/etc/passwd",
      "../../x.png",
      "snap/not-a-uuid/screen/e",
      `snap/${SESSION}/screen`,
      `snap/${SESSION}/screen/e/extra`,
      `input/${SESSION}`,
    ])
      expect(await codeOf(load(stored(good), reference))).toBe("bad_reference");
    // A file is not an image attachment, and the id must be the reference.
    expect(
      await codeOf(
        loadVerifiedScreenshot(
          readOf(stored(good)),
          owner,
          { kind: "file", id: REF, reference: REF },
          undefined,
        ),
      ),
    ).toBe("bad_reference");
    expect(
      await codeOf(
        loadVerifiedScreenshot(
          readOf(stored(good)),
          owner,
          { kind: "image", id: "other", reference: REF },
          undefined,
        ),
      ),
    ).toBe("bad_reference");
  });

  it("refuses a snapshot that is not the owner's, or whose session is closed", async () => {
    expect(await codeOf(load(null))).toBe("not_found");
    expect(await codeOf(load("session_closed"))).toBe("session_closed");
  });

  it("types a failed read as retryable, without carrying the store's error", async () => {
    const failing: SnapshotRead = async () => {
      throw new Error("SELECT secret FROM interview.session_observations");
    };
    const error = await loadVerifiedScreenshot(
      failing,
      owner,
      attachment(),
      undefined,
    ).catch((caught: ScreenshotLoadError) => caught);
    expect((error as ScreenshotLoadError).code).toBe("read_failed");
    expect((error as Error).message).not.toContain("SELECT");
    // A read that throws before returning a promise is the same typed failure.
    const sync = (() => {
      throw new Error("sync failure");
    }) as unknown as SnapshotRead;
    const syncError = await loadVerifiedScreenshot(
      sync,
      owner,
      attachment(),
      undefined,
    ).catch((caught: ScreenshotLoadError) => caught);
    expect((syncError as ScreenshotLoadError).code).toBe("read_failed");
  });

  it("refuses a media type the bytes do not bear out", async () => {
    // SVG and HTML are never images, whatever the labels say.
    const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect(await codeOf(load(stored(svg)))).toBe("media_type_mismatch");
    // A JPEG labelled PNG, or an observation that declared something else.
    expect(
      await codeOf(
        load(stored(jpeg(10, 10), { artifactSha256: undefined as never })),
      ),
    ).toBe("media_type_mismatch");
    expect(
      await codeOf(load(stored(good, { observationMediaType: "image/jpeg" }))),
    ).toBe("media_type_mismatch");
    expect(await codeOf(load(stored(good, { artifactMediaType: null })))).toBe(
      "media_type_mismatch",
    );
  });

  it("refuses bytes that are not the bytes ingest digested", async () => {
    expect(
      await codeOf(load(stored(good, { artifactSha256: "a".repeat(64) }))),
    ).toBe("digest_mismatch");
    expect(await codeOf(load(stored(good, { artifactSha256: null })))).toBe(
      "digest_mismatch",
    );
  });

  it("caps bytes and header-parsed dimensions without decoding", async () => {
    const big = Buffer.concat([
      png(10, 10),
      Buffer.alloc(SCREENSHOT_LOAD_LIMITS.maxBytes),
    ]);
    expect(await codeOf(load(stored(big)))).toBe("too_large");
    expect(await codeOf(load(stored(Buffer.alloc(0))))).toBe("too_large");
    expect(await codeOf(load(stored(png(9_000, 100))))).toBe("bad_dimensions");
    expect(await codeOf(load(stored(png(8_000, 8_000))))).toBe(
      "bad_dimensions",
    );
    expect(await codeOf(load(stored(png(0, 100))))).toBe("bad_dimensions");
    // A truncated header has no readable size.
    expect(await codeOf(load(stored(good.subarray(0, 14))))).toBe(
      "bad_dimensions",
    );
  });

  it("stops at once when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await codeOf(load(stored(good), REF, controller.signal))).toBe(
      "aborted",
    );
  });

  it("errors carry a fixed message and never the reference or any byte", async () => {
    try {
      await load(null);
    } catch (error) {
      expect((error as Error).message).not.toContain("shot-1");
      expect((error as Error).message).not.toContain(SESSION);
    }
  });
});
