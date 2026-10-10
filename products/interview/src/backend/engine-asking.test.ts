import type {
  Failure,
  Prepared,
  PrepareResult,
  Resolved,
  ResolveResult,
} from "@omnitech/ai-engine";
import { describe, expect, it, vi } from "vitest";
import { INTERVIEW_PRODUCT_ID } from "../assistant-profile";
import { asking, valueOrThrow } from "./engine-asking";

const failed = (code: Failure["code"]) => ({
  ok: false as const,
  failure: { code, reason: "fixed refusal", retryable: false },
});
describe("engine asking", () => {
  it("sets the product and the two allowed permission levels without carrying unrelated scope fields", () => {
    const who = { tenantId: "tenant", actorId: "actor", productId: "another" };
    const signal = new AbortController().signal;
    const about = { kind: "candidacy", id: "id" };
    expect(asking(who, "read", signal)).toEqual({
      scope: {
        tenantId: "tenant",
        actorId: "actor",
        productId: INTERVIEW_PRODUCT_ID,
      },
      permissions: ["interview.read"],
      signal,
    });
    expect(asking(who, "write", signal, about)).toEqual({
      scope: {
        tenantId: "tenant",
        actorId: "actor",
        productId: INTERVIEW_PRODUCT_ID,
      },
      permissions: ["interview.read", "interview.documents.write"],
      signal,
      for: about,
    });
  });
});

describe("engine valueOrThrow", () => {
  const signal = new AbortController().signal;
  it("returns each engine payload shape without losing its type", () => {
    const refused = vi.fn((reason: string) => new Error(reason));
    const prepared = { records: [], links: [] } as unknown as Prepared;
    const resolved = { records: [] } as unknown as Resolved;
    const preparation: PrepareResult = { ok: true, prepared };
    const resolution: ResolveResult = { ok: true, resolved };
    expect(
      valueOrThrow({ ok: true, value: { answer: 42 } }, signal, refused),
    ).toEqual({ answer: 42 });
    expect(valueOrThrow(preparation, signal, refused)).toBe(prepared);
    expect(valueOrThrow(resolution, signal, refused)).toBe(resolved);
    expect(refused).not.toHaveBeenCalled();
  });
  it("throws the caller's domain exception with the engine's reason", () => {
    const error = new Error("safe domain message");
    const refused = vi.fn(() => error);
    expect(() => valueOrThrow(failed("unavailable"), signal, refused)).toThrow(
      error,
    );
    expect(refused).toHaveBeenCalledWith("fixed refusal");
  });
  it("turns cancellation into AbortError without constructing a domain refusal", () => {
    const refused = vi.fn((reason: string) => new Error(reason));
    expect(() => valueOrThrow(failed("cancelled"), signal, refused)).toThrow(
      expect.objectContaining({ name: "AbortError" }),
    );
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      valueOrThrow({ ok: true, value: "late" }, controller.signal, refused),
    ).toThrow(expect.objectContaining({ name: "AbortError" }));
    expect(() =>
      valueOrThrow(failed("unavailable"), controller.signal, refused),
    ).toThrow(expect.objectContaining({ name: "AbortError" }));
    expect(refused).not.toHaveBeenCalled();
  });
});
