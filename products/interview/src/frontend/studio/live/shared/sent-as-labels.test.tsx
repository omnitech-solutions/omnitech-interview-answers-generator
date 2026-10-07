// D35: the "sent as" labels on the screenshots strip, tray and viewer, the tray
// sentence per setting and the tooltip. Labels come ONLY from what the server
// recorded (`sentByRevision`); a screenshot with no record has none.
import type {
  LiveScreenshotSend,
  LiveScreenshotSent,
} from "@omnitech/interview-contracts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useMemo } from "react";
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
  actionsVersion,
  type ScreenshotsView,
  stagedShotViews,
  storedShotViews,
  useObjectUrls,
} from "./use-screenshots-view";

const item = (
  n: number,
  sentByRevision?: { revision: number; sent: LiveScreenshotSent }[],
): TaskScreenshotItem => ({
  ordinal: n,
  label: `S${n}`,
  capturedAt: "2026-10-05T10:00:00.000Z",
  artifactId: `a${n}`,
  revisions: [1, 2],
  imageUrl: `/img/a${n}`,
  hasText: true,
  ocrEngine: "vision",
  display: null,
  ...(sentByRevision ? { sentByRevision } : {}),
});

type Read = "text" | "none" | "pending";
function recognizer(read: Read): TextRecognizer {
  return {
    engine: "vision",
    available: true,
    recognize: () =>
      read === "pending"
        ? new Promise<RecognitionResult>(() => undefined)
        : Promise.resolve({
            ok: true,
            engine: "vision",
            text: read === "text" ? "some text" : "   ",
            confidence: 0.9,
            truncated: false,
          }),
  };
}

function Harness({
  variant,
  mode,
  setting,
  stored = [],
  read = "text",
  staged = 0,
}: {
  variant: ScreenshotsVariant;
  mode: "auto" | "manual";
  setting?: LiveScreenshotSend;
  stored?: TaskScreenshotItem[];
  read?: Read;
  staged?: number;
}) {
  // One recognizer for the harness's life: a new one per render would re-read.
  const reader = useMemo(() => recognizer(read), [read]);
  const tray = useScreenshotTray({
    actions: { applyContext: async () => ({ ok: true }) } as never,
    sessionId: "s1",
    target: { taskId: "t1", revision: 1 },
    deviceOnly: false,
    screenshotSend: setting,
    hints: {},
    mode,
    recognizer: reader,
  });
  const storedViews = storedShotViews(stored);
  const urlOf = useObjectUrls(tray.items.map((shot) => shot.blob));
  const view: ScreenshotsView = {
    tray,
    taskLabel: "T1",
    stored: storedViews,
    staged: stagedShotViews(
      tray.items,
      tray.recognition.states,
      urlOf,
      tray.screenshotSend,
    ),
    loading: false,
    error: false,
    count: storedViews.length + tray.items.length,
  };
  const id = useAreaId();
  return (
    <div>
      <ScreenshotsToggle view={view} variant={variant} controls={id} />
      <ScreenshotsArea
        view={view}
        id={id}
        variant={variant}
        captureUnavailable={null}
        onAdd={(intent) =>
          tray.stage(
            {
              blob: new Blob(["f"], { type: "image/png" }),
              label: "This Mac",
              display: null,
            },
            intent,
          )
        }
      />
      {staged > 0 && (
        <button
          type="button"
          data-testid="stage-n"
          onClick={() => {
            for (let i = 0; i < staged; i += 1)
              tray.stage(
                {
                  blob: new Blob([`f${i}`], { type: "image/png" }),
                  label: "This Mac",
                  display: null,
                },
                "add",
              );
          }}
        />
      )}
    </div>
  );
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

beforeEach(() => {
  let n = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:staged-${(n += 1)}`),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each(["native", "web"] as const)("%s", (variant) => {
  describe("the strip labels what the server recorded", () => {
    it.each([
      ["image", "Image sent"],
      ["text-only", "Sent as text only"],
      ["none", "Not sent"],
    ] as const)("%s reads %s", async (sent, label) => {
      render(
        <Harness
          variant={variant}
          mode="auto"
          stored={[item(1, [{ revision: 1, sent }])]}
        />,
      );
      fireEvent.click(screen.getByTestId("screenshots-toggle"));
      expect(screen.getByTestId("sent-as")).toHaveTextContent(label);
    });

    it("says nothing when the server recorded nothing", () => {
      render(
        <Harness
          variant={variant}
          mode="auto"
          stored={[item(1), item(2, [])]}
        />,
      );
      fireEvent.click(screen.getByTestId("screenshots-toggle"));
      expect(screen.queryByTestId("sent-as")).toBeNull();
      expect(screen.getByTestId("screenshot-strip")).not.toHaveTextContent(
        /sent/i,
      );
    });

    it("shows the newest revision's outcome and lists every revision in its title", () => {
      render(
        <Harness
          variant={variant}
          mode="auto"
          stored={[
            item(1, [
              { revision: 1, sent: "image" },
              { revision: 2, sent: "text-only" },
            ]),
          ]}
        />,
      );
      fireEvent.click(screen.getByTestId("screenshots-toggle"));
      const label = screen.getByTestId("sent-as");
      expect(label).toHaveTextContent("Sent as text only");
      expect(label).toHaveAttribute(
        "title",
        "rev 1: Image sent, rev 2: Sent as text only",
      );
    });
  });

  describe("the viewer header", () => {
    it("shows the label and the per-revision line", () => {
      render(
        <Harness
          variant={variant}
          mode="auto"
          stored={[
            item(1, [
              { revision: 1, sent: "image" },
              { revision: 2, sent: "none" },
            ]),
          ]}
        />,
      );
      fireEvent.click(screen.getByTestId("screenshots-toggle"));
      fireEvent.click(screen.getByRole("button", { name: "Open S1" }));
      const viewer = screen.getByTestId("image-viewer");
      expect(within(viewer).getByTestId("viewer-sent-as")).toHaveTextContent(
        "Not sent",
      );
      expect(within(viewer).getByTestId("viewer-sent-line")).toHaveTextContent(
        "rev 1: Image sent, rev 2: Not sent",
      );
    });

    it("has no label for a screenshot with no record", () => {
      render(<Harness variant={variant} mode="auto" stored={[item(1)]} />);
      fireEvent.click(screen.getByTestId("screenshots-toggle"));
      fireEvent.click(screen.getByRole("button", { name: "Open S1" }));
      const viewer = screen.getByTestId("image-viewer");
      expect(within(viewer).queryByTestId("viewer-sent-as")).toBeNull();
      expect(within(viewer).queryByTestId("viewer-sent-line")).toBeNull();
    });
  });

  describe("the staged tray says what WILL happen only when it can be known", () => {
    const stage = async () => {
      fireEvent.click(screen.getByTestId("add-screenshot"));
      await flush();
    };

    it("Always: Will be sent as image", async () => {
      render(<Harness variant={variant} mode="manual" setting="always" />);
      fireEvent.click(screen.getByTestId("screenshots-toggle"));
      await stage();
      expect(screen.getByTestId("will-be-1")).toHaveTextContent(
        "Will be sent as image",
      );
      expect(screen.getByTestId("tray-sends")).toHaveTextContent(
        "Sends 1 screenshot and the text read from it.",
      );
    });

    it("a session with no saved value reads as Always", async () => {
      render(<Harness variant={variant} mode="manual" />);
      fireEvent.click(screen.getByTestId("screenshots-toggle"));
      await stage();
      expect(screen.getByTestId("will-be-1")).toHaveTextContent(
        "Will be sent as image",
      );
      expect(screen.getByTestId("tray-sends")).toHaveTextContent(
        "Sends 1 screenshot and the text read from it.",
      );
    });

    it("Never with text read: Will be sent as text only; none read: Will not be sent", async () => {
      const { unmount } = render(
        <Harness variant={variant} mode="manual" setting="never" read="text" />,
      );
      fireEvent.click(screen.getByTestId("screenshots-toggle"));
      await stage();
      expect(screen.getByTestId("will-be-1")).toHaveTextContent(
        "Will be sent as text only",
      );
      expect(screen.getByTestId("tray-sends")).toHaveTextContent(
        "Sends the text read from 1 screenshot.",
      );
      unmount();
      render(
        <Harness variant={variant} mode="manual" setting="never" read="none" />,
      );
      fireEvent.click(screen.getByTestId("screenshots-toggle"));
      await stage();
      expect(screen.getByTestId("will-be-1")).toHaveTextContent(
        "Will not be sent",
      );
    });

    it("Never while the text is still being read: Decided when sent", async () => {
      render(
        <Harness
          variant={variant}
          mode="manual"
          setting="never"
          read="pending"
        />,
      );
      fireEvent.click(screen.getByTestId("screenshots-toggle"));
      await stage();
      expect(screen.getByTestId("will-be-1")).toHaveTextContent(
        "Decided when sent",
      );
    });

    it("Text only when the screen is just text: Decided when sent, and the 'may send' sentence", async () => {
      render(
        <Harness
          variant={variant}
          mode="manual"
          setting="text-only-when-text"
        />,
      );
      fireEvent.click(screen.getByTestId("screenshots-toggle"));
      await stage();
      expect(screen.getByTestId("will-be-1")).toHaveTextContent(
        "Decided when sent",
      );
      expect(screen.getByTestId("tray-sends")).toHaveTextContent(
        "May send the image or only its text.",
      );
      // The staged viewer repeats the prediction, never a "sent" label.
      fireEvent.click(screen.getByRole("button", { name: "Open New 1" }));
      const viewer = screen.getByTestId("image-viewer");
      expect(within(viewer).getByTestId("viewer-will-be")).toHaveTextContent(
        "Decided when sent",
      );
      expect(within(viewer).queryByTestId("viewer-sent-as")).toBeNull();
    });
  });

  describe("the screenshots button tooltip carries the active setting", () => {
    it.each([
      [undefined, "Screenshots to the model: Always"],
      ["always", "Screenshots to the model: Always"],
      ["text-only-when-text", "Screenshots to the model: Text only when text"],
      ["never", "Screenshots to the model: Never"],
    ] as const)("%s", (setting, text) => {
      render(
        <Harness
          variant={variant}
          mode="auto"
          {...(setting ? { setting } : {})}
        />,
      );
      expect(screen.getByTestId("screenshots-toggle")).toHaveAttribute(
        "title",
        expect.stringContaining(text),
      );
    });
  });
});

describe("actionsVersion", () => {
  it("changes when an action's status changes with the count unchanged, so labels refresh", () => {
    const before = [{ id: "a", dispatchStatus: "in_flight", updatedAt: "t1" }];
    const after = [{ id: "a", dispatchStatus: "succeeded", updatedAt: "t2" }];
    expect(actionsVersion(after)).not.toBe(actionsVersion(before));
    expect(actionsVersion(before)).toBe(actionsVersion([...before]));
  });
});
