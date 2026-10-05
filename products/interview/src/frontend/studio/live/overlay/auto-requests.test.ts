// The real request builders of Auto's two posts (a capture and a heard phrase),
// run through the SAME zod schemas the server parses them with, so an
// invalid_input from a shape mismatch is caught here, not in the installed app.
import {
  liveHeardRequestSchema,
  liveOwnerCaptureRequestSchema,
  liveOwnerInputRequestSchema,
} from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { fitFrame } from "../host-adapter";
import { ownerInputDeps } from "../session-owner-input";
import type { LiveSnapshot } from "../session-snapshot";
import { failureNote } from "./overlay-footer";
import { AUTO_CAPTURE_LABEL } from "./use-hands-free";

const SESSION = "1c2d3e4f-0000-4000-8000-000000000001";
const sent: { url: string; init?: RequestInit | undefined }[] = [];
const fetcher = async (url: string, init?: RequestInit) => {
  sent.push({ url, init });
  return new Response(
    JSON.stringify({
      input: { requestId: "r", sequence: 1 },
      snapshot: { sourceId: "s", eventId: "e" },
    }),
    { status: 202, headers: { "content-type": "application/json" } },
  );
};
const deps = () =>
  ownerInputDeps(
    "acme",
    fetcher,
    () => ({ actions: [], observations: [] }) as unknown as LiveSnapshot,
  );

// What the server route does with the multipart text fields.
function fieldsOf(form: FormData): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [name, value] of form.entries()) {
    if (name === "image" || typeof value !== "string" || value === "") continue;
    fields[name] =
      name === "targetRevision" && /^[0-9]{1,7}$/.test(value)
        ? Number(value)
        : value;
  }
  return fields;
}

describe("Auto's requests satisfy the server schemas", () => {
  it("an automatic capture, with the 'auto' hints, a target and its label", async () => {
    sent.length = 0;
    await deps().analyzeCapture?.(SESSION, {
      image: new Blob([new Uint8Array([255, 216, 255])], {
        type: "image/jpeg",
      }),
      label: AUTO_CAPTURE_LABEL,
      target: { taskId: "T1", revision: 2 },
      skill: "auto",
      language: "auto",
    });
    const form = sent[0]?.init?.body as FormData;
    expect(
      liveOwnerCaptureRequestSchema.safeParse(fieldsOf(form)).success,
    ).toBe(true);
    // Without a target or hints, too.
    sent.length = 0;
    await deps().analyzeCapture?.(SESSION, {
      image: new Blob([new Uint8Array([1])]),
      label: AUTO_CAPTURE_LABEL,
    });
    expect(
      liveOwnerCaptureRequestSchema.safeParse(
        fieldsOf(sent[0]?.init?.body as FormData),
      ).success,
    ).toBe(true);
  });

  it("a heard phrase, the longest one Auto coalesces, with its 'h-' id", async () => {
    for (const text of [
      "you have any questions at all about what I've discussed so far before I continue?",
      "x".repeat(900),
    ]) {
      sent.length = 0;
      await deps().submitHeard?.(SESSION, text, `h-${crypto.randomUUID()}`);
      const body = JSON.parse(String(sent[0]?.init?.body));
      expect(liveHeardRequestSchema.safeParse(body).success).toBe(true);
      // Never the typed follow-up shape, and no hints or target.
      expect(liveOwnerInputRequestSchema.safeParse(body).success).toBe(false);
    }
  });

  it("a typed follow-up", async () => {
    sent.length = 0;
    await deps().submitFollowUp?.(SESSION, "why O(n)?", null, {
      skill: "auto",
      language: "auto",
    });
    expect(
      liveOwnerInputRequestSchema.safeParse(
        JSON.parse(String(sent[0]?.init?.body)),
      ).success,
    ).toBe(true);
  });
});

describe("a failed Auto request is said plainly, with its code", () => {
  it("names the code and that the session is unchanged", () => {
    expect(failureNote("invalid_input")).toMatch(/invalid_input/);
    expect(failureNote("invalid_input")).toMatch(/session is unchanged/);
    expect(failureNote("not_found")).toMatch(/not_found.*unchanged/);
  });
});

describe("fitFrame", () => {
  it("leaves an acceptable image alone", async () => {
    const small = new Blob([new Uint8Array(10)], { type: "image/jpeg" });
    expect(await fitFrame(small)).toBe(small);
  });
  it("returns the original when it cannot be decoded here", async () => {
    const big = new Blob([new Uint8Array(2_500_000)], { type: "image/jpeg" });
    expect(await fitFrame(big)).toBe(big);
  });
});
