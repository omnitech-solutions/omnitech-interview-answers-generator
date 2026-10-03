import { describe, expect, it } from "vitest";
import { CompanionError } from "./errors.js";
import { FAKE_CREDENTIAL, fakeStudio } from "./fixture/fake-studio.js";
import { heartbeatMessage, screenSnapshotMessage } from "./messages.js";
import { createWireClient, type WireClientOptions } from "./wire-client.js";

const beat = heartbeatMessage({
  sourceId: "companion",
  sentAt: "2026-10-03T10:00:05Z",
  capturing: true,
});
const snapshot = (byteLength: number) =>
  screenSnapshotMessage({
    sourceId: "screen",
    eventId: "screen.snapshot.0",
    occurredAt: "2026-10-03T10:00:00.000Z",
    sequence: 0,
    content: {
      payloadRef: "screen.snapshot.0",
      mediaType: "image/png",
      byteLength,
      windowLabel: "Editor",
    },
  });

function client(overrides: Partial<WireClientOptions> = {}) {
  const studio = fakeStudio();
  return {
    studio,
    client: createWireClient({
      baseUrl: "https://studio.example.test",
      tenantSlug: "acme",
      credential: FAKE_CREDENTIAL,
      fetch: studio.fetch,
      ...overrides,
    }),
  };
}

describe("wire client", () => {
  it("posts JSON to the tenant ingest path with the bearer header only", async () => {
    const { client: c, studio } = client();
    const outcome = await c.send(beat);
    expect(outcome.kind).toBe("ack");
    const [request] = studio.requests;
    expect(request?.url).toBe(
      "https://studio.example.test/api/interview/t/acme/sessions/ingest",
    );
    expect(request?.headers).toEqual({
      Authorization: `Bearer ${FAKE_CREDENTIAL}`,
      "Content-Type": "application/json",
    });
    expect(request?.url).not.toContain(FAKE_CREDENTIAL);
    expect(request?.url).not.toContain("?");
  });

  it("keeps a path prefix on the base address", async () => {
    const { client: c, studio } = client({
      baseUrl: "https://studio.example.test/studio/",
    });
    await c.send(beat);
    expect(studio.requests[0]?.url).toBe(
      "https://studio.example.test/studio/api/interview/t/acme/sessions/ingest",
    );
  });

  it("sends a screenshot as multipart with envelope and payload parts", async () => {
    const { client: c, studio } = client();
    await c.send(snapshot(4), new Uint8Array([1, 2, 3, 4]));
    const [request] = studio.requests;
    expect(request?.message.kind).toBe("screen.snapshot");
    expect(request?.payloadBytes).toBe(4);
    // The multipart body carries no content-type: fetch supplies the boundary.
    expect(request?.headers).toEqual({
      Authorization: `Bearer ${FAKE_CREDENTIAL}`,
    });
  });

  it("refuses a screenshot whose payload does not match, and a stray payload", async () => {
    const { client: c, studio } = client();
    await expect(c.send(snapshot(4), new Uint8Array([1]))).rejects.toThrow(
      CompanionError,
    );
    await expect(c.send(snapshot(4))).rejects.toThrow(CompanionError);
    await expect(c.send(beat, new Uint8Array([1]))).rejects.toThrow(
      CompanionError,
    );
    expect(studio.requests).toEqual([]);
  });

  it("refuses an envelope over the byte limit", async () => {
    const { client: c } = client();
    const huge = { ...beat, sourceId: "a".repeat(40_000) };
    await expect(c.send(huge)).rejects.toThrow(CompanionError);
  });

  it("reports a network failure or a non-acknowledgement as unreachable", async () => {
    const { client: c, studio } = client();
    studio.down = true;
    expect(await c.send(beat)).toEqual({ kind: "unreachable" });
    studio.down = false;
    studio.script = () => "not-an-ack";
    expect(await c.send(beat)).toEqual({ kind: "unreachable" });
  });

  it("reads Retry-After seconds, capped, and ignores unusable values", async () => {
    const { client: c, studio } = client();
    const ack = {
      version: 1 as const,
      status: "refused" as const,
      code: "rate_limited" as const,
    };
    studio.script = () => ({ ack, retryAfter: "7" });
    expect(await c.send(beat)).toMatchObject({ retryAfterMs: 7000 });
    studio.script = () => ({ ack, retryAfter: "99999" });
    expect(await c.send(beat)).toMatchObject({ retryAfterMs: 300_000 });
    for (const bad of ["soon", "-1"]) {
      studio.script = () => ({ ack, retryAfter: bad });
      expect(await c.send(beat)).toEqual({ kind: "ack", ack });
    }
  });

  it("rejects a malformed credential without echoing it", () => {
    const secret = "not-a-credential-SECRET";
    try {
      createWireClient({
        baseUrl: "https://studio.example.test",
        tenantSlug: "acme",
        credential: secret,
        fetch: fakeStudio().fetch,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CompanionError);
      expect((error as CompanionError).code).toBe("credential_malformed");
      expect(String((error as Error).message)).not.toContain(secret);
    }
  });

  it("rejects an endpoint that could carry a credential, and a bad slug", () => {
    const base = {
      tenantSlug: "acme",
      credential: FAKE_CREDENTIAL,
      fetch: fakeStudio().fetch,
    };
    const codes = [
      "ftp://studio.example.test",
      "not a url",
      `https://user:${FAKE_CREDENTIAL}@studio.example.test`,
      `https://studio.example.test/?token=${FAKE_CREDENTIAL}`,
      "https://studio.example.test/#x",
    ].map((baseUrl) => {
      try {
        createWireClient({ ...base, baseUrl });
      } catch (error) {
        expect(String((error as Error).message)).not.toContain(FAKE_CREDENTIAL);
        return (error as CompanionError).code;
      }
      return "none";
    });
    expect(codes).toEqual(Array(5).fill("invalid_endpoint"));
    expect(() =>
      createWireClient({
        ...base,
        baseUrl: "https://studio.example.test",
        tenantSlug: "../x",
      }),
    ).toThrow(CompanionError);
  });
});
