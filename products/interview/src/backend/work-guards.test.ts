import { describe, expect, it, vi } from "vitest";
import { createInFlight, linkedAbort, ndjsonResponse } from "./work-guards";

describe("createInFlight", () => {
  it("lets one asker run a key at a time and frees it on release", () => {
    const flight = createInFlight();
    const release = flight.claim("a");
    expect(release).toBeTypeOf("function");
    expect(flight.claim("a")).toBeNull();
    expect(flight.claim("b")).toBeTypeOf("function");
    release?.();
    expect(flight.claim("a")).toBeTypeOf("function");
  });
});

describe("linkedAbort", () => {
  it("ends with the request", () => {
    const request = new AbortController();
    const { signal } = linkedAbort(request.signal);
    expect(signal.aborted).toBe(false);
    request.abort();
    expect(signal.aborted).toBe(true);
  });

  it("ends when the reader goes, leaving the request alone", () => {
    const request = new AbortController();
    const { signal, readerGone } = linkedAbort(request.signal);
    readerGone();
    expect(signal.aborted).toBe(true);
    expect(request.signal.aborted).toBe(false);
  });
});

describe("ndjsonResponse", () => {
  const lines = async (response: Response) =>
    (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

  it("sends one JSON line per event and closes when the work ends", async () => {
    const settled = vi.fn();
    const response = ndjsonResponse<{ t: string }>(
      async (send) => {
        send({ t: "a" });
        send({ t: "b" });
      },
      { onReaderGone: vi.fn(), onSettled: settled },
    );
    expect(response.headers.get("content-type")).toContain("x-ndjson");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await lines(response)).toEqual([{ t: "a" }, { t: "b" }]);
    expect(settled).toHaveBeenCalledOnce();
  });

  it("tells the work when the reader leaves, and stays quiet to it afterwards", async () => {
    const gone = vi.fn();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sendLate!: () => void;
    const response = ndjsonResponse<{ t: string }>(
      async (send) => {
        sendLate = () => send({ t: "late" });
        await hold;
      },
      { onReaderGone: gone },
    );
    await response.body?.cancel();
    expect(gone).toHaveBeenCalledOnce();
    // Sending to a gone reader must not throw.
    expect(sendLate).not.toThrow();
    release();
  });
});
