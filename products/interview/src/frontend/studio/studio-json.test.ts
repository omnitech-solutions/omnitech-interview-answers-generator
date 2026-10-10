import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioRequestError, studioJson } from "./studio-json";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});
describe("studioJson", () => {
  it("sets JSON and tenant headers, sends the body, and returns typed data", async () => {
    window.history.replaceState({}, "", "/t/my%20tenant/p/interview");
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: "made" }));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    await expect(
      studioJson<{ id: string }>("/api/example", {
        method: "POST",
        body: { title: "sample" },
        signal,
      }),
    ).resolves.toEqual({ id: "made" });
    const [path, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/example");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"title":"sample"}');
    expect(init.signal).toBe(signal);
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(new Headers(init.headers).get("x-omnitech-tenant")).toBe(
      "my tenant",
    );
  });

  it("does not add a body or JSON header to a GET", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json([1]));
    vi.stubGlobal("fetch", fetch);
    await expect(studioJson("/api/example")).resolves.toEqual([1]);
    expect(fetch).toHaveBeenCalledWith("/api/example", {});
  });

  it("preserves the server code, payload and status on a conflict", async () => {
    const payload = { error: { code: "revision-conflict" }, revision: 2 };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(payload, { status: 409 })),
    );
    await expect(studioJson("/api/example")).rejects.toMatchObject({
      name: "StudioRequestError",
      status: 409,
      code: "revision-conflict",
      payload,
    });
  });

  it("preserves a workspace refusal's top-level code", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ code: "stale-revision" }, { status: 409 }),
        ),
    );
    await expect(studioJson("/api/example")).rejects.toMatchObject({
      status: 409,
      code: "stale-revision",
    });
  });

  it.each([400, 502])(
    "keeps the HTTP status for non-JSON errors (%s)",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response("<html>unavailable</html>", { status }),
          ),
      );
      await expect(studioJson("/api/example")).rejects.toMatchObject({
        status,
        code: status >= 500 ? "server-error" : "request-failed",
        payload: null,
      });
    },
  );

  it("does not trust a non-string server code", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { code: 42 } }, { status: 400 }),
        ),
    );
    await expect(studioJson("/api/example")).rejects.toBeInstanceOf(
      StudioRequestError,
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { code: 42 } }, { status: 400 }),
        ),
    );
    await expect(studioJson("/api/example")).rejects.toMatchObject({
      code: "request-failed",
    });
  });

  it("accepts JSON null and 204, but refuses malformed successful JSON", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(null))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("invalid"));
    vi.stubGlobal("fetch", fetch);
    await expect(studioJson("/null")).resolves.toBeNull();
    await expect(
      studioJson<void>("/deleted", { method: "DELETE" }),
    ).resolves.toBeUndefined();
    await expect(studioJson("/invalid")).rejects.toBeInstanceOf(SyntaxError);
  });

  it("passes network cancellation through unchanged", async () => {
    const error = new DOMException("cancelled", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    await expect(
      studioJson("/api/example", { signal: new AbortController().signal }),
    ).rejects.toBe(error);
  });
});
