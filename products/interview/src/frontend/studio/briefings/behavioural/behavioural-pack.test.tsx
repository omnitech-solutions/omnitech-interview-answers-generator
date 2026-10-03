import type {
  BriefingDraft,
  BriefingQuestion,
  CandidateMatrix,
} from "@omnitech/interview-contracts";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioContext, type StudioViewBinding } from "../../context";
import { BehaviouralPack } from "./behavioural-pack";

vi.mock("../../../markdown-content", () => ({
  MarkdownContent: ({ children }: { children: string }) => (
    <div>{children}</div>
  ),
}));

const SHA = "a".repeat(64);
const matrix: CandidateMatrix = {
  candidate: { name: "Sam" },
  roles: [
    {
      company: "Relay",
      title: "Principal Engineer",
      period: "2021–2024",
      technologies: ["TypeScript", "PostgreSQL"],
    },
    { company: "Helcim", title: "Senior Engineer", technologies: ["Ruby"] },
  ],
  story_selector: [{ need: "leadership", primary_story: "Relay" }],
};
const profiles = [
  {
    id: "local-experience-matrix",
    name: "My matrix",
    revision: 3,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "lead",
    name: "Leadership matrix",
    revision: 1,
    updatedAt: new Date().toISOString(),
  },
];

function answer(question: string, id: string): BriefingQuestion {
  return {
    id,
    question,
    category: "background",
    answerMarkdown: `Answer to ${question}`,
    talkingPoints: ["One", "Two", "Three"],
    evidenceRefs: [
      {
        id: "local-experience-matrix",
        revision: 3,
        sha256: SHA,
        pointer: "/roles/0/technologies/0",
        quote: "TypeScript",
        sourceKind: "candidate",
      },
    ],
    gaps: [],
  };
}

const prepared: NonNullable<BriefingDraft["prepared"]> = {
  call: {
    summary: "Should we put you in front of Engineering?",
    detail: "A conversation, not an exam.",
  },
  agenda: [
    { minutes: 5, topic: "Introductions" },
    { minutes: 7, topic: "Career overview" },
  ],
  interviewer: {
    note: "New to the company; expect a structured screen.",
    goodToAsk: ["Team matching", "Timeline"],
    saveForLater: "Save deep architecture questions for Engineering.",
  },
  positioning: {
    steps: ["Hands-on technical leader", "TypeScript · Node · React"],
    note: "Lead with the positioning, not years.",
  },
  fit: {
    strong: ["TypeScript", "PostgreSQL"],
    watch: [
      { topic: "DORA metrics", answer: "Know the signals; don’t bluff." },
    ],
  },
  teams: [
    { name: "Payments", owns: ["Checkout"], means: "Retries and idempotency." },
  ],
  compensation: {
    summary: "Compensation is published",
    advice: "Aim for the upper part of the range.",
  },
  pipeline: {
    stages: ["Recruiter", "Hiring manager"],
    later: ["System design"],
  },
  stories: [
    {
      title: "Payments retries",
      shape: "Problem → decision → outcome",
      covers: ["A project you’re proud of"],
      roleId: "/roles/0",
    },
  ],
  ask: [
    {
      title: "Ask in this call",
      note: "Four is plenty.",
      items: [
        { question: "How does team matching work?", why: "Core or Payments." },
      ],
    },
  ],
  watchOuts: [
    {
      kind: "caution",
      title: "Don’t bluff DORA",
      detail: "Be honest about how formally you measured it.",
      sayInstead: "I know the signals well.",
    },
  ],
  evidenceRefs: [],
  gaps: ["Check the bonus wording."],
};
let pack: BriefingDraft | null;
let revision: number;
// What the pack sends; only the fields these tests read.
type Sent = {
  expectedRevision?: number;
  briefing?: BriefingDraft;
  question?: string;
  replaceId?: string;
  name?: string;
};
let calls: { method: string; path: string; body?: Sent }[];
let failAsk: string | null;
// When set, a write from an older revision is refused, as the server does.
let strictRevisions = false;
// When set, packs come back with object keys in Postgres jsonb order (shorter
// keys first, then bytewise), as the real server returns them.
let storedOrder = false;
const jsonbOrder = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(jsonbOrder)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) =>
              a.length === b.length ? (a < b ? -1 : 1) : a.length - b.length,
            )
            .map(([key, item]) => [key, jsonbOrder(item)]),
        )
      : value;
const envelope = () => ({
  origin: {
    workspaceId: "briefings",
    artifactId: "prep-1",
    artifactRevision: revision,
  },
  value: {
    question: pack!.title,
    notes: "",
    answer: null,
    briefing: storedOrder ? jsonbOrder(pack) : pack,
  },
  updatedAt: new Date().toISOString(),
  provenance: null,
});

function installServer() {
  calls = [];
  failAsk = null;
  strictRevisions = false;
  storedOrder = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = input.replace("/api/interview/briefing", "");
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      if (path === "/profiles" && method === "GET")
        return Response.json({ profiles });
      if (path === "/profiles" && method === "POST")
        return Response.json({
          id: "imported",
          name: body.name,
          revision: 1,
          sha256: SHA,
        });
      if (path.startsWith("/profiles/"))
        return Response.json({
          id: "local-experience-matrix",
          name: "My matrix",
          revision: 3,
          sha256: SHA,
          matrix,
        });
      if (path.endsWith("/ask")) {
        if (body.question === failAsk)
          return Response.json(
            {
              error: {
                code: "generation-failed",
                message:
                  "The model could not be reached or did not reply in time.",
              },
            },
            { status: 503 },
          );
        const questions = pack!.questions;
        pack = {
          ...pack!,
          questions: body.replaceId
            ? questions.map((item) =>
                item.id === body.replaceId
                  ? {
                      ...answer(body.question, item.id),
                      answerMarkdown: "A fresh draft",
                    }
                  : item,
              )
            : [...questions, answer(body.question, `q${questions.length + 1}`)],
        };
        revision += 1;
        return Response.json(envelope());
      }
      if (path.endsWith("/prepare")) {
        pack = { ...pack!, prepared };
        revision += 1;
        return Response.json(envelope());
      }
      if (path.endsWith("/save"))
        return Response.json({
          workspaceId: "briefings",
          artifactId: "prep-1",
          savedRevision: 1,
          draftRevision: revision,
          value: envelope().value,
          createdAt: new Date().toISOString(),
          provenance: null,
        });
      if (method === "PUT") {
        if (strictRevisions && body.expectedRevision !== revision)
          return Response.json(
            { error: { code: "revision-conflict" } },
            { status: 409 },
          );
        pack = body.briefing;
        revision += 1;
        return Response.json(envelope());
      }
      if (method === "GET" && pack) return Response.json(envelope());
      return Response.json({ error: { code: "not-found" } }, { status: 404 });
    }),
  );
}

const handlers = () => ({
  onCreated: vi.fn(),
  onDraftStarted: vi.fn(),
  onChanged: vi.fn(),
  onDirtyChange: vi.fn(),
});

beforeEach(() => {
  pack = null;
  revision = 0;
  localStorage.clear();
  installServer();
});
afterEach(() => vi.unstubAllGlobals());

describe("a new behavioural pack", () => {
  it("defaults to your matrix and the stage's usual questions", async () => {
    render(<BehaviouralPack artifactId={null} {...handlers()} />);
    expect(await screen.findByText("My matrix")).toBeVisible();
    expect(screen.getByText("Default")).toBeVisible();
    expect(screen.getByLabelText("Question 1")).toHaveValue(
      "Tell me about yourself and your background.",
    );
    // The company fills in, and another stage brings its own questions.
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "Northwind" },
    });
    expect(screen.getByLabelText("Question 2")).toHaveValue("Why Northwind?");
    fireEvent.click(screen.getByRole("radio", { name: "Final round" }));
    expect(screen.getByLabelText("Question 1")).toHaveValue(
      "Why should we hire you?",
    );
    expect(
      screen.getByText("Motivation, fit and your closing questions."),
    ).toBeVisible();
  });

  it("ranks the matrix's roles against the role and lets you lean on some", async () => {
    render(<BehaviouralPack artifactId={null} {...handlers()} />);
    fireEvent.change(await screen.findByLabelText("Role"), {
      target: { value: "Principal TypeScript engineer" },
    });
    const relay = await screen.findByRole("button", { name: /Relay/ });
    expect(within(relay).getByText(/%$/)).toBeVisible();
    fireEvent.click(relay);
    expect(relay).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/1 selected/)).toBeVisible();
  });

  it("creates the pack with its context and questions, then opens it", async () => {
    const props = handlers();
    render(<BehaviouralPack artifactId={null} {...props} />);
    await screen.findByText("My matrix");
    const draft = screen.getByRole("button", { name: "Draft answers" });
    expect(draft).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "Northwind" },
    });
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "Tech Lead" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Job posting/ }));
    fireEvent.change(screen.getByLabelText("Job description"), {
      target: { value: "Lead the payments team." },
    });
    fireEvent.click(draft);
    await waitFor(() =>
      expect(props.onCreated).toHaveBeenCalledWith(
        expect.stringMatching(/^prep-/),
      ),
    );
    const created = calls.find((call) => call.method === "PUT")!.body!;
    expect(created.expectedRevision).toBe(0);
    expect(created.briefing).toMatchObject({
      title: "Northwind · Tech Lead",
      context: {
        company: "Northwind",
        role: "Tech Lead",
        stage: "recruiter",
        durationMinutes: 30,
        jobDescription: "Lead the payments team.",
        profile: { id: "local-experience-matrix", revision: 3 },
      },
      questions: [],
    });
    expect(created.briefing!.expected).toHaveLength(10);
  });

  it("imports another matrix from pasted JSON, with a preview", async () => {
    render(<BehaviouralPack artifactId={null} {...handlers()} />);
    fireEvent.click(await screen.findByRole("button", { name: /My matrix/ }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Import from JSON…" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Import an experience matrix",
    });
    fireEvent.change(within(dialog).getByLabelText("Matrix JSON"), {
      target: { value: "{ nope" },
    });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "That isn’t valid JSON.",
    );
    fireEvent.change(within(dialog).getByLabelText("Matrix JSON"), {
      target: { value: JSON.stringify(matrix) },
    });
    expect(
      within(dialog).getByText("1 role has no dates. They’ll still be used."),
    ).toBeVisible();
    fireEvent.click(
      within(dialog).getByLabelText("Make this my default matrix"),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Import matrix" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      calls.find((call) => call.method === "POST" && call.path === "/profiles")
        ?.body,
    ).toMatchObject({
      name: "Sam’s matrix",
    });
    expect(localStorage.getItem("omnitech.interview.default-matrix")).toBe(
      "imported",
    );
  });
});

describe("an open pack", () => {
  const context = {
    company: "Northwind",
    role: "Tech Lead",
    stage: "recruiter" as const,
    profile: { id: "local-experience-matrix", revision: 3 },
  };

  it("drafts each expected answer as it arrives, then prepares the briefing", async () => {
    pack = {
      kind: "non-technical-briefing",
      title: "Northwind · Tech Lead",
      context,
      expected: ["Tell me about yourself.", "Why Northwind?"],
      questions: [],
    };
    revision = 1;
    failAsk = "Why Northwind?";
    const props = handlers();
    render(<BehaviouralPack artifactId="prep-1" autoDraft {...props} />);
    expect(await screen.findByText("Tell me about yourself.")).toBeVisible();
    expect(props.onDraftStarted).toHaveBeenCalled();
    // A failed answer says why, on its own row; the others still arrive.
    expect(
      await screen.findByText(
        "The model could not be reached or did not reply in time.",
      ),
    ).toBeVisible();
    await waitFor(() =>
      expect(calls.some((call) => call.path.endsWith("/prepare"))).toBe(true),
    );
    const asks = calls.filter((call) => call.path.endsWith("/ask"));
    expect(asks.map((call) => call.body?.question)).toEqual([
      "Tell me about yourself.",
      "Why Northwind?",
    ]);
    expect(asks[0]!.body?.expectedRevision).toBe(1);

    // The answer shows its talking points and where it came from.
    expect(screen.getByText("Answer to Tell me about yourself.")).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: "Relay" }));
    expect(screen.getByText("Principal Engineer · 2021–2024")).toBeVisible();
    expect(screen.getByText("TypeScript", { selector: "q" })).toBeVisible();

    // The prepared briefing is shown as cards across its tabs.
    fireEvent.click(screen.getByRole("tab", { name: /Overview/ }));
    expect(
      await screen.findByText("Should we put you in front of Engineering?"),
    ).toBeVisible();
    expect(screen.getByText("0–5")).toBeVisible();
    expect(screen.getByText("Career overview")).toBeVisible();
    expect(screen.getByText("Hands-on technical leader")).toBeVisible();
    expect(
      screen.getByText("TypeScript", { selector: ".bp-chip" }),
    ).toBeVisible();
    expect(screen.getByText("DORA metrics")).toBeVisible();
    expect(screen.getByText("Payments")).toBeVisible();
    expect(screen.getByText("Check the bonus wording.")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "See the salary answer" }),
    );
    expect(screen.getByRole("tab", { name: /Answers/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("tab", { name: /Stories/ }));
    expect(screen.getByText("Payments retries")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Role for Payments retries"), {
      target: { value: "/roles/1" },
    });
    await waitFor(() =>
      expect(pack!.prepared!.stories[0]!.roleId).toBe("/roles/1"),
    );

    fireEvent.click(screen.getByRole("tab", { name: /Ask them/ }));
    expect(screen.getByText("How does team matching work?")).toBeVisible();
    fireEvent.click(
      screen.getByLabelText("Asked: How does team matching work?"),
    );
    await waitFor(() =>
      expect(pack!.prepared!.ask[0]!.items[0]!.asked).toBe(true),
    );

    fireEvent.click(screen.getByRole("tab", { name: /Watch-outs/ }));
    expect(screen.getByText("Don’t bluff DORA")).toBeVisible();
    expect(screen.getByText("I know the signals well.")).toBeVisible();
  });

  it("accepts, redrafts and answers a new question on the fly, then saves", async () => {
    pack = {
      kind: "non-technical-briefing",
      title: "Northwind · Tech Lead",
      context,
      expected: ["Tell me about yourself."],
      questions: [answer("Tell me about yourself.", "q1")],
    };
    revision = 4;
    render(<BehaviouralPack artifactId="prep-1" {...handlers()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(screen.getByText("1 / 1 accepted")).toBeVisible(),
    );
    const accepted = calls.filter((call) => call.method === "PUT").at(-1)!
      .body!;
    expect(accepted.briefing!.questions[0]!.accepted).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "New draft" }));
    expect(await screen.findByText("A fresh draft")).toBeVisible();
    expect(
      calls.filter((call) => call.path.endsWith("/ask")).at(-1)?.body,
    ).toMatchObject({
      replaceId: "q1",
    });

    fireEvent.change(screen.getByLabelText("Ask another question"), {
      target: { value: "What are your salary expectations?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Answer it" }));
    expect(
      await screen.findByText("Answer to What are your salary expectations?"),
    ).toBeVisible();
    expect(pack!.expected).toContain("What are your salary expectations?");

    fireEvent.click(screen.getByRole("button", { name: "Save pack" }));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();
  });

  it("reloads and retries a write when another tab moved the pack on", async () => {
    pack = {
      kind: "non-technical-briefing",
      title: "Northwind · Tech Lead",
      context,
      expected: ["Tell me about yourself."],
      questions: [answer("Tell me about yourself.", "q1")],
    };
    revision = 4;
    strictRevisions = true;
    render(<BehaviouralPack artifactId="prep-1" {...handlers()} />);
    const accept = await screen.findByRole("button", { name: "Accept" });
    // Another tab answers a new question meanwhile.
    pack = {
      ...pack,
      expected: [...pack.expected!, "Why Northwind?"],
      questions: [...pack.questions, answer("Why Northwind?", "q2")],
    };
    revision = 6;
    fireEvent.click(accept);
    await waitFor(() =>
      expect(screen.getByText("1 / 2 accepted")).toBeVisible(),
    );
    const puts = calls.filter((call) => call.method === "PUT");
    expect(puts.map((call) => call.body!.expectedRevision)).toEqual([4, 6]);
    expect(pack.questions.map((item) => item.id)).toEqual(["q1", "q2"]);
    expect(pack.questions[0]!.accepted).toBe(true);
    expect(screen.queryByText(/couldn’t be saved/)).toBeNull();
  });

  it("is not left with unsaved changes after accepting all answers", async () => {
    pack = {
      kind: "non-technical-briefing",
      title: "Northwind · Tech Lead",
      context: {
        ...context,
        request: "Prepare me for a conversation.",
        interviewer: "Sam",
        interviewerTitle: "Recruiter",
        durationMinutes: 30,
        jobDescription: "Lead the Payments team.",
      },
      expected: ["Tell me about yourself.", "Why Northwind?"],
      questions: [
        answer("Tell me about yourself.", "q1"),
        answer("Why Northwind?", "q2"),
      ],
    };
    revision = 2;
    storedOrder = true;
    const props = handlers();
    render(<BehaviouralPack artifactId="prep-1" {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept all" }));
    await waitFor(() =>
      expect(pack!.questions.every((item) => item.accepted)).toBe(true),
    );
    // Past the autosave pause: nothing is left to save, so leaving is free.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("edits, practises and reviews answers, and edits the setup in place", async () => {
    pack = {
      kind: "non-technical-briefing",
      title: "Northwind · Tech Lead",
      context,
      expected: ["Tell me about yourself.", "Why Northwind?"],
      questions: [
        answer("Tell me about yourself.", "q1"),
        answer("Why Northwind?", "q2"),
      ],
    };
    revision = 2;
    const props = handlers();
    render(<BehaviouralPack artifactId="prep-1" {...props} />);
    // Editing an answer saves it and asks for another review.
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Answer"), {
      target: { value: "My own words." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(pack!.questions[0]!.answerMarkdown).toBe("My own words."),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Answer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Practise" }));
    expect(
      screen.getByRole("button", { name: "Stop practising" }),
    ).toBeVisible();

    // Another answer opens; the first closes. Accept all accepts both.
    fireEvent.click(screen.getByRole("button", { name: /Why Northwind\?/ }));
    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));
    await waitFor(() =>
      expect(pack!.questions.every((item) => item.accepted)).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Accepted" }));
    await waitFor(() => expect(pack!.questions[1]!.accepted).toBe(false));

    // Setup changes are written after a pause, keeping the answers.
    fireEvent.click(screen.getByRole("button", { name: "Edit setup" }));
    fireEvent.change(screen.getByLabelText("Interviewer"), {
      target: { value: "Johnnie" },
    });
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(pack!.context.interviewer).toBe("Johnnie"), {
      timeout: 2000,
    });
    expect(pack!.questions).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    // Changing the questions drops answers to removed ones, drafts new ones.
    fireEvent.click(screen.getByRole("button", { name: "Change questions" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove question 2" }));
    fireEvent.change(screen.getByLabelText("Add a question"), {
      target: { value: "When could you start?" },
    });
    fireEvent.keyDown(screen.getByLabelText("Add a question"), {
      key: "Enter",
    });
    fireEvent.change(screen.getByLabelText("Question 1"), {
      target: { value: "Tell me about yourself." },
    });
    expect(screen.getByText("Logistics")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Draft answers" }));
    expect(
      await screen.findByRole("button", { name: /When could you start\?/ }),
    ).toBeVisible();
    expect(screen.getByText("My own words.")).toBeVisible();
    expect(pack!.questions.map((item) => item.question)).toEqual([
      "Tell me about yourself.",
      "When could you start?",
    ]);
  });

  it("switches matrix, makes it the default and resets suggestions", async () => {
    render(<BehaviouralPack artifactId={null} {...handlers()} />);
    fireEvent.click(await screen.findByRole("button", { name: /My matrix/ }));
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: /Leadership matrix/ }),
    );
    expect(
      screen.getByRole("button", { name: /Leadership matrix/ }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Leadership matrix/ }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Make this my default" }),
    );
    expect(localStorage.getItem("omnitech.interview.default-matrix")).toBe(
      "lead",
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove question 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Question 1")).toHaveValue(
      "Tell me about yourself and your background.",
    );
    // A matrix file can be chosen instead of pasted.
    fireEvent.click(screen.getByRole("button", { name: /Leadership matrix/ }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Import from JSON…" }),
    );
    const file = new File([JSON.stringify(matrix)], "lead.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByLabelText("Matrix JSON file"), {
      target: { files: [file] },
    });
    expect(await screen.findByText("lead.json")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lends the assistant this pack, and reloads after an applied edit", async () => {
    pack = {
      kind: "non-technical-briefing",
      title: "Northwind · Tech Lead",
      context,
      expected: ["Tell me about yourself."],
      questions: [answer("Tell me about yourself.", "q1")],
    };
    revision = 7;
    const bound: StudioViewBinding[] = [];
    const unbind = vi.fn();
    const studio = {
      theme: "light" as const,
      toggleTheme: vi.fn(),
      headerSlot: null,
      bindView: (binding: StudioViewBinding) => {
        bound.push(binding);
        return unbind;
      },
      refreshLists: vi.fn(),
      setFocus: vi.fn(),
    };
    const { unmount } = render(
      <StudioContext.Provider value={studio}>
        <BehaviouralPack artifactId="prep-1" {...handlers()} />
      </StudioContext.Provider>,
    );
    await waitFor(() => expect(bound.length).toBeGreaterThan(0));
    const binding = bound.at(-1)!;
    expect(binding.origin).toEqual({
      workspaceId: "briefings",
      artifactId: "prep-1",
      artifactRevision: 7,
    });
    expect(binding.assistant?.sees).toBe("this preparation pack");
    expect(await binding.hooks!.current.prepareSend!()).toEqual({
      workspaceId: "briefings",
      artifactId: "prep-1",
      artifactRevision: 7,
    });

    // The assistant applied an edit on the server: the pack shows it.
    pack = {
      ...pack,
      questions: [
        { ...pack.questions[0]!, answerMarkdown: "Edited by the assistant" },
      ],
    };
    revision = 8;
    await binding.hooks!.current.onApplied!({} as never, {} as never);
    expect(await screen.findByText("Edited by the assistant")).toBeVisible();
    await waitFor(() => expect(bound.at(-1)!.origin?.artifactRevision).toBe(8));
    unmount();
    expect(unbind).toHaveBeenCalled();
  });
});
