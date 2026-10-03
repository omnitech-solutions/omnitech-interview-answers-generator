import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { companionChip, PairingPanel } from "./pairing-panel";
import {
  jsonResponse,
  minutesAfter,
  sessionView,
  streamPage,
} from "./session-fixtures";
import { getSessionStore, resetSessionStores } from "./session-registry";
import { createTestServer, type TestServer } from "./session-test-server";

const SECRET = "pair-secret-123";
const RENEWED = "renewed-secret-456";

let server: TestServer;
let writeText: ReturnType<typeof vi.fn>;
let deleteCalls = 0;

function install(session = sessionView({ status: "created" })) {
  server = createTestServer(() => streamPage({ session }));
  server.on("GET /current", () => jsonResponse({ session }));
  server.on("GET /:id", () => jsonResponse({ session }));
  server.on("POST /:id/credential", () =>
    jsonResponse({
      credential: { value: RENEWED, expiresAt: minutesAfter(180) },
    }),
  );
  server.on("DELETE /:id/credential", () => {
    deleteCalls += 1;
    return new Response(null, { status: 204 });
  });
  server.on("POST /", () =>
    jsonResponse(
      {
        session,
        credential: { value: SECRET, expiresAt: minutesAfter(120) },
      },
      201,
    ),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      server.fetch(String(input), init),
    ),
  );
}

// Renders the panel for an open session whose start just returned a credential.
async function openWithCredential() {
  render(<PairingPanel />);
  await screen.findByTestId("pairing-panel");
  await getSessionStore("local").actions.start({
    processingPolicy: "device-only",
    captureSources: ["microphone"],
  });
  await screen.findByTestId("pairing-credential");
}

beforeEach(() => {
  resetSessionStores();
  deleteCalls = 0;
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  window.localStorage.clear();
  window.sessionStorage.clear();
  install();
});
afterEach(() => {
  cleanup();
  resetSessionStores();
  vi.unstubAllGlobals();
});

describe("PairingPanel", () => {
  it("renders nothing when no session is open", async () => {
    install(sessionView({ status: "ended", endedAt: minutesAfter(5) }));
    render(<PairingPanel />);
    await waitFor(() =>
      expect(server.count("GET /current")).toBeGreaterThan(0),
    );
    expect(screen.queryByTestId("pairing-panel")).not.toBeInTheDocument();
  });

  it("shows no credential until start, and says it is waiting for first contact", async () => {
    render(<PairingPanel />);
    await screen.findByTestId("pairing-panel");
    expect(screen.queryByTestId("pairing-credential")).not.toBeInTheDocument();
    expect(screen.getByTestId("pairing-status")).toHaveTextContent(
      "Waiting for first contact",
    );
    expect(screen.getByTestId("pairing-panel")).toHaveTextContent(
      "no longer shown",
    );
  });

  it("masks the credential by default and reveals it on request", async () => {
    await openWithCredential();
    const value = screen.getByTestId("pairing-credential");
    expect(value).not.toHaveTextContent(SECRET);
    expect(document.body.textContent).not.toContain(SECRET);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(value).toHaveTextContent(SECRET);
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(value).not.toHaveTextContent(SECRET);
  });

  it("copies the credential, even while it is masked", async () => {
    await openWithCredential();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET));
    expect(await screen.findByText(/Copied\. Paste it/)).toBeVisible();
  });

  it("says so when the clipboard is refused", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    await openWithCredential();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText(/Couldn’t copy/)).toBeVisible();
  });

  it("states the expiry and the 2 hour bound, never a 10 minute renewal", async () => {
    await openWithCredential();
    const text = screen.getByTestId("pairing-panel").textContent ?? "";
    expect(text).toContain("Expires at");
    expect(text).toContain("up to 2 hours");
    expect(text).not.toMatch(/10 min/);
  });

  it("never writes the credential to storage, the URL or cookies", async () => {
    await openWithCredential();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    const stored = JSON.stringify({
      local: { ...window.localStorage },
      session: { ...window.sessionStorage },
    });
    expect(stored).not.toContain(SECRET);
    expect(window.location.href).not.toContain(SECRET);
    expect(document.cookie).not.toContain(SECRET);
  });

  it("renewal replaces the credential and masks the new one", async () => {
    await openWithCredential();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    fireEvent.click(screen.getByRole("button", { name: "Renew" }));
    await waitFor(() => expect(server.count("POST /:id/credential")).toBe(1));
    await waitFor(() =>
      expect(getSessionStore("local").getSnapshot().pairing?.value).toBe(
        RENEWED,
      ),
    );
    const value = screen.getByTestId("pairing-credential");
    expect(value).not.toHaveTextContent(RENEWED);
    expect(screen.getByRole("button", { name: "Show" })).toBeVisible();
  });

  it("revoking asks first, then revokes and re-reads the session", async () => {
    await openWithCredential();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(deleteCalls).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(deleteCalls).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke and pause" }));
    await waitFor(() => expect(deleteCalls).toBe(1));
    await waitFor(() => expect(server.count("GET /:id")).toBeGreaterThan(0));
  });

  it("dismiss clears the credential from the store and the screen", async () => {
    await openWithCredential();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(getSessionStore("local").getSnapshot().pairing).toBeNull(),
    );
    expect(screen.queryByTestId("pairing-credential")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("a failed renewal says so with a fixed code", async () => {
    await openWithCredential();
    server.on("POST /:id/credential", () =>
      jsonResponse({ error: { code: "status_refused" } }, 409),
    );
    fireEvent.click(screen.getByRole("button", { name: "Renew" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "status_refused",
    );
  });

  it("flags an expired or revoked credential", async () => {
    install(sessionView({ status: "paused", credentialRevoked: true }));
    render(<PairingPanel />);
    expect(await screen.findByTestId("pairing-note")).toHaveTextContent(
      "revoked",
    );
  });
});

describe("companionChip", () => {
  const base = {
    lastContactAt: null,
    ageMs: null,
    credential: "valid" as const,
    credentialExpiresInMs: 1,
  };
  it("is in contact only after a recorded heartbeat, and offline when stale", () => {
    expect(companionChip({ ...base, status: "never-seen" })).toEqual({
      tone: "amber",
      text: "Waiting for first contact",
    });
    expect(companionChip({ ...base, status: "online", ageMs: 20_000 })).toEqual(
      { tone: "green", text: "In contact · last heard less than a minute ago" },
    );
    expect(
      companionChip({ ...base, status: "offline", ageMs: 5 * 60_000 }),
    ).toEqual({ tone: "red", text: "No contact for 5 min" });
  });
});
