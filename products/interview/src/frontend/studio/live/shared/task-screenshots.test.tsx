import type { LiveTaskScreenshotsResponse } from "@omnitech/interview-contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  imageAttachment,
  REVISION_REASON_LABEL,
  screenshotCountLabel,
  screenshotDisplayLabel,
  taskScreenshotItems,
  useTaskScreenshots,
} from "./task-screenshots";

const shot = (
  ordinal: number,
  artifactId: string | null,
  ocrEngine: "vision" | "tesseract" | null = null,
  display: { name: string; index: number; count: number } | null = null,
) => ({
  ordinal,
  sourceId: "s",
  eventId: `e${ordinal}`,
  sequence: ordinal,
  capturedAt: "2026-10-05T10:00:00.000Z",
  artifactId,
  ocrEngine,
  display,
  revisions: [1],
});
const response = (
  taskId: string,
  ...screenshots: ReturnType<typeof shot>[]
): LiveTaskScreenshotsResponse => ({ taskId, screenshots });

describe("taskScreenshotItems", () => {
  it("labels by the session's ordinal, builds the image url from the existing route, and says whether text was read", () => {
    const items = taskScreenshotItems(
      response("t", shot(3, "art-1", "vision"), shot(5, null)),
      (id) => `/img/${id}`,
    );
    expect(items).toEqual([
      expect.objectContaining({
        ordinal: 3,
        label: "S3",
        imageUrl: "/img/art-1",
        hasText: true,
        ocrEngine: "vision",
        revisions: [1],
      }),
      expect.objectContaining({
        label: "S5",
        artifactId: null,
        imageUrl: null,
        hasText: false,
      }),
    ]);
  });
});

describe("screenshotDisplayLabel", () => {
  it.each([
    [{ name: "Studio Display", index: 2, count: 3 }, "Display 2 of 3"],
    [
      { name: "Built-in Retina Display", index: 1, count: 1 },
      "Built-in Retina Display",
    ],
    [null, null],
  ])("%j -> %s", (display, label) => {
    expect(screenshotDisplayLabel({ display })).toBe(label);
  });

  it("carries the stored display onto each item, null when the server sent none", () => {
    const withDisplay = shot(1, "a", null, { name: "D", index: 1, count: 2 });
    const { display: _omitted, ...without } = shot(2, "b");
    const items = taskScreenshotItems(
      {
        taskId: "t",
        screenshots: [withDisplay, without as ReturnType<typeof shot>],
      },
      (id) => id,
    );
    expect(items.map((item) => item.display)).toEqual([
      { name: "D", index: 1, count: 2 },
      null,
    ]);
    expect(items.map(screenshotDisplayLabel)).toEqual(["Display 1 of 2", null]);
  });
});

describe("screenshotCountLabel", () => {
  it.each([
    [0, "No screenshots"],
    [1, "1 screenshot"],
    [4, "4 screenshots"],
  ])("%i -> %s", (count, label) => {
    expect(
      screenshotCountLabel(
        Array.from({ length: count }, (_, i) => ({ ordinal: i + 1 })),
      ),
    ).toBe(label);
  });
});

describe("reasons and attachment", () => {
  it("words the two owner-made reasons", () => {
    expect(REVISION_REASON_LABEL).toEqual({
      regenerate: "Regenerated",
      "added-screenshot": "Screenshot added",
    });
  });
  it("allows images except in a device-only session, with the reason", () => {
    expect(imageAttachment("permitted-remote")).toEqual({ allowed: true });
    expect(imageAttachment(null)).toEqual({ allowed: true });
    expect(imageAttachment("device-only")).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("Device-only"),
    });
  });
});

describe("useTaskScreenshots", () => {
  const clientOf = (
    list: (
      sessionId: string,
      taskId: string,
    ) => Promise<LiveTaskScreenshotsResponse>,
  ) => ({
    listTaskScreenshots: vi.fn(list),
    screenshotUrl: (sessionId: string, id: string) => `/s/${sessionId}/${id}`,
  });
  const base = {
    sessionId: "s-1",
    taskId: "task-a",
    version: "c1",
    processingPolicy: "permitted-remote" as const,
  };

  it("loads the task's screenshots, then again when the action cursor changes", async () => {
    const client = clientOf(async (_s, taskId) =>
      response(taskId, shot(1, "a1")),
    );
    const { result, rerender } = renderHook(
      (props) => useTaskScreenshots(props),
      {
        initialProps: { client, ...base },
      },
    );
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]?.imageUrl).toBe("/s/s-1/a1");
    expect(result.current.loading).toBe(false);
    expect(result.current.canAttachImages).toBe(true);
    client.listTaskScreenshots.mockResolvedValueOnce(
      response("task-a", shot(1, "a1"), shot(2, "a2")),
    );
    rerender({ client, ...base, version: "c2" });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(client.listTaskScreenshots).toHaveBeenCalledTimes(2);
    // Same version: no refetch.
    rerender({ client, ...base, version: "c2" });
    expect(client.listTaskScreenshots).toHaveBeenCalledTimes(2);
  });

  it("exposes each screenshot's stored display on the hook's items", async () => {
    const display = { name: "Studio Display", index: 2, count: 3 };
    const client = clientOf(async (_s, taskId) =>
      response(taskId, shot(1, "a1", null, display), shot(2, "a2")),
    );
    const { result } = renderHook((props) => useTaskScreenshots(props), {
      initialProps: { client, ...base },
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items.map(screenshotDisplayLabel)).toEqual([
      "Display 2 of 3",
      null,
    ]);
  });

  it("ignores a late answer for a task that has since changed, and never shows the previous task's items", async () => {
    const pending = new Map<string, (r: LiveTaskScreenshotsResponse) => void>();
    const client = clientOf(
      (_s, taskId) =>
        new Promise((resolve) => {
          pending.set(taskId, resolve);
        }),
    );
    const { result, rerender } = renderHook(
      (props) => useTaskScreenshots(props),
      {
        initialProps: { client, ...base },
      },
    );
    rerender({ client, ...base, taskId: "task-b" });
    await act(async () => {
      pending.get("task-b")?.(response("task-b", shot(2, "b1")));
    });
    await waitFor(() => expect(result.current.items[0]?.artifactId).toBe("b1"));
    // task-a answers late: dropped.
    await act(async () => {
      pending.get("task-a")?.(response("task-a", shot(1, "a1")));
    });
    expect(result.current.items.map((i) => i.artifactId)).toEqual(["b1"]);
    // Switching to a task with nothing loaded yet shows nothing, not task-b's.
    rerender({ client, ...base, taskId: "task-c" });
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(true);
  });

  it("ignores an answer after unmount", async () => {
    let resolve: (r: LiveTaskScreenshotsResponse) => void = () => undefined;
    const client = clientOf(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { unmount } = renderHook(() =>
      useTaskScreenshots({ client, ...base }),
    );
    unmount();
    await act(async () => resolve(response("task-a", shot(1, "a1"))));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("reports an error, and offers nothing for no task", async () => {
    const client = clientOf(async () => {
      throw new Error("no");
    });
    const { result } = renderHook(() =>
      useTaskScreenshots({ client, ...base }),
    );
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.loading).toBe(false);
    const none = renderHook(() =>
      useTaskScreenshots({ client, ...base, taskId: null }),
    );
    expect(none.result.current).toMatchObject({
      items: [],
      loading: false,
      error: false,
    });
  });

  it("disables adding in a device-only session and says why", async () => {
    const client = clientOf(async () => response("task-a"));
    const { result } = renderHook(() =>
      useTaskScreenshots({ client, ...base, processingPolicy: "device-only" }),
    );
    expect(result.current.canAttachImages).toBe(false);
    expect(result.current.attachDisabledReason).toContain("Device-only");
  });
});
