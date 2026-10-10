import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { StrictMode } from "react";
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
  openBrief: vi.fn(),
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
  briefs: [],
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

  it("opens a new question and starts a rehearsal from the header", async () => {
    installServer({ interview: null, items: [] });
    render(<HomeView actions={actions} lists={lists} />);
    await screen.findByRole("form", { name: "Interview details" });
    fireEvent.click(screen.getByRole("button", { name: "New question" }));
    expect(actions.newQuestion).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Start a rehearsal" }));
    expect(actions.go).toHaveBeenCalledWith("rehearsal");
    expect(
      within(screen.getByRole("region", { name: "Prep plan" })).getByText(
        "Add the interview you’re preparing for, then plan the work for it.",
      ),
    ).toBeVisible();
  });

  it("shows an empty question list and retries a failed question list", async () => {
    installServer({ interview, items: [] });
    const { rerender } = render(
      <HomeView actions={actions} lists={{ ...lists, questions: [] }} />,
    );
    expect(
      screen.getByText("No questions yet. Start with “New question”."),
    ).toBeVisible();
    rerender(
      <HomeView
        actions={actions}
        lists={{ ...lists, status: "error", questions: [] }}
      />,
    );
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("Couldn’t load your questions.");
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    expect(lists.refresh).toHaveBeenCalledTimes(1);
    await screen.findByRole("region", { name: "Upcoming interview" });
  });

  it("limits Continue to eight questions", async () => {
    installServer({ interview: null, items: [] });
    render(
      <HomeView
        actions={actions}
        lists={{
          ...lists,
          questions: Array.from({ length: 9 }, (_, index) => ({
            ...lists.questions[0]!,
            artifactId: `q${index}`,
            title: `Question ${index}`,
          })),
        }}
      />,
    );
    const section = screen.getByRole("region", { name: "Continue" });
    expect(within(section).getAllByRole("button")).toHaveLength(8);
    expect(
      within(section).queryByRole("button", { name: /Question 8/ }),
    ).toBeNull();
    fireEvent.click(
      within(section).getByRole("button", { name: /Question 7/ }),
    );
    expect(actions.openArtifact).toHaveBeenCalledWith("q7");
    await screen.findByRole("form", { name: "Interview details" });
  });

  it("keeps required interview fields invalid and saves optional empty fields as null", async () => {
    installServer({ interview: null, items: [] });
    render(<HomeView actions={actions} lists={lists} />);
    const form = await screen.findByRole("form", { name: "Interview details" });
    expect(
      within(form).getByRole("textbox", { name: "Company" }),
    ).toBeInvalid();
    expect(within(form).getByRole("textbox", { name: "Role" })).toBeInvalid();
    fireEvent.change(within(form).getByRole("textbox", { name: "Company" }), {
      target: { value: "  Northwind  " },
    });
    fireEvent.change(within(form).getByRole("textbox", { name: "Role" }), {
      target: { value: "  Engineer  " },
    });
    fireEvent.change(
      within(form).getByRole("spinbutton", { name: "Minutes" }),
      { target: { value: "" } },
    );
    fireEvent.click(
      within(form).getByRole("button", { name: "Add interview" }),
    );
    await screen.findByText("Northwind · Engineer");
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
      id: null,
      company: "Northwind",
      role: "Engineer",
      scheduledAt: null,
      durationMinutes: null,
      format: "",
      topics: [],
    });
  });

  it("unticks a completed item and updates the accessible progress value", async () => {
    installServer({ interview, items });
    render(<HomeView actions={actions} lists={lists} />);
    const tick = await screen.findByRole("checkbox", {
      name: "Done: Brief: recruiter",
    });
    expect(tick).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("progressbar", { name: "Prep plan done" }),
    ).toHaveAttribute("aria-valuenow", "1");
    fireEvent.click(tick);
    await waitFor(() => expect(tick).toHaveAttribute("aria-checked", "false"));
    expect(
      screen.getByRole("progressbar", { name: "Prep plan done" }),
    ).toHaveAttribute("aria-valuenow", "0");
    expect(
      screen.getByRole("progressbar", { name: "Prep plan done" }),
    ).toHaveAttribute("aria-valuemax", "4");
    expect(calls.find((call) => call.method === "PATCH")).toEqual({
      method: "PATCH",
      path: "/api/interview/plan/items/i2",
      body: { done: false },
    });
  });

  it("ignores an empty task, trims a task, and closes the add menu outside it", async () => {
    installServer({ interview, items: [] });
    render(<HomeView actions={actions} lists={lists} />);
    const add = await screen.findByRole("button", { name: "Add" });
    fireEvent.click(add);
    const task = within(
      screen.getByRole("menu", { name: "Add to plan" }),
    ).getByRole("textbox", { name: "New task" });
    fireEvent.change(task, { target: { value: "   " } });
    fireEvent.submit(task);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
    expect(add).toHaveAttribute("aria-expanded", "true");
    fireEvent.mouseDown(screen.getByRole("button", { name: "New question" }));
    expect(screen.queryByRole("menu", { name: "Add to plan" })).toBeNull();
    expect(add).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(add);
    const next = screen.getByRole("textbox", { name: "New task" });
    fireEvent.change(next, { target: { value: "  Sleep well  " } });
    fireEvent.submit(next);
    await screen.findByText("Sleep well");
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      kind: "task",
      ref: null,
      title: "Sleep well",
    });
    expect(screen.queryByRole("menu", { name: "Add to plan" })).toBeNull();
  });

  it("reports a failed plan mutation without losing the existing items", async () => {
    installServer({ interview, items });
    render(<HomeView actions={actions} lists={lists} />);
    await screen.findByRole("checkbox", { name: "Done: Read the job post" });
    vi.mocked(fetch).mockImplementationOnce(async () =>
      Response.json({ error: { code: "write-failed" } }, { status: 500 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Rehearse" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("write-failed");
    expect(
      screen.getByRole("checkbox", { name: "Done: Rehearse" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("1 / 4")).toBeVisible();
  });

  it("drops a late initial load after its effect was cancelled", async () => {
    installServer({ interview, items: [] });
    let release: (response: Response) => void = () => undefined;
    let signal: AbortSignal | null | undefined;
    vi.mocked(fetch).mockImplementationOnce((_path, init) => {
      signal = init?.signal;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    render(
      <StrictMode>
        <HomeView actions={actions} lists={lists} />
      </StrictMode>,
    );
    expect(
      await screen.findByText("Northwind · Senior Backend Engineer"),
    ).toBeVisible();
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      release(
        Response.json({
          interview: { ...interview, company: "Outdated company" },
          items: [],
        }),
      ),
    );
    expect(
      screen.queryByText("Outdated company · Senior Backend Engineer"),
    ).toBeNull();
    expect(
      screen.getByText("Northwind · Senior Backend Engineer"),
    ).toBeVisible();
  });

  it("trims interview copy and caps topics at twelve", async () => {
    installServer({ interview: null, items: [] });
    render(<HomeView actions={actions} lists={lists} />);
    const form = await screen.findByRole("form", { name: "Interview details" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Company" }), {
      target: { value: "Northwind" },
    });
    fireEvent.change(within(form).getByRole("textbox", { name: "Role" }), {
      target: { value: "Engineer" },
    });
    fireEvent.change(within(form).getByRole("textbox", { name: "Format" }), {
      target: { value: "  System design  " },
    });
    const topics = Array.from(
      { length: 15 },
      (_, index) => `Topic ${index + 1}`,
    );
    fireEvent.change(within(form).getByRole("textbox", { name: "Topics" }), {
      target: { value: topics.map((topic) => ` ${topic} `).join(",,") },
    });
    fireEvent.click(
      within(form).getByRole("button", { name: "Add interview" }),
    );
    await screen.findByText("Northwind · Engineer");
    expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
      format: "System design",
      topics: topics.slice(0, 12),
    });
    const card = screen.getByRole("region", { name: "Upcoming interview" });
    expect(within(card).getByText("Topic 12")).toBeVisible();
    expect(within(card).queryByText("Topic 13")).toBeNull();
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
