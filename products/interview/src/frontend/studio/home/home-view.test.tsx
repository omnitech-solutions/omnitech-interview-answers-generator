import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioActions } from "../config/commands";
import { runStatus } from "../run-status";
import type { StudioLists } from "../use-studio-lists";
import { HomeView } from "./home-view";
import { daysUntil } from "./interview-card";

const interview = {
  id: "plan-1",
  company: "Northwind",
  role: "Senior Backend Engineer",
  scheduledAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  durationMinutes: 60,
  format: "live coding + concepts",
  topics: ["TypeScript", "PostgreSQL"],
  updatedAt: new Date().toISOString(),
};
const items = [
  {
    id: "i1",
    kind: "question",
    ref: "two-sum",
    title: "Solve: two sum",
    done: false,
    position: 0,
    status: { label: "1 of 2 tests passing", tone: "warn" },
  },
  {
    id: "i2",
    kind: "briefing",
    ref: "pack-1",
    title: "Brief: recruiter",
    done: true,
    position: 1,
    status: { label: "Saved", tone: "good" },
  },
  {
    id: "i3",
    kind: "rehearsal",
    ref: null,
    title: "Rehearse",
    done: false,
    position: 2,
    status: null,
  },
  {
    id: "i4",
    kind: "task",
    ref: null,
    title: "Read the job post",
    done: false,
    position: 3,
    status: null,
  },
];

let plan: { interview: unknown; items: unknown[] };
let calls: { method: string; path: string; body?: unknown }[];
function installServer(initial: typeof plan) {
  plan = initial;
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path: input, body });
      if (input === "/api/interview/plan/interview" && method === "PUT")
        plan = { ...plan, interview: { ...interview, ...body, id: "plan-1" } };
      if (input === "/api/interview/plan/items" && method === "POST")
        plan = {
          ...plan,
          items: [
            ...plan.items,
            {
              ...body,
              id: `n${plan.items.length}`,
              done: false,
              position: plan.items.length,
              status: null,
            },
          ],
        };
      if (input.startsWith("/api/interview/plan/items/") && method === "PATCH")
        plan = {
          ...plan,
          items: plan.items.map((item) =>
            (item as { id: string }).id === input.split("/").at(-1)
              ? { ...(item as object), ...body }
              : item,
          ),
        };
      if (input.startsWith("/api/interview/plan/items/") && method === "DELETE")
        plan = {
          ...plan,
          items: plan.items.filter(
            (item) => (item as { id: string }).id !== input.split("/").at(-1),
          ),
        };
      return Response.json(plan);
    }),
  );
}

const actions: StudioActions = {
  go: vi.fn(),
  openArtifact: vi.fn(),
  openBriefing: vi.fn(),
  newQuestion: vi.fn(),
  runTests: vi.fn(),
  toggleTheme: vi.fn(),
  toggleAssistant: vi.fn(),
};
const lists: StudioLists = {
  status: "ready",
  refresh: vi.fn(),
  questions: [
    {
      artifactId: "two-sum",
      title: "Two sum",
      kind: "coding",
      language: "typescript",
      updatedAt: new Date().toISOString(),
      lastRun: { ok: false, passed: 1, total: 2, at: "" },
    },
    {
      artifactId: "fresh",
      title: "Fresh question",
      kind: "coding",
      language: null,
      updatedAt: new Date().toISOString(),
      lastRun: null,
    },
  ],
  briefings: [{ id: "pack-1", title: "Recruiter screen", updatedAt: "" }],
};

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Home", () => {
  it("asks for the next interview, then shows it with a countdown", async () => {
    installServer({ interview: null, items: [] });
    render(<HomeView actions={actions} lists={lists} />);
    const form = await screen.findByRole("form", { name: "Interview details" });
    expect(
      screen.getByText("Pick up where you left off, or start something new."),
    ).toBeVisible();
    fireEvent.change(within(form).getByLabelText("Company"), {
      target: { value: "Northwind" },
    });
    fireEvent.change(within(form).getByLabelText("Role"), {
      target: { value: "Engineer" },
    });
    fireEvent.change(within(form).getByLabelText("When"), {
      target: { value: "2030-01-02T10:00" },
    });
    fireEvent.change(within(form).getByLabelText("Topics"), {
      target: { value: "TypeScript, , React" },
    });
    fireEvent.click(
      within(form).getByRole("button", { name: "Add interview" }),
    );
    expect(await screen.findByText("Northwind · Engineer")).toBeVisible();
    expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
      id: null,
      company: "Northwind",
      durationMinutes: 60,
      topics: ["TypeScript", "React"],
      scheduledAt: new Date("2030-01-02T10:00").toISOString(),
    });
    expect(
      screen.getByText(/days until your Northwind interview/),
    ).toBeVisible();
  });

  it("edits the interview in place", async () => {
    installServer({ interview, items: [] });
    render(<HomeView actions={actions} lists={lists} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const form = screen.getByRole("form", { name: "Interview details" });
    expect(within(form).getByLabelText("Company")).toHaveValue("Northwind");
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByText("Northwind · Senior Backend Engineer"),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Format"), {
      target: { value: "system design" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
        id: "plan-1",
        format: "system design",
      }),
    );
  });

  it("works the plan: progress, statuses, ticks, opening and removing", async () => {
    installServer({ interview, items });
    render(<HomeView actions={actions} lists={lists} />);
    expect(
      await screen.findByText(
        "7 days until your Northwind interview. Here’s what’s left.",
      ),
    ).toBeVisible();
    expect(screen.getByText("1 / 4")).toBeVisible();
    expect(screen.getByText("1 of 2 tests passing")).toHaveClass("warn");
    expect(screen.getByText("Saved")).toHaveClass("good");

    const plan = screen.getByRole("region", { name: "Prep plan" });
    const opens = within(plan).getAllByRole("button", { name: "Open" });
    expect(opens).toHaveLength(3);
    fireEvent.click(opens[0]!);
    expect(actions.openArtifact).toHaveBeenCalledWith("two-sum");
    fireEvent.click(opens[1]!);
    expect(actions.openBriefing).toHaveBeenCalledWith("pack-1");
    fireEvent.click(opens[2]!);
    expect(actions.go).toHaveBeenCalledWith("rehearsal");

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Done: Read the job post" }),
    );
    await waitFor(() => expect(screen.getByText("2 / 4")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Remove Rehearse" }));
    await waitFor(() => expect(screen.queryByText("Rehearse")).toBeNull());
  });

  it("adds questions, briefings, rehearsals and tasks to the plan", async () => {
    installServer({ interview, items: [] });
    render(<HomeView actions={actions} lists={lists} />);
    const add = async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Add" }));
      return screen.getByRole("menu", { name: "Add to plan" });
    };
    fireEvent.click(
      within(await add()).getByRole("menuitem", { name: "Two sum" }),
    );
    await screen.findByText("Solve: Two sum");
    fireEvent.click(
      within(await add()).getByRole("menuitem", { name: "Recruiter screen" }),
    );
    await screen.findByText("Brief: Recruiter screen");
    fireEvent.click(
      within(await add()).getByRole("menuitem", { name: "A timed rehearsal" }),
    );
    await screen.findByText("Do a timed rehearsal");
    const menu = await add();
    fireEvent.change(within(menu).getByLabelText("New task"), {
      target: { value: "Sleep well" },
    });
    fireEvent.submit(within(menu).getByLabelText("New task"));
    await screen.findByText("Sleep well");
    expect(
      calls.filter((call) => call.method === "POST").map((call) => call.body),
    ).toEqual([
      { kind: "question", ref: "two-sum", title: "Solve: Two sum" },
      { kind: "briefing", ref: "pack-1", title: "Brief: Recruiter screen" },
      { kind: "rehearsal", ref: null, title: "Do a timed rehearsal" },
      { kind: "task", ref: null, title: "Sleep well" },
    ]);
  });

  it("shows each question's last run and opens it", async () => {
    installServer({ interview: null, items: [] });
    render(<HomeView actions={actions} lists={lists} />);
    const rows = await screen.findAllByRole("button", {
      name: /Two sum|Fresh question/,
    });
    expect(within(rows[0]!).getByText("1 / 2 tests")).toBeVisible();
    expect(within(rows[1]!).getByText("In progress")).toBeVisible();
    fireEvent.click(rows[0]!);
    expect(actions.openArtifact).toHaveBeenCalledWith("two-sum");
  });

  it("offers a retry when the plan cannot load", async () => {
    installServer({ interview: null, items: [] });
    vi.mocked(fetch).mockImplementationOnce(async () =>
      Response.json({ error: { code: "unauthorized" } }, { status: 401 }),
    );
    render(<HomeView actions={actions} lists={lists} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("unauthorized");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("form", { name: "Interview details" }),
    ).toBeVisible();
  });
});

describe("helpers", () => {
  it("reads run outcomes", () => {
    expect(
      runStatus({ lastRun: { ok: true, passed: 3, total: 3, at: "" } }),
    ).toMatchObject({
      label: "Passed",
      tone: "good",
    });
    expect(
      runStatus({ lastRun: { ok: true, passed: null, total: null, at: "" } })
        .label,
    ).toBe("Passed");
    expect(
      runStatus({ lastRun: { ok: false, passed: null, total: null, at: "" } })
        .label,
    ).toBe("Tests failing");
    expect(runStatus({}).label).toBe("In progress");
  });

  it("counts calendar days until a date", () => {
    const now = new Date("2026-10-01T23:00:00").getTime();
    expect(daysUntil(null, now)).toBeNull();
    expect(daysUntil(new Date("2026-10-02T01:00:00").toISOString(), now)).toBe(
      1,
    );
    expect(daysUntil(new Date("2026-10-01T08:00:00").toISOString(), now)).toBe(
      0,
    );
  });
});
