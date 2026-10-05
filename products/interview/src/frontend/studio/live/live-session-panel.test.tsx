// The live panel over the real session store and routes (a scripted server):
// the body, the header bar and the pairing panel together.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioActions } from "../config/commands";
import { LiveSessionPanel } from "./live-session-view";
import { getSessionStore, resetSessionStores } from "./session-registry";
import {
  action,
  jsonResponse,
  minutesAfter,
  sessionView,
  streamPage,
  transcript,
} from "./testing/session-fixtures";
import { answerResult } from "./testing/session-result-fixtures";
import { createTestServer } from "./testing/session-test-server";

const studio = {} as StudioActions;
let server: ReturnType<typeof createTestServer>;
let session = sessionView({ lastHeartbeatAt: minutesAfter(1, 55) });

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(2)));
  resetSessionStores();
  session = sessionView({ lastHeartbeatAt: minutesAfter(1, 55) });
  server = createTestServer(() =>
    streamPage({
      session,
      serverNow: minutesAfter(2),
      observations: [transcript(1, "Tell me about a migration.")],
      actions: [action({ result: answerResult() })],
    }),
  );
  server.on("GET /current", () => jsonResponse({ session }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      server.fetch(String(input), init),
    ),
  );
  window.history.replaceState({}, "", "/t/local/p/interview/live");
});
afterEach(() => {
  resetSessionStores();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function open() {
  render(<LiveSessionPanel />);
  // The shell subscribes the store; a lone panel has to do it itself.
  getSessionStore("local").subscribe(() => undefined);
  await flush();
  await flush();
}

describe("LiveSessionPanel", () => {
  it("renders the header, the newest answer and the transcript from the store", async () => {
    await open();
    expect(screen.getByTestId("live-panel")).toBeVisible();
    expect(screen.getByTestId("session-bar")).toHaveAttribute(
      "data-variant",
      "header",
    );
    expect(
      screen.getByText(
        "I led the migration at Example Corp and kept the service up.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Tell me about a migration.")).toBeVisible();
  });

  it("renews the credential and then resumes when resume needs a new one", async () => {
    session = sessionView({
      status: "paused",
      lastHeartbeatAt: minutesAfter(1, 55),
    });
    let resumes = 0;
    server.on("POST /:id/control", () => {
      resumes += 1;
      if (resumes === 1)
        return jsonResponse(
          { error: { code: "credential_renewal_required" } },
          409,
        );
      session = sessionView({
        status: "active",
        lastHeartbeatAt: minutesAfter(1, 55),
      });
      return jsonResponse({ session });
    });
    server.on("POST /:id/credential", () =>
      jsonResponse({
        credential: {
          value: "one-time-credential",
          expiresAt: minutesAfter(120),
        },
      }),
    );
    await open();
    const banner = screen
      .getByText(/^Paused\./)
      .closest("[role]") as HTMLElement;
    await act(async () => {
      fireEvent.click(within(banner).getByRole("button", { name: "Resume" }));
    });
    await flush();
    expect(server.calls.filter((c) => c.startsWith("POST"))).toEqual([
      "POST /:id/control",
      "POST /:id/credential",
      "POST /:id/control",
    ]);
    // The pairing panel (in Sources) holds the new credential, masked.
    expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("pairing-panel")).toBeVisible();
    expect(screen.getByTestId("pairing-credential")).not.toHaveTextContent(
      "one-time-credential",
    );
  });
});
