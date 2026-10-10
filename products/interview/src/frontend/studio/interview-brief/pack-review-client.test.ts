// The context pack's client over a stubbed fetch: the review is read and
// checked against the contract, a preparation's lines are handed over as they
// come, and every way it can stop is a DocumentsApiError with its code.
import type { PackReview } from "@omnitech/interview-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentsApiError } from "../documents/documents-client";
import { packReviewClient } from "./pack-review-client";

const ID = "22222222-2222-4222-8222-222222222222";
const BASE = `/api/interview/documents/candidacies/${ID}/context-pack`;
const REVIEW: PackReview = {
  candidacyId: ID,
  prepared: true,
  recipe: { id: "application", version: "3" },
  current: true,
  profile: { id: "agent/claude-code", label: "Claude Code", onDevice: false },
  counts: [
    {
      kind: "employer-requirement",
      total: 2,
      extracted: 2,
      confirmed: 0,
      edited: 0,
    },
  ],
  links: [],
  records: [],
  rejected: [],
  holes: [],
  withheld: [],
  gaps: [],
  fit: { requirements: 2, strong: 1, partial: 0, gap: 1, refused: 0 },
  stages: [],
  sources: [],
};
const PROGRESS = {
  t: "progress",
  done: 1,
  total: 2,
  reading: ["The posting"],
  calls: 1,
} as const;

const lines = (...events: unknown[]) =>
  new Response(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`, {
    headers: { "content-type": "application/x-ndjson" },
  });
// Every request the client makes, answered by the test.
function answering(
  answer: (init: RequestInit) => Response | Promise<Response>,
) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      return Promise.resolve(answer(init));
    }),
  );
  return calls;
}
const refusedWith = async (work: Promise<unknown>) => {
  const failure = await work.then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(DocumentsApiError);
  return (failure as DocumentsApiError).code;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reading the review", () => {
  it("reads the application's pack and answers with the review", async () => {
    const calls = answering(() => Response.json(REVIEW));
    await expect(packReviewClient.read(ID)).resolves.toEqual(REVIEW);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(BASE);
    expect(calls[0]?.init.method ?? "GET").toBe("GET");
  });

  it("refuses an answer that is not a review", async () => {
    answering(() => Response.json({ candidacyId: ID, prepared: "yes" }));
    await expect(packReviewClient.read(ID)).rejects.toThrow();
  });

  it("a refusal carries its code", async () => {
    answering(() =>
      Response.json({ error: { code: "not-found" } }, { status: 404 }),
    );
    expect(await refusedWith(packReviewClient.read(ID))).toBe("not-found");
  });
});

describe("preparing", () => {
  it("posts what to read, hands each progress line over, and answers with the review", async () => {
    const calls = answering(() =>
      lines(PROGRESS, { ...PROGRESS, done: 2 }, { t: "done", review: REVIEW }),
    );
    const seen: unknown[] = [];
    const { signal } = new AbortController();
    await expect(
      packReviewClient.prepare(
        ID,
        { sourceId: "posting:1" },
        { signal, onProgress: (progress) => seen.push(progress) },
      ),
    ).resolves.toEqual(REVIEW);
    expect(seen).toEqual([PROGRESS, { ...PROGRESS, done: 2 }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/prepare`);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.signal).toBe(signal);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      sourceId: "posting:1",
    });
  });

  it("an error line refuses with its code, after the progress before it", async () => {
    answering(() => lines(PROGRESS, { t: "error", code: "generation-failed" }));
    const onProgress = vi.fn();
    expect(
      await refusedWith(
        packReviewClient.prepare(
          ID,
          {},
          { signal: new AbortController().signal, onProgress },
        ),
      ),
    ).toBe("generation-failed");
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["generation-unavailable", 503],
    ["already-running", 409],
    ["not-found", 404],
  ])(
    "a refusal before the stream starts (%s) refuses with its code",
    async (code, status) => {
      answering(() => Response.json({ error: { code } }, { status }));
      expect(
        await refusedWith(
          packReviewClient.prepare(
            ID,
            {},
            { signal: new AbortController().signal },
          ),
        ),
      ).toBe(code);
    },
  );

  it("a stream cut short of its last line is a server error", async () => {
    answering(() => lines(PROGRESS));
    expect(
      await refusedWith(
        packReviewClient.prepare(
          ID,
          {},
          { signal: new AbortController().signal },
        ),
      ),
    ).toBe("server-error");
  });

  it("a line the contract does not describe is refused", async () => {
    answering(() => lines({ t: "progress", done: "some" }));
    await expect(
      packReviewClient.prepare(
        ID,
        {},
        { signal: new AbortController().signal },
      ),
    ).rejects.toThrow();
  });

  it("stopping it answers as cancelled", async () => {
    const stop = new AbortController();
    answering(
      (init) =>
        new Promise<Response>((_resolve, reject) =>
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    );
    const work = packReviewClient.prepare(ID, {}, { signal: stop.signal });
    stop.abort();
    expect(await refusedWith(work)).toBe("cancelled");
  });
});

describe("correcting", () => {
  it("posts the corrections and answers with the review", async () => {
    const calls = answering(() => Response.json(REVIEW));
    await expect(
      packReviewClient.correct(ID, [
        { recordId: "rec-1", action: "confirm" },
        { recordId: "rec-2", action: "edit", text: "Six years" },
      ]),
    ).resolves.toEqual(REVIEW);
    expect(calls[0]?.url).toBe(`${BASE}/corrections`);
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      corrections: [
        { recordId: "rec-1", action: "confirm" },
        { recordId: "rec-2", action: "edit", text: "Six years" },
      ],
    });
  });

  it("a refusal carries its code", async () => {
    answering(() =>
      Response.json({ error: { code: "invalid-request" } }, { status: 400 }),
    );
    expect(
      await refusedWith(
        packReviewClient.correct(ID, [{ recordId: "x", action: "remove" }]),
      ),
    ).toBe("invalid-request");
  });
});
