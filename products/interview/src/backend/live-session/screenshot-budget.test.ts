// The text of screenshots is budgeted in UTF-8 bytes against the 48 KB prompt
// window (never in characters): a long CJK or Cyrillic screen is dropped
// newest-first, never refused, and its image still travels.
import type { LiveOcrBlock } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { createAssistStage, MAX_PROMPT_BYTES } from "./assist-stage";
import { buildContextSnapshot } from "./context-snapshot";
import { OCR_PROMPT_MAX_BYTES, ocrPromptBytes } from "./screenshot-text";
import { planAssist } from "./service";
import { createRun, screenshotTextFor } from "./session-run";

const attachment = (id: string) => ({
  id,
  kind: "image" as const,
  name: id,
  reference: id,
});
const ocr = (text: string) => ({ text }) as LiveOcrBlock;
const runWith = (texts: Record<string, string>) => {
  const run = createRun(
    { tenantId: "t", ownerUserId: "u", sessionId: "s", fence: 1 } as never,
    "w",
    () => undefined,
  );
  Object.entries(texts).forEach(([id, text], index) => {
    run.snapshots.set(id, {
      mediaType: "image/png",
      ordinal: index + 1,
      ocr: ocr(text),
    });
  });
  run.context = {
    snapshot: buildContextSnapshot({ matrix: null, profile: null }),
    matrix: null,
  };
  return run;
};

describe("screenshotTextFor budgets bytes, not characters", () => {
  it("keeps an ASCII text of the byte limit's length and leaves out one byte more", () => {
    const fits = "a".repeat(OCR_PROMPT_MAX_BYTES - 2);
    const over = "a".repeat(OCR_PROMPT_MAX_BYTES - 1);
    expect(ocrPromptBytes(fits)).toBe(OCR_PROMPT_MAX_BYTES);
    expect(
      screenshotTextFor(runWith({ a: fits }), [attachment("a")]),
    ).toHaveLength(1);
    expect(
      screenshotTextFor(runWith({ a: over }), [attachment("a")]),
    ).toHaveLength(0);
  });

  it("leaves out a 15,000-character CJK text (about 45 KB) and a long Cyrillic one", () => {
    const cjk = "漢".repeat(15_000);
    const cyrillic = "я".repeat(20_000);
    expect(cjk.length).toBeLessThan(OCR_PROMPT_MAX_BYTES);
    expect(
      screenshotTextFor(runWith({ a: cjk }), [attachment("a")]),
    ).toHaveLength(0);
    expect(
      screenshotTextFor(runWith({ a: cyrillic }), [attachment("a")]),
    ).toHaveLength(0);
  });

  it("keeps the newest texts first when they do not all fit", () => {
    const big = "漢".repeat(3_000);
    const run = runWith({ a: big, b: big, c: big });
    const kept = screenshotTextFor(run, [
      attachment("a"),
      attachment("b"),
      attachment("c"),
    ]);
    expect(kept.map((entry) => entry.label)).toEqual(["S2", "S3"]);
  });
});

describe("planAssist drops screenshot texts newest-first before refusing", () => {
  const stage = createAssistStage();
  const task = {
    taskId: "task-1",
    taskKey: "k",
    revision: 1,
    revisions: [{ revision: 1, basedOn: [] }],
  } as never;
  const store = { loadContext: async () => null } as never;
  const entry = (label: string, text: string, image: string | null) => ({
    label,
    text,
    image,
    cutOff: false,
  });

  it("answers with the image and without the text that overran the window", async () => {
    // Each text fits the byte budget alone yet the two overrun the prompt.
    const plan = await planAssist(runWith({}), task, {
      store,
      stage,
      deviceOnly: false,
      imageCount: 2,
      screenshotText: [
        entry("S1", "a".repeat(23_000), "screenshot-1"),
        entry("S2", "b".repeat(23_000), "screenshot-2"),
      ],
    });
    expect(plan.outcome).toBe("ready");
    if (plan.outcome !== "ready") return;
    expect(plan.prompt.byteCount).toBeLessThanOrEqual(MAX_PROMPT_BYTES);
    expect(plan.prompt.prompt).toContain("aaaa");
    expect(plan.prompt.prompt).not.toContain("bbbb");
  });

  it("reports a dropped text-only screenshot as withheld, never silently missing", async () => {
    const plan = await planAssist(runWith({}), task, {
      store,
      stage,
      deviceOnly: false,
      imageCount: 0,
      screenshotText: [
        entry("S1", "a".repeat(23_000), null),
        entry("S2", "b".repeat(23_000), null),
      ],
    });
    expect(plan.outcome).toBe("ready");
    if (plan.outcome !== "ready") return;
    expect(plan.prompt.prompt).not.toContain("bbbb");
    expect(plan.prompt.prompt).toContain(
      "Screenshot S2 image withheld by the owner's setting; no on-screen text",
    );
  });
});
