import { describe, expect, it } from "vitest";
import { readBoundedJson } from "./bounded-json";

function post(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request("http://localhost/x", { method: "POST", body, headers });
}

describe("readBoundedJson", () => {
  it("parses a body within the limit", async () => {
    expect(await readBoundedJson(post('{"a":1}'), 100)).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it("refuses a body over the limit with no content-length at all", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":"'));
        controller.enqueue(new TextEncoder().encode("x".repeat(500)));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    });
    const request = new Request("http://localhost/x", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(request.headers.get("content-length")).toBeNull();
    expect(await readBoundedJson(request, 100)).toEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("refuses a body whose content-length understates its size", async () => {
    const result = await readBoundedJson(
      post(JSON.stringify({ a: "x".repeat(500) }), { "content-length": "5" }),
      100,
    );
    expect(result).toEqual({ ok: false, reason: "too-large" });
  });

  it("refuses an oversize declared length before reading", async () => {
    const result = await readBoundedJson(
      post("{}", { "content-length": "999999" }),
      100,
    );
    expect(result).toEqual({ ok: false, reason: "too-large" });
  });

  it("reports invalid JSON and a missing body without echoing content", async () => {
    expect(await readBoundedJson(post("{nope"), 100)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await readBoundedJson(post(null), 100)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
