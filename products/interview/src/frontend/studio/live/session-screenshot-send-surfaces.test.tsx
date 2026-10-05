// D35: the control where the processing policy is shown, on the web live page
// (Sources tab) and in the native Settings window, over the real store.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presentation } from "./focus-presentation";
import { OverlayPage } from "./overlay/overlay-page";
import { configureSessionStores, resetSessionStores } from "./session-registry";
import { show, spies } from "./testing/live-view-kit";
import {
  jsonResponse,
  sessionView,
  streamPage,
} from "./testing/session-fixtures";
import { createTestServer } from "./testing/session-test-server";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const radio = (name: RegExp) =>
  screen.getByRole("radio", { name }) as HTMLInputElement;

describe("web live page (Sources tab, next to Processing)", () => {
  const open = () =>
    fireEvent.click(screen.getByRole("tab", { name: /Sources/ }));

  it("shows the saved value after the processing policy and saves a change once", async () => {
    const { actions } = show({
      session: {
        processingPolicy: "permitted-remote",
        screenshotSend: "never",
      },
    });
    open();
    const processing = screen.getByRole("region", { name: "Processing" });
    const send = screen.getByRole("region", {
      name: "Screenshots to the model",
    });
    expect(
      processing.compareDocumentPosition(send) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(radio(/Never send images/).checked).toBe(true);
    await act(async () => {
      fireEvent.click(radio(/Always send/));
    });
    expect(actions.setScreenshotSend).toHaveBeenCalledTimes(1);
    expect(actions.setScreenshotSend).toHaveBeenCalledWith("always");
  });

  it("an ended session shows it disabled with the reason", () => {
    const { actions } = show({
      session: {
        processingPolicy: "permitted-remote",
        status: "ended",
        endedAt: new Date().toISOString(),
      },
    });
    open();
    expect(radio(/Always send/)).toBeDisabled();
    expect(screen.getByTestId("screenshot-send-status")).toHaveTextContent(
      "This session has ended",
    );
    expect(actions.setScreenshotSend).not.toHaveBeenCalled();
  });

  it("a device-only session says images are never sent and disables it", () => {
    const { actions } = show({ session: { processingPolicy: "device-only" } });
    open();
    expect(radio(/Never send images/)).toBeDisabled();
    expect(screen.getByTestId("screenshot-send-status")).toHaveTextContent(
      "device-only, so no screenshot image is ever sent",
    );
    expect(actions.setScreenshotSend).not.toHaveBeenCalled();
  });

  it("spies include the action (kit sanity)", () => {
    expect(spies().setScreenshotSend).toBeTypeOf("function");
  });
});

describe("native Settings window", () => {
  beforeEach(() => {
    resetSessionStores();
    presentation.reset?.();
  });
  afterEach(() => resetSessionStores());

  async function showSettings(
    session = sessionView({ processingPolicy: "permitted-remote" }),
  ) {
    let current = session;
    const server = createTestServer(() => streamPage({ session: current }));
    server.on("GET /current", () => jsonResponse({ session: current }));
    const bodies: unknown[] = [];
    server.on("POST /:id/screenshot-send", ({ body }) => {
      bodies.push(body);
      current = {
        ...current,
        screenshotSend: (body as { screenshotSend: "never" }).screenshotSend,
      };
      return jsonResponse({ session: current });
    });
    configureSessionStores({
      fetch: server.fetch,
      isVisible: () => true,
      storage: { read: () => null, write: () => {}, remove: () => {} },
    });
    window.history.replaceState(
      {},
      "",
      "/t/local/p/interview/live/overlay?panel=settings",
    );
    render(<OverlayPage />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    return { bodies, server };
  }

  it("shows the saved value, posts one change to /screenshot-send and then shows the new saved value", async () => {
    const { bodies, server } = await showSettings();
    expect(
      screen.getByRole("radiogroup", { name: "Screenshots to the model" }),
    ).toHaveClass("ssc-native");
    expect(radio(/Always send/).checked).toBe(true);
    await act(async () => {
      fireEvent.click(radio(/Text only when the screen is just text/));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(bodies).toEqual([{ screenshotSend: "text-only-when-text" }]);
    expect(server.count("POST /:id/screenshot-send")).toBe(1);
    expect(radio(/Text only when the screen is just text/).checked).toBe(true);
  });

  it("is disabled with the reason for a device-only session", async () => {
    const { bodies } = await showSettings(
      sessionView({ processingPolicy: "device-only" }),
    );
    expect(radio(/Always send/)).toBeDisabled();
    expect(screen.getByTestId("screenshot-send-status")).toHaveTextContent(
      "device-only",
    );
    fireEvent.click(radio(/Never send images/));
    expect(bodies).toEqual([]);
  });
});
