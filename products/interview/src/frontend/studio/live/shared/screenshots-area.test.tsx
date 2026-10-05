// The Screenshots icon and area, both variants, from one harness that wires the
// real tray hook and the pure view builders (no network): strip and badge, the
// Manual tray open by default and the Auto one closed, staging, crop, reorder,
// Apply once, Discard, the viewer, and every honest state.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ScreenshotsArea,
  ScreenshotsToggle,
  type ScreenshotsVariant,
  useAreaId,
} from "./screenshots-area";
import type { TaskScreenshotItem } from "./task-screenshots";
import type { RecognitionResult, TextRecognizer } from "./text-recognizer";
import { useScreenshotTray } from "./use-screenshot-tray";
import {
  type ScreenshotsView,
  stagedShotViews,
  storedShotViews,
  useObjectUrls,
} from "./use-screenshots-view";

const cropMock = vi.hoisted(() => ({
  cropBlob: vi.fn(),
}));
vi.mock("./screenshot-crop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./screenshot-crop")>()),
  cropBlob: cropMock.cropBlob,
}));

const stored = (n: number, over: Partial<TaskScreenshotItem> = {}) =>
  ({
    ordinal: n,
    label: `S${n}`,
    capturedAt: "2026-10-05T10:00:00.000Z",
    artifactId: `a${n}`,
    revisions: [1],
    imageUrl: `/img/a${n}`,
    hasText: true,
    ocrEngine: "vision",
    display: null,
    ...over,
  }) satisfies TaskScreenshotItem;

const text = (value: string): RecognitionResult => ({
  ok: true,
  engine: "vision",
  text: value,
  confidence: 0.9,
  truncated: false,
});
function fakeRecognizer() {
  const reads: Blob[] = [];
  const recognizer: TextRecognizer = {
    engine: "vision",
    available: true,
    recognize: async (blob) => {
      reads.push(blob);
      return text("some text");
    },
  };
  return { recognizer, reads };
}

type Props = {
  variant: ScreenshotsVariant;
  mode: "auto" | "manual";
  storedItems?: TaskScreenshotItem[];
  deviceOnly?: boolean;
  hasTarget?: boolean;
  applyContext?: ReturnType<typeof vi.fn>;
  recognizer: TextRecognizer;
  frames?: { blob: Blob; label: string }[];
  unavailable?: string | null;
};
const applyOk = () =>
  vi.fn(async (_target: unknown, _input: unknown) => ({ ok: true }));
const BLOB = (name: string) => new Blob([name], { type: "image/png" });

function Harness(props: Props) {
  const frames = useRefOnce(
    props.frames ?? [{ blob: BLOB("f1"), label: "This Mac" }],
  );
  const tray = useScreenshotTray({
    actions: {
      applyContext: props.applyContext ?? applyOk(),
    } as never,
    sessionId: "s1",
    target: props.hasTarget === false ? null : { taskId: "t1", revision: 1 },
    deviceOnly: props.deviceOnly ?? false,
    hints: {},
    mode: props.mode,
    recognizer: props.recognizer,
  });
  const storedViews = storedShotViews(props.storedItems ?? []);
  const blobs = tray.items.map((item) => item.blob);
  const urlOf = useObjectUrls(blobs);
  const view: ScreenshotsView = {
    tray,
    taskLabel: "T1",
    stored: storedViews,
    staged: stagedShotViews(tray.items, tray.recognition.states, urlOf),
    loading: false,
    error: false,
    count: storedViews.length + tray.items.length,
  };
  const id = useAreaId();
  return (
    <div>
      <ScreenshotsToggle view={view} variant={props.variant} controls={id} />
      <ScreenshotsArea
        view={view}
        id={id}
        variant={props.variant}
        captureUnavailable={props.unavailable ?? null}
        onAdd={(intent) => {
          const next = frames.current.shift();
          if (next) tray.stage({ ...next, display: null }, intent);
        }}
      />
    </div>
  );
}

import { useRef } from "react";

function useRefOnce<T>(value: T) {
  return useRef(value);
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
const mount = async (
  props: Partial<Props> & { variant: ScreenshotsVariant },
) => {
  const { recognizer, reads } = fakeRecognizer();
  const result = render(
    <Harness
      mode="manual"
      recognizer={props.recognizer ?? recognizer}
      {...props}
    />,
  );
  await flush();
  return { ...result, reads };
};
const add = async () => {
  fireEvent.click(screen.getByTestId("add-screenshot"));
  await flush();
};

beforeEach(() => {
  let n = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:staged-${(n += 1)}`),
      revokeObjectURL: vi.fn(),
    }),
  );
  cropMock.cropBlob.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each(["native", "web"] as const)("%s", (variant) => {
  describe("the icon", () => {
    it("is named Screenshots (n) with the count, and toggles the area", async () => {
      await mount({
        variant,
        mode: "auto",
        storedItems: [stored(1), stored(2)],
      });
      const toggle = screen.getByRole("button", { name: "Screenshots (2)" });
      expect(toggle).toHaveTextContent("2");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByTestId("screenshots-area")).toBeNull();
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle).toHaveAttribute(
        "aria-controls",
        screen.getByTestId("screenshots-area").id,
      );
      fireEvent.click(toggle);
      expect(screen.queryByTestId("screenshots-area")).toBeNull();
    });

    it("counts what is staged too", async () => {
      await mount({ variant, mode: "manual", storedItems: [stored(1)] });
      await add();
      expect(
        screen.getByRole("button", { name: "Screenshots (2)" }),
      ).toBeVisible();
    });
  });

  describe("the strip (Auto)", () => {
    it("is minimised and closed by default, then shows S-label, time, display and revisions", async () => {
      await mount({
        variant,
        mode: "auto",
        storedItems: [
          stored(3, {
            display: { name: "Studio", index: 2, count: 3 },
            revisions: [1, 2],
          }),
          stored(4),
        ],
      });
      expect(screen.queryByTestId("screenshot-strip")).toBeNull();
      fireEvent.click(screen.getByTestId("screenshots-toggle"));
      const strip = screen.getByTestId("screenshot-strip");
      const first = within(strip).getAllByRole("listitem")[0] as HTMLElement;
      expect(first).toHaveTextContent("S3");
      expect(first).toHaveTextContent("Display 2 of 3");
      expect(first).toHaveTextContent("revs 1, 2");
      expect(within(strip).getAllByRole("listitem")).toHaveLength(2);
      expect(strip).toHaveAttribute("tabindex", "0");
    });

    it("scrolls horizontally with arrows and the keyboard once there are many thumbnails", async () => {
      await mount({
        variant,
        mode: "auto",
        storedItems: [1, 2, 3, 4, 5, 6].map((n) => stored(n)),
      });
      fireEvent.click(screen.getByTestId("screenshots-toggle"));
      const strip = screen.getByTestId("screenshot-strip");
      const scrollBy = vi.fn();
      strip.scrollBy = scrollBy;
      fireEvent.click(
        screen.getByRole("button", { name: "Scroll screenshots right" }),
      );
      expect(scrollBy).toHaveBeenLastCalledWith(
        expect.objectContaining({ left: expect.any(Number) }),
      );
      expect(scrollBy.mock.calls[0]?.[0].left).toBeGreaterThan(0);
      fireEvent.keyDown(strip, { key: "ArrowLeft" });
      expect(scrollBy.mock.calls[1]?.[0].left).toBeLessThan(0);
    });

    it("has no arrows for a short strip", async () => {
      await mount({ variant, mode: "auto", storedItems: [stored(1)] });
      fireEvent.click(screen.getByTestId("screenshots-toggle"));
      expect(
        screen.queryByRole("button", { name: /Scroll screenshots/ }),
      ).toBeNull();
    });

    it("opens the tray on its own once something is staged", async () => {
      await mount({ variant, mode: "auto" });
      fireEvent.click(screen.getByTestId("screenshots-toggle"));
      await add();
      expect(screen.getByTestId("staged-1")).toBeVisible();
    });
  });

  describe("the tray (Manual)", () => {
    it("is expanded by default, says what Apply does with nothing staged and offers a plain regenerate for the task", async () => {
      await mount({ variant, mode: "manual" });
      expect(screen.getByTestId("screenshots-area")).toHaveAttribute(
        "data-mode",
        "manual",
      );
      expect(screen.getByTestId("tray-sends")).toHaveTextContent(
        "Apply regenerates without new context",
      );
      expect(screen.getByTestId("apply-screenshots")).toBeEnabled();
      expect(screen.queryByTestId("discard-screenshots")).toBeNull();
    });

    it("with no task there is nothing to apply until an image is staged", async () => {
      await mount({ variant, mode: "manual", hasTarget: false });
      expect(screen.queryByTestId("apply-screenshots")).toBeNull();
      await add();
      expect(screen.getByTestId("apply-screenshots")).toBeEnabled();
    });

    it("stages on the device: 'Not sent yet', the privacy line and the text state", async () => {
      await mount({ variant, mode: "manual" });
      await add();
      expect(screen.getByTestId("staged-1")).toHaveTextContent("Not sent yet");
      expect(screen.getByTestId("tray-sends")).toHaveTextContent(
        "Sends 1 screenshot and the text read from it.",
      );
      expect(screen.getByTestId("ocr-1")).toHaveTextContent(
        "Text read on the device",
      );
    });

    it("says reading while the text is read, and that an unreadable image is still sent", async () => {
      const unavailable: TextRecognizer = {
        engine: null,
        available: false,
        recognize: async () => ({ ok: false, reason: "unavailable" }),
      };
      await mount({ variant, mode: "manual", recognizer: unavailable });
      await add();
      expect(screen.getByTestId("ocr-1")).toHaveTextContent(
        "the image is still sent",
      );
    });

    it("lets the person remove one", async () => {
      await mount({
        variant,
        mode: "manual",
        frames: [
          { blob: BLOB("1"), label: "A" },
          { blob: BLOB("2"), label: "B" },
        ],
      });
      await add();
      await add();
      expect(screen.getAllByTestId(/^staged-/)).toHaveLength(2);
      fireEvent.click(screen.getByRole("button", { name: "Remove New 1" }));
      expect(screen.getAllByTestId(/^staged-/)).toHaveLength(1);
    });

    it("reorders with the buttons, and the order is what Apply sends", async () => {
      const applyContext = applyOk();
      const blobs = [BLOB("one"), BLOB("two"), BLOB("three")];
      await mount({
        variant,
        mode: "manual",
        applyContext,
        frames: blobs.map((blob) => ({ blob, label: "x" })),
      });
      await add();
      await add();
      await add();
      expect(
        screen.getByRole("button", { name: "Move New 1 left" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Move New 3 right" }),
      ).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Move New 3 left" }));
      fireEvent.click(screen.getByRole("button", { name: "Move New 1 right" }));
      await flush();
      fireEvent.click(screen.getByTestId("apply-screenshots"));
      await flush();
      expect(applyContext).toHaveBeenCalledTimes(1);
      const input = applyContext.mock.calls[0]?.[1] as { images: Blob[] };
      expect(input.images).toEqual([blobs[1], blobs[0], blobs[2]]);
    });

    it("reorders with Alt+arrow on the thumbnail and by drag and drop", async () => {
      const applyContext = applyOk();
      const blobs = [BLOB("one"), BLOB("two"), BLOB("three")];
      await mount({
        variant,
        mode: "manual",
        applyContext,
        frames: blobs.map((blob) => ({ blob, label: "x" })),
      });
      await add();
      await add();
      await add();
      const thumbs = () => screen.getAllByRole("button", { name: /^Open New/ });
      fireEvent.keyDown(thumbs()[2] as HTMLElement, {
        key: "ArrowLeft",
        altKey: true,
      });
      // [one, three, two]; drag "one" onto the last place.
      fireEvent.dragStart(screen.getByTestId("staged-1"));
      fireEvent.drop(screen.getByTestId("staged-3"));
      await flush();
      fireEvent.click(screen.getByTestId("apply-screenshots"));
      await flush();
      const input = applyContext.mock.calls[0]?.[1] as { images: Blob[] };
      expect(input.images).toEqual([blobs[2], blobs[1], blobs[0]]);
    });

    it("Apply sends ONE request, to the task by default, a new problem when chosen", async () => {
      const applyContext = applyOk();
      await mount({ variant, mode: "manual", applyContext });
      expect(
        screen.getByRole("radiogroup", { name: "Apply to" }),
      ).toBeVisible();
      expect(
        (screen.getByRole("radio", { name: "Add to T1" }) as HTMLInputElement)
          .checked,
      ).toBe(true);
      await add();
      fireEvent.click(screen.getByRole("radio", { name: "New problem" }));
      fireEvent.click(screen.getByTestId("apply-screenshots"));
      fireEvent.click(screen.getByTestId("apply-screenshots"));
      await flush();
      expect(applyContext).toHaveBeenCalledTimes(1);
      expect(applyContext.mock.calls[0]?.[0]).toBeNull();
      // Applied: the tray is empty again.
      expect(screen.queryByTestId("staged-1")).toBeNull();
    });

    it("Discard drops the staged images and sends nothing", async () => {
      const applyContext = applyOk();
      await mount({ variant, mode: "manual", applyContext });
      await add();
      fireEvent.click(screen.getByTestId("discard-screenshots"));
      expect(screen.queryByTestId("staged-1")).toBeNull();
      expect(applyContext).not.toHaveBeenCalled();
    });

    it("shows regenerating while the request is out", async () => {
      let release: (value: { ok: true }) => void = () => undefined;
      const applyContext = vi.fn(
        () => new Promise<{ ok: true }>((resolve) => (release = resolve)),
      );
      await mount({ variant, mode: "manual", applyContext });
      await add();
      fireEvent.click(screen.getByTestId("apply-screenshots"));
      await flush();
      expect(screen.getByTestId("tray-status")).toHaveTextContent(
        "Regenerating T1",
      );
      expect(screen.getByTestId("apply-screenshots")).toBeDisabled();
      expect(screen.getByTestId("add-screenshot")).toBeDisabled();
      await act(async () => release({ ok: true }));
      expect(screen.queryByTestId("tray-status")).toBeNull();
    });
  });

  describe("limits and refusals", () => {
    it("disables Add with the device-only reason BEFORE anything is added, and says nothing leaves the device", async () => {
      await mount({ variant, mode: "manual", deviceOnly: true });
      expect(screen.getByTestId("add-screenshot")).toBeDisabled();
      expect(screen.getByTestId("add-reason")).toHaveTextContent(
        "Device-only mode never sends a screenshot",
      );
      expect(screen.getByTestId("add-screenshot")).toHaveAttribute(
        "aria-describedby",
        screen.getByTestId("add-reason").id,
      );
      expect(screen.getByTestId("tray-sends")).toHaveTextContent(
        "no screenshot leaves this device",
      );
    });

    it("says why capturing is unavailable on this page", async () => {
      await mount({
        variant,
        mode: "manual",
        unavailable: "The session is not taking captures now.",
      });
      expect(screen.getByTestId("add-screenshot")).toBeDisabled();
      expect(screen.getByTestId("add-reason")).toHaveTextContent(
        "not taking captures now",
      );
    });

    it("stops at four images and says so", async () => {
      await mount({
        variant,
        mode: "manual",
        frames: Array.from({ length: 5 }, (_, n) => ({
          blob: BLOB(`${n}`),
          label: "x",
        })),
      });
      for (let n = 0; n < 4; n += 1) await add();
      expect(screen.getAllByTestId(/^staged-/)).toHaveLength(4);
      expect(screen.getByTestId("add-screenshot")).toBeDisabled();
      expect(screen.getByTestId("add-reason")).toHaveTextContent("At most 4");
    });

    it.each([
      ["stale_target", "This task has changed; re-select it."],
      ["vision_device_only", "Device-only mode never sends a screenshot"],
      ["image_count", "At most 4 screenshots"],
      ["image_too_large", "over the 2 MB limit"],
      ["image_dimensions", "too small or too large"],
      ["image_type", "Only JPEG, PNG or WebP"],
      ["ocr", "text read from the screenshots was refused"],
    ])(
      "a refusal %s is said in words and keeps the images",
      async (reason, words) => {
        const applyContext = vi.fn(async () => ({
          ok: false,
          code: "invalid_input",
          reason,
        }));
        await mount({ variant, mode: "manual", applyContext });
        await add();
        fireEvent.click(screen.getByTestId("apply-screenshots"));
        await flush();
        expect(screen.getByRole("alert")).toHaveTextContent(words);
        expect(screen.getByTestId("staged-1")).toBeVisible();
      },
    );

    it("a failed request offers Retry with the SAME request id", async () => {
      const applyContext = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, code: "network" })
        .mockResolvedValue({ ok: true });
      await mount({ variant, mode: "manual", applyContext });
      await add();
      fireEvent.click(screen.getByTestId("apply-screenshots"));
      await flush();
      expect(screen.getByRole("alert")).toHaveTextContent("didn't go through");
      const retry = screen.getByTestId("apply-screenshots");
      expect(retry).toHaveTextContent("Retry");
      fireEvent.click(retry);
      await flush();
      const ids = applyContext.mock.calls.map(
        (call) => (call[1] as { requestId: string }).requestId,
      );
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBe(ids[1]);
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("crop", () => {
    const openCrop = async () => {
      fireEvent.click(screen.getByRole("button", { name: "Crop New 1" }));
      const image = screen.getByAltText(
        "Screenshot to crop",
      ) as HTMLImageElement;
      Object.defineProperty(image, "naturalWidth", { value: 400 });
      Object.defineProperty(image, "naturalHeight", { value: 300 });
      fireEvent.load(image);
      await flush();
    };

    it("produces a NEW blob in the same place and re-reads its text", async () => {
      const cropped = BLOB("cropped");
      cropMock.cropBlob.mockResolvedValue(cropped);
      const applyContext = applyOk();
      const { reads } = await mount({ variant, mode: "manual", applyContext });
      await add();
      expect(reads).toHaveLength(1);
      await openCrop();
      fireEvent.change(screen.getByLabelText("Width"), {
        target: { value: "200" },
      });
      expect(screen.getByTestId("crop-output")).toHaveTextContent(
        "Output 200 × 300 px",
      );
      fireEvent.click(screen.getByRole("button", { name: "Apply crop" }));
      await flush();
      expect(cropMock.cropBlob).toHaveBeenCalledWith(expect.any(Blob), {
        x: 0,
        y: 0,
        w: 200,
        h: 300,
      });
      expect(reads).toHaveLength(2);
      expect(reads[1]).toBe(cropped);
      expect(screen.queryByTestId("image-viewer")).toBeNull();
      fireEvent.click(screen.getByTestId("apply-screenshots"));
      await flush();
      expect(
        (applyContext.mock.calls[0]?.[1] as { images: Blob[] }).images,
      ).toEqual([cropped]);
    });

    it("never goes below the smallest side, Reset restores the whole image, nothing to crop is not applyable", async () => {
      await mount({ variant, mode: "manual" });
      await add();
      await openCrop();
      expect(screen.getByRole("button", { name: "Apply crop" })).toBeDisabled();
      fireEvent.change(screen.getByLabelText("Width"), {
        target: { value: "5" },
      });
      expect(screen.getByTestId("crop-output")).toHaveTextContent(
        "Output 32 × 300 px",
      );
      fireEvent.click(screen.getByRole("button", { name: "Reset" }));
      expect(screen.getByTestId("crop-output")).toHaveTextContent(
        "Output 400 × 300 px",
      );
    });

    it("moves an edge with the keyboard on its handle", async () => {
      await mount({ variant, mode: "manual" });
      await add();
      await openCrop();
      fireEvent.keyDown(screen.getByTestId("crop-handle-e"), {
        key: "ArrowLeft",
        shiftKey: true,
      });
      expect(screen.getByTestId("crop-output")).toHaveTextContent(
        "Output 390 × 300 px",
      );
    });

    it("says so when the crop fails and keeps the image", async () => {
      cropMock.cropBlob.mockRejectedValue(new Error("too-small"));
      await mount({ variant, mode: "manual" });
      await add();
      await openCrop();
      fireEvent.change(screen.getByLabelText("Height"), {
        target: { value: "100" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Apply crop" }));
      await flush();
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't crop");
      expect(screen.getByTestId("image-viewer")).toBeVisible();
    });
  });

  describe("the viewer", () => {
    const open = async () => {
      await mount({
        variant,
        mode: "auto",
        storedItems: [
          stored(7, { display: { name: "D", index: 1, count: 2 } }),
        ],
      });
      fireEvent.click(screen.getByTestId("screenshots-toggle"));
      const thumb = screen.getByRole("button", { name: "Open S7" });
      thumb.focus();
      fireEvent.click(thumb);
      // The browser reports the image's own size once it has loaded.
      const image = screen.getByAltText("Screenshot S7") as HTMLImageElement;
      Object.defineProperty(image, "naturalWidth", { value: 1200 });
      Object.defineProperty(image, "naturalHeight", { value: 800 });
      fireEvent.load(image);
      return thumb;
    };

    it("is a modal dialog showing the label, time, display and text state, loading the stored image from its route", async () => {
      await open();
      const dialog = screen.getByRole("dialog", { name: "Screenshot S7" });
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(within(dialog).getByTestId("viewer-label")).toHaveTextContent(
        "S7",
      );
      expect(within(dialog).getByTestId("viewer-meta")).toHaveTextContent(
        "Display 1 of 2",
      );
      expect(within(dialog).getByTestId("viewer-meta")).toHaveTextContent(
        "Apple Vision",
      );
      expect(within(dialog).getByAltText("Screenshot S7")).toHaveAttribute(
        "src",
        "/img/a7",
      );
      expect(within(dialog).getByTestId("viewer-keys")).toHaveTextContent(
        "+ zoom in",
      );
      expect(within(dialog).getByTestId("viewer-keys")).toHaveTextContent(
        "Esc close",
      );
    });

    it("zooms with the buttons and keys, Fit and 100%, and pans with the arrows", async () => {
      await open();
      const dialog = screen.getByRole("dialog");
      const zoom = within(dialog).getByTestId("viewer-zoom");
      expect(zoom).toHaveTextContent("Fit");
      fireEvent.click(within(dialog).getByRole("button", { name: "Zoom in" }));
      expect(zoom).toHaveTextContent("150%");
      fireEvent.keyDown(dialog, { key: "-" });
      expect(zoom).toHaveTextContent("100%");
      fireEvent.keyDown(dialog, { key: "+" });
      fireEvent.keyDown(dialog, { key: "1" });
      expect(zoom).toHaveTextContent("100%");
      fireEvent.keyDown(dialog, { key: "ArrowLeft" });
      const image = within(dialog).getByAltText("Screenshot S7");
      expect(image.style.transform).toBe("translate(48px, 0px)");
      fireEvent.keyDown(dialog, { key: "f" });
      expect(zoom).toHaveTextContent("Fit");
      fireEvent.click(within(dialog).getByRole("button", { name: "100%" }));
      expect(zoom).toHaveTextContent("100%");
    });

    it("pans by dragging once zoomed", async () => {
      await open();
      const dialog = screen.getByRole("dialog");
      fireEvent.keyDown(dialog, { key: "1" });
      const stage = within(dialog).getByTestId("viewer-stage");
      fireEvent.pointerDown(stage, {
        clientX: 100,
        clientY: 100,
        pointerId: 1,
      });
      fireEvent.pointerMove(stage, { clientX: 130, clientY: 90, pointerId: 1 });
      fireEvent.pointerUp(stage, { pointerId: 1 });
      expect(within(dialog).getByAltText("Screenshot S7").style.transform).toBe(
        "translate(30px, -10px)",
      );
    });

    it("closes on Escape and gives focus back to the thumbnail", async () => {
      const thumb = await open();
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(thumb).toHaveFocus();
    });

    it("keeps Tab inside the dialog", async () => {
      await open();
      const dialog = screen.getByRole("dialog");
      const close = within(dialog).getByRole("button", {
        name: "Close viewer",
      });
      close.focus();
      fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
      const buttons = within(dialog).getAllByRole("button");
      expect(buttons[buttons.length - 1]).toHaveFocus();
      fireEvent.keyDown(buttons[buttons.length - 1] as HTMLElement, {
        key: "Tab",
      });
      expect(buttons[0]).toHaveFocus();
    });

    it("says 'Not sent yet' for a staged image and revokes its object URL when it leaves", async () => {
      await mount({ variant, mode: "manual" });
      await add();
      fireEvent.click(screen.getByRole("button", { name: "Open New 1" }));
      expect(
        within(screen.getByRole("dialog")).getByText("Not sent yet"),
      ).toBeVisible();
      expect(screen.getByAltText("Screenshot New 1")).toHaveAttribute(
        "src",
        expect.stringMatching(/^blob:staged-/),
      );
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      fireEvent.click(screen.getByRole("button", { name: "Remove New 1" }));
      await flush();
      expect(URL.revokeObjectURL).toHaveBeenCalled();
    });

    it("a purged image says it is no longer stored instead of drawing nothing", async () => {
      await mount({
        variant,
        mode: "auto",
        storedItems: [stored(9, { artifactId: null, imageUrl: null })],
      });
      fireEvent.click(screen.getByTestId("screenshots-toggle"));
      fireEvent.click(screen.getByRole("button", { name: "Open S9" }));
      expect(screen.getByRole("dialog")).toHaveTextContent("no longer stored");
    });
  });

  describe("accessibility", () => {
    it("names the region, the lists and every icon control", async () => {
      await mount({
        variant,
        mode: "manual",
        storedItems: [stored(1)],
        frames: [
          { blob: BLOB("1"), label: "x" },
          { blob: BLOB("2"), label: "x" },
        ],
      });
      await add();
      await add();
      expect(screen.getByRole("region", { name: "Screenshots" })).toBeVisible();
      expect(
        screen.getByRole("list", { name: "Screenshots of this task" }),
      ).toBeVisible();
      expect(
        screen.getByRole("list", { name: "Screenshots to apply, in order" }),
      ).toBeVisible();
      for (const name of [
        "Crop New 1",
        "Move New 1 right",
        "Move New 2 left",
        "Remove New 2",
        "Open New 1",
        "Open S1",
      ])
        expect(screen.getByRole("button", { name })).toBeVisible();
    });
  });
});
