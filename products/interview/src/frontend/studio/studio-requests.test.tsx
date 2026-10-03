import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSessionStores } from "./live/session-registry";
import { StudioPage } from "./studio-page";

// Every request the studio makes, and whether its effect later aborted it.
type Sent = { request: string; signal: AbortSignal | undefined };
let sent: Sent[];
const now = new Date().toISOString();

function installServer() {
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      sent.push({
        request: `${init?.method ?? "GET"} ${url}`,
        signal: init?.signal ?? undefined,
      });
      const path = url.split("?")[0];
      // The docked assistant's server offers nothing beyond chat.
      if (path === "/api/assistant/v1/capabilities")
        return Response.json({ features: [] });
      if (path?.startsWith("/api/assistant/"))
        return Response.json(
          { code: "not-found", message: "Not here." },
          { status: 404 },
        );
      if (path === "/api/interview/workspaces/interview/artifacts")
        return Response.json([
          {
            artifactId: "q1",
            title: "Two sum",
            kind: "coding",
            language: "typescript",
            updatedAt: now,
          },
        ]);
      if (path === "/api/interview/briefing/artifacts")
        return Response.json({
          artifacts: ["pack-1", "pack-2"].map((id) => ({
            id,
            title: `Preparation ${id}`,
            revision: 1,
            savedRevision: 1,
            updatedAt: now,
          })),
        });
      if (path === "/api/interview/briefs")
        return Response.json({ briefs: [] });
      return Response.json({}, { status: 404 });
    }),
  );
}

// [DOMAIN] Requests still live once the screen settles, per resource. The
// assistant's own requests belong to the vendored assistant and are not
// counted here; after load, the control channel's 500 ms poll is not either.
function liveStudioRequests({ polls = true } = {}) {
  const counts: Record<string, number> = {};
  for (const { request, signal } of sent)
    if (
      !signal?.aborted &&
      !request.includes("/api/assistant/") &&
      (polls || !request.endsWith("/api/v1/playground-control"))
    )
      counts[request] = (counts[request] ?? 0) + 1;
  return counts;
}

async function openStudio(path: string) {
  window.history.replaceState({}, "", `/t/local/p/interview${path}`);
  // StrictMode runs every effect twice, as the development server does: a
  // load whose cleanup does not abort it shows up as a second live request.
  render(
    <StrictMode>
      <StudioPage />
    </StrictMode>,
  );
  await settle();
}
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

// Shared by every screen: the sidebar's lists and the control channel.
const SHELL = {
  "GET /api/interview/workspaces/interview/artifacts": 1,
  "GET /api/interview/briefing/artifacts?tenant=local": 1,
  "GET /api/interview/briefs": 1,
  "GET /api/v1/playground-control": 1,
  // The session store hydrates once for the whole shell (StrictMode included).
  "GET /api/interview/t/local/sessions/current": 1,
};

beforeEach(() => {
  resetSessionStores();
  installServer();
});
afterEach(() => {
  resetSessionStores();
  vi.unstubAllGlobals();
});

describe("Interview Studio requests on load", () => {
  it.each([
    ["Home", "", { "GET /api/interview/plan": 1 }],
    [
      "Workspace",
      "/work?artifact=q1",
      { "GET /api/interview/workspaces/interview/artifacts/q1": 1 },
    ],
    ["Briefings", "/briefings", {}],
    [
      "a behavioural pack",
      "/briefings/pack-1",
      {
        "GET /api/interview/briefing/profiles": 1,
        "GET /api/interview/briefing/artifacts/pack-1": 1,
      },
    ],
    [
      "Knowledge",
      "/knowledge",
      {
        "GET /api/v1/library/facets": 1,
        "GET /api/v1/library/search?q=&limit=20": 1,
      },
    ],
    ["Rehearsal", "/rehearsal", {}],
  ])("%s loads each resource once", async (_screen, path, own) => {
    await openStudio(path);

    expect(liveStudioRequests()).toEqual({ ...SHELL, ...own });
  });
});

describe("Interview Studio requests on common actions", () => {
  it("opening another pack loads only that pack, once", async () => {
    await openStudio("/briefings/pack-1");
    sent = [];

    fireEvent.click(await screen.findByRole("button", { name: /pack-2/ }));
    await settle();

    expect(liveStudioRequests({ polls: false })).toEqual({
      "GET /api/interview/briefing/profiles": 1,
      "GET /api/interview/briefing/artifacts/pack-2": 1,
    });
  });
});
