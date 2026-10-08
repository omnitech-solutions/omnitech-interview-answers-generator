import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoachLayout } from "./coach-layout";
import type { PanelSession } from "./panel-views";

const T0 = Date.parse("2026-10-08T17:40:00.000Z");
const QUESTION = "How do you handle data consistency between multiple services";
const session = {
  model: {
    transcript: [
      {
        id: "o1",
        text: QUESTION,
        source: "application-audio",
        at: new Date(T0).toISOString(),
      },
    ],
    tasks: [],
    noQuestion: [],
    activity: { key: "idle", text: "" },
  },
  snapshot: { pending: [], observations: [] },
  target: null,
  entries: [],
  clearedAt: 0,
  revisionPicks: {},
  select: () => undefined,
  open: true,
  phase: null,
  note: null,
  draft: "",
  setDraft: () => undefined,
  send: async () => ({ ok: true }),
  press: () => undefined,
  live: { mic: "off", interim: "" },
  tray: { intent: "new", items: [] },
} as unknown as PanelSession;

const NOTES = {
  revision: 1,
  notes: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      createdAt: new Date(T0 + 20_000).toISOString(),
      title: "Name the techniques",
      tone: "say",
      points: [],
      markdown: "- **Outbox**: one transaction",
      links: [],
      ask: "Data consistency across services",
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(NOTES))),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("CoachLayout", () => {
  it("shows the note under the call in the prompter, with the call slot above it", async () => {
    render(<CoachLayout s={session} view="prompter" />);

    await waitFor(() => expect(screen.getByText("Outbox")).toBeVisible());
    expect(screen.getByTestId("pn-call-slot")).toBeInTheDocument();
    expect(screen.queryByTestId("pn-coach-questions")).toBeNull();
  });
});
