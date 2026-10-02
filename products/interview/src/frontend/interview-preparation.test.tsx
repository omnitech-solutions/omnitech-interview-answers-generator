import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { InterviewPreparation } from "./interview-preparation";

const matrix = {
  candidate: { name: "Alex" },
  roles: [{ company: "Acme", title: "Lead", proof_points: ["Launch"] }],
};
const question = {
  id: "q1",
  question: "Tell me about yourself",
  category: "background",
  answerMarkdown: "A delivery leader",
  talkingPoints: ["Scope", "Team", "Outcome"],
  evidenceRefs: [],
  gaps: [],
};
const draft = {
  kind: "non-technical-briefing",
  title: "Acme interview",
  context: {
    company: "Acme",
    role: "Engineering Manager",
    stage: "hiring-manager",
    profile: { id: "profile-1", revision: 1 },
  },
  questions: [question],
};

function json(body: unknown, status = 200) {
  // Complete each synthetic network response to the public briefing response contract.
  const value = body as {
    profiles?: Array<Record<string, unknown>>;
    artifacts?: Array<Record<string, unknown>>;
    origin?: Record<string, unknown>;
    value?: { briefing?: typeof draft };
    matrix?: unknown;
    id?: string;
    name?: string;
    revision?: number;
    savedRevision?: number;
    draftRevision?: number;
  };
  let complete = body;
  if (status < 400 && Array.isArray(value.profiles)) {
    complete = {
      profiles: value.profiles.map((profile: Record<string, unknown>) => ({
        ...profile,
        updatedAt: "2026-10-01T00:00:00.000Z",
      })),
    };
  } else if (status < 400 && Array.isArray(value.artifacts)) {
    complete = {
      artifacts: value.artifacts.map((artifact: Record<string, unknown>) => ({
        savedRevision: 0,
        updatedAt: "2026-10-01T00:00:00.000Z",
        ...artifact,
      })),
    };
  } else if (status < 400 && value.origin && value.value) {
    const briefing = value.value.briefing as typeof draft;
    complete = {
      origin: {
        workspaceId: "briefings",
        artifactId: "preparation",
        ...value.origin,
      },
      value: { question: briefing.title, notes: "", answer: null, briefing },
      updatedAt: "2026-10-01T00:00:00.000Z",
      provenance: null,
    };
  } else if (status < 400 && value.matrix && value.id) {
    complete = { ...value, sha256: "a".repeat(64) };
  } else if (
    status < 400 &&
    value.savedRevision !== undefined &&
    value.draftRevision !== undefined
  ) {
    const savedBriefing = value.value?.briefing ?? draft;
    complete = {
      workspaceId: "briefings",
      artifactId: "preparation",
      savedRevision: value.savedRevision,
      draftRevision: value.draftRevision,
      value: {
        question: savedBriefing.title,
        notes: "",
        answer: null,
        briefing: savedBriefing,
      },
      createdAt: "2026-10-01T00:00:00.000Z",
      provenance: null,
    };
  } else if (
    status < 400 &&
    value.id &&
    value.name &&
    value.revision !== undefined
  ) {
    complete = { ...value, sha256: "a".repeat(64) };
  }
  return Promise.resolve(
    new Response(JSON.stringify(complete), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

it("previews a pasted matrix and imports only after confirmation", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      calls.push({ path, init });
      if (
        new URL(path, "http://local").pathname.endsWith("/profiles") &&
        init?.method === "POST"
      )
        return json({ id: "profile-1", name: "My matrix", revision: 1 });
      if (new URL(path, "http://local").pathname.endsWith("/profiles"))
        return json({ profiles: [] });
      if (
        new URL(path, "http://local").pathname.endsWith(
          "/artifacts/preparation",
        )
      )
        return json({ error: { code: "not-found" } }, 404);
      if (
        new URL(path, "http://local").pathname.endsWith(
          "/profiles/profile-1/revisions/1",
        )
      )
        return json({
          id: "profile-1",
          name: "My matrix",
          revision: 1,
          matrix,
        });
      if (new URL(path, "http://local").pathname.endsWith("/artifacts"))
        return json({ artifacts: [] });
      throw new Error(path);
    }),
  );
  render(<InterviewPreparation />);
  await screen.findByText(/No profile selected\. Paste/i);
  fireEvent.change(screen.getByLabelText(/Paste matrix JSON/i), {
    target: { value: JSON.stringify(matrix) },
  });
  await userEvent.click(
    screen.getByRole("button", { name: /Preview matrix/i }),
  );
  expect(
    within(screen.getByLabelText("Matrix preview")).getByText(/Launch/),
  ).toBeVisible();
  expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText(/Paste matrix JSON/i), {
    target: { value: "{}" },
  });
  expect(
    screen.queryByRole("button", { name: "Confirm import" }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Paste matrix JSON/i), {
    target: { value: JSON.stringify(matrix) },
  });
  await userEvent.click(
    screen.getByRole("button", { name: /Preview matrix/i }),
  );
  await userEvent.type(screen.getByLabelText(/Profile name/i), "My matrix");
  await userEvent.click(
    screen.getByRole("button", { name: /Confirm import/i }),
  );
  await waitFor(() =>
    expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(
      1,
    ),
  );
  expect(
    JSON.parse(
      String(calls.find((call) => call.init?.method === "POST")?.init?.body),
    ),
  ).toEqual({ name: "My matrix", matrix });
});

it("generates a proposal, applies it, and explicitly saves the complete pack", async () => {
  const methods: string[] = [];
  let created = false;
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      methods.push(`${method} ${path}`);
      if (new URL(path, "http://local").pathname.endsWith("/profiles"))
        return json({
          profiles: [{ id: "profile-1", name: "My matrix", revision: 1 }],
        });
      if (
        new URL(path, "http://local").pathname.endsWith(
          "/artifacts/preparation/proposals",
        )
      )
        return json({ id: "proposal-1", baseRevision: 1, briefing: draft });
      if (
        new URL(path, "http://local").pathname.endsWith(
          "/artifacts/preparation/apply",
        )
      )
        return json({
          origin: { artifactRevision: 2 },
          value: { briefing: draft },
        });
      if (
        new URL(path, "http://local").pathname.endsWith(
          "/artifacts/preparation/save",
        )
      )
        return json({ id: "preparation", savedRevision: 1, draftRevision: 2 });
      if (
        new URL(path, "http://local").pathname.endsWith(
          "/artifacts/preparation",
        ) &&
        method === "PUT"
      ) {
        created = true;
        return json({
          origin: { artifactRevision: 1 },
          value: { briefing: { ...draft, questions: [] } },
        });
      }
      if (
        new URL(path, "http://local").pathname.endsWith(
          "/artifacts/preparation",
        )
      )
        return created
          ? json({
              origin: { artifactRevision: 1 },
              value: { briefing: { ...draft, questions: [] } },
            })
          : json({ error: { code: "not-found" } }, 404);
      if (
        new URL(path, "http://local").pathname.endsWith(
          "/profiles/profile-1/revisions/1",
        )
      )
        return json({
          id: "profile-1",
          name: "My matrix",
          revision: 1,
          matrix,
        });
      if (new URL(path, "http://local").pathname.endsWith("/artifacts"))
        return json({ artifacts: [] });
      throw new Error(path);
    }),
  );
  render(<InterviewPreparation />);
  await userEvent.selectOptions(
    await screen.findByRole("combobox", { name: /^Candidate profile$/i }),
    "profile-1:1",
  );
  await userEvent.type(screen.getByLabelText(/^Company$/i), "Acme");
  await userEvent.type(screen.getByLabelText(/^Role$/i), "Engineering Manager");
  await userEvent.selectOptions(
    screen.getByLabelText(/^Stage$/i),
    "hiring-manager",
  );
  await userEvent.click(
    screen.getByRole("button", { name: /^Generate proposal$/i }),
  );
  expect(
    await screen.findByRole("heading", { name: "Proposal preview" }),
  ).toBeVisible();
  expect(screen.getByText("A delivery leader")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: /^Apply proposal$/i }),
  );
  expect(await screen.findByText(/Draft applied/i)).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: /Save complete pack/i }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Saved revision 1.",
  );
  expect(
    within(screen.getByLabelText("Available packs")).getByText(
      /Acme interview · draft revision 2 · saved revision 1/,
    ),
  ).toBeVisible();
  expect(methods.filter((entry) => entry.includes("/save"))).toHaveLength(1);
  expect(
    methods.some(
      (entry) =>
        entry.startsWith("PUT") && entry.includes("/artifacts/preparation"),
    ),
  ).toBe(true);
  expect(screen.queryByText(/Run code/i)).not.toBeInTheDocument();
});

it("keeps edited content after a conflict and invalidates a proposal after context changes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      if (new URL(path, "http://local").pathname.endsWith("/profiles"))
        return json({
          profiles: [{ id: "profile-1", name: "My matrix", revision: 1 }],
        });
      if (
        new URL(path, "http://local").pathname.endsWith(
          "/artifacts/preparation/proposals",
        )
      )
        return json({ id: "proposal-1", baseRevision: 1, briefing: draft });
      if (
        new URL(path, "http://local").pathname.endsWith(
          "/artifacts/preparation",
        ) &&
        init?.method === "PUT"
      )
        return json({ error: { message: "Revision conflict" } }, 409);
      if (
        new URL(path, "http://local").pathname.endsWith(
          "/artifacts/preparation",
        )
      )
        return json({
          origin: { artifactRevision: 1 },
          value: { briefing: draft },
        });
      if (
        new URL(path, "http://local").pathname.endsWith(
          "/profiles/profile-1/revisions/1",
        )
      )
        return json({
          id: "profile-1",
          name: "My matrix",
          revision: 1,
          matrix,
        });
      if (new URL(path, "http://local").pathname.endsWith("/artifacts"))
        return json({ artifacts: [] });
      throw new Error(path);
    }),
  );
  render(<InterviewPreparation />);
  await screen.findByLabelText(/^Company$/i);
  await userEvent.click(
    screen.getByRole("button", { name: /^Generate proposal$/i }),
  );
  expect(
    await screen.findByRole("heading", { name: "Proposal preview" }),
  ).toBeVisible();
  const answer = screen.getByLabelText("Answer for Tell me about yourself");
  await userEvent.type(answer, " with more detail");
  expect(
    screen.getByRole("button", { name: /^Apply proposal$/i }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: /Save complete pack/i }),
  );
  expect(await screen.findByText(/Revision conflict/i)).toBeVisible();
  expect(answer).toHaveValue("A delivery leader with more detail");
  expect(
    screen.getByRole("button", {
      name: /Discard local edits and reload server version/i,
    }),
  ).toBeVisible();
});

it("refines one card while keeping the other card in the pack", async () => {
  const source = {
    id: "profile-1",
    revision: 1,
    sha256: "a".repeat(64),
    pointer: "/roles/0/proof_points/0",
    quote: "Led launch",
    sourceKind: "candidate",
  };
  const second = {
    ...question,
    id: "q2",
    question: "How do you lead?",
    category: "leadership",
    answerMarkdown: "I coach directly",
  };
  const original = { ...draft, questions: [question, second] };
  const refined = {
    ...draft,
    questions: [
      {
        ...question,
        answerMarkdown: "I lead through delivery",
        evidenceRefs: [source],
        gaps: ["Need team size"],
      },
      { ...second, answerMarkdown: "I coach directly with examples" },
    ],
  };
  let proposalBody:
    | {
        questionId?: string;
        instruction?: string;
        questions?: Array<{ id: string }>;
      }
    | undefined;
  let putBody:
    | { briefing?: { questions?: Array<{ answerMarkdown: string }> } }
    | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      const pathname = new URL(path, "http://local").pathname;
      if (pathname.endsWith("/profiles"))
        return json({
          profiles: [{ id: "profile-1", name: "My matrix", revision: 1 }],
        });
      if (pathname.endsWith("/profiles/profile-1/revisions/1"))
        return json({
          id: "profile-1",
          name: "My matrix",
          revision: 1,
          matrix,
        });
      if (pathname.endsWith("/artifacts/preparation/proposals")) {
        proposalBody = JSON.parse(String(init?.body));
        return json({ id: "proposal-2", baseRevision: 4, briefing: refined });
      }
      if (
        pathname.endsWith("/artifacts/preparation") &&
        init?.method === "PUT"
      ) {
        putBody = JSON.parse(String(init.body));
        return json({
          origin: { artifactRevision: 4 },
          value: { briefing: putBody?.briefing },
        });
      }
      if (pathname.endsWith("/artifacts/preparation/apply"))
        return json({
          origin: { artifactRevision: 5 },
          value: { briefing: refined },
        });
      if (pathname.endsWith("/artifacts/preparation"))
        return json({
          origin: { artifactRevision: 4 },
          value: { briefing: original },
        });
      if (pathname.endsWith("/artifacts")) return json({ artifacts: [] });
      throw new Error(path);
    }),
  );
  render(<InterviewPreparation />);
  await screen.findByRole("heading", { name: "How do you lead?" });
  await userEvent.type(
    screen.getByLabelText("Answer for How do you lead?"),
    " with examples",
  );
  await userEvent.type(
    screen.getByLabelText("Refinement instruction for Tell me about yourself"),
    "Emphasize delivery",
  );
  await userEvent.click(
    screen.getAllByRole("button", { name: "Regenerate this card" })[0]!,
  );
  expect(
    await screen.findByRole("heading", { name: "Proposal preview" }),
  ).toBeVisible();
  expect(proposalBody).toMatchObject({
    questionId: "q1",
    instruction: "Emphasize delivery",
    questions: [{ id: "q1" }],
  });
  expect(putBody?.briefing?.questions?.[1]?.answerMarkdown).toBe(
    "I coach directly with examples",
  );
  await userEvent.click(
    within(screen.getByLabelText("Proposal preview")).getByText(
      "Sources and gaps for Tell me about yourself",
    ),
  );
  expect(
    within(screen.getByLabelText("Proposal preview")).getByText(/Led launch/),
  ).toBeVisible();
  expect(
    within(screen.getByLabelText("Proposal preview")).getByText(
      "Need team size",
    ),
  ).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Apply proposal" }));
  expect(
    await screen.findAllByText("I lead through delivery"),
  ).not.toHaveLength(0);
  expect(
    screen.getAllByText("I coach directly with examples"),
  ).not.toHaveLength(0);
});

it("marks a sourced answer for review after an edit without losing its source", async () => {
  const source = {
    id: "profile-1",
    revision: 1,
    sha256: "a".repeat(64),
    pointer: "/roles/0/proof_points/0",
    quote: "Led the launch",
    sourceKind: "candidate",
  };
  const sourced = {
    ...draft,
    questions: [{ ...question, evidenceRefs: [source] }],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) => {
      const pathname = new URL(path, "http://local").pathname;
      if (pathname.endsWith("/profiles"))
        return json({
          profiles: [{ id: "profile-1", name: "My matrix", revision: 1 }],
        });
      if (pathname.endsWith("/profiles/profile-1/revisions/1"))
        return json({
          id: "profile-1",
          name: "My matrix",
          revision: 1,
          matrix,
        });
      if (pathname.endsWith("/artifacts/preparation"))
        return json({
          origin: { artifactRevision: 1 },
          value: { briefing: sourced },
        });
      if (pathname.endsWith("/artifacts")) return json({ artifacts: [] });
      throw new Error(path);
    }),
  );
  render(<InterviewPreparation />);
  const answer = await screen.findByLabelText(
    "Answer for Tell me about yourself",
  );
  await userEvent.type(answer, " More detail");
  await userEvent.click(screen.getByText("Sources and gaps"));
  expect(screen.getByText(/Edited answer needs source review/i)).toBeVisible();
  expect(screen.getByText(/Led the launch/)).toBeVisible();
});

it("opens another saved pack through its list action", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) => {
      const pathname = new URL(path, "http://local").pathname;
      if (pathname.endsWith("/profiles"))
        return json({
          profiles: [{ id: "profile-1", name: "My matrix", revision: 1 }],
        });
      if (pathname.endsWith("/profiles/profile-1/revisions/1"))
        return json({
          id: "profile-1",
          name: "My matrix",
          revision: 1,
          matrix,
        });
      if (pathname.endsWith("/artifacts/other"))
        return json({
          origin: { artifactRevision: 3 },
          value: { briefing: { ...draft, title: "Other interview" } },
        });
      if (pathname.endsWith("/artifacts/preparation"))
        return json({ error: { code: "not-found" } }, 404);
      if (pathname.endsWith("/artifacts"))
        return json({
          artifacts: [
            {
              id: "other",
              title: "Other interview",
              revision: 3,
              savedRevision: 1,
            },
          ],
        });
      throw new Error(path);
    }),
  );
  render(<InterviewPreparation />);
  await userEvent.selectOptions(
    await screen.findByRole("combobox", { name: "Candidate profile" }),
    "profile-1:1",
  );
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Discard current setup and open Other interview",
    }),
  );
  expect(await screen.findByDisplayValue("Other interview")).toBeVisible();
});

it("keeps a late proposal stale when context changes during generation", async () => {
  let finishProposal: ((value: Response) => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) => {
      const pathname = new URL(path, "http://local").pathname;
      if (pathname.endsWith("/profiles"))
        return json({
          profiles: [{ id: "profile-1", name: "My matrix", revision: 1 }],
        });
      if (pathname.endsWith("/profiles/profile-1/revisions/1"))
        return json({
          id: "profile-1",
          name: "My matrix",
          revision: 1,
          matrix,
        });
      if (pathname.endsWith("/artifacts/preparation/proposals"))
        return new Promise<Response>((resolve) => {
          finishProposal = resolve;
        });
      if (pathname.endsWith("/artifacts/preparation"))
        return json({
          origin: { artifactRevision: 1 },
          value: { briefing: draft },
        });
      if (pathname.endsWith("/artifacts")) return json({ artifacts: [] });
      throw new Error(path);
    }),
  );
  render(<InterviewPreparation />);
  const company = await screen.findByLabelText(/^Company$/i);
  await userEvent.click(
    screen.getByRole("button", { name: "Generate proposal" }),
  );
  await waitFor(() => expect(finishProposal).toBeDefined());
  await userEvent.type(company, " Labs");
  finishProposal!(
    new Response(
      JSON.stringify({ id: "late", baseRevision: 1, briefing: draft }),
      { status: 201, headers: { "content-type": "application/json" } },
    ),
  );
  expect(
    await screen.findByRole("button", { name: "Apply proposal" }),
  ).toBeDisabled();
});

it("can select a historical profile revision and explicitly import its next version", async () => {
  let posted: unknown;
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      const pathname = new URL(path, "http://local").pathname;
      if (pathname.endsWith("/profiles") && init?.method === "POST") {
        posted = JSON.parse(String(init.body));
        return json({ id: "profile-1", name: "My matrix", revision: 3 });
      }
      if (pathname.endsWith("/profiles"))
        return json({
          profiles: [{ id: "profile-1", name: "My matrix", revision: 2 }],
        });
      if (pathname.includes("/profiles/profile-1/revisions/"))
        return json({
          id: "profile-1",
          name: "My matrix",
          revision: 1,
          matrix,
        });
      if (pathname.endsWith("/artifacts/preparation"))
        return json({ error: { code: "not-found" } }, 404);
      if (pathname.endsWith("/artifacts")) return json({ artifacts: [] });
      throw new Error(path);
    }),
  );
  render(<InterviewPreparation />);
  await userEvent.selectOptions(
    await screen.findByRole("combobox", { name: "Candidate profile" }),
    "profile-1:1",
  );
  fireEvent.change(screen.getByLabelText("Paste matrix JSON"), {
    target: { value: JSON.stringify(matrix) },
  });
  await userEvent.click(screen.getByRole("button", { name: "Preview matrix" }));
  await userEvent.type(screen.getByLabelText("Profile name"), "My matrix");
  await userEvent.click(screen.getByLabelText(/Import as a new revision/i));
  await userEvent.click(screen.getByRole("button", { name: "Confirm import" }));
  await waitFor(() =>
    expect(posted).toEqual({
      name: "My matrix",
      matrix,
      profileId: "profile-1",
      expectedRevision: 2,
    }),
  );
  expect(
    screen.getByRole("combobox", { name: "Candidate profile" }),
  ).toHaveValue("profile-1:3");
});

it("requires a full proposal when interview context changes before card refinement", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) => {
      const pathname = new URL(path, "http://local").pathname;
      if (pathname.endsWith("/profiles"))
        return json({
          profiles: [{ id: "profile-1", name: "My matrix", revision: 1 }],
        });
      if (pathname.endsWith("/profiles/profile-1/revisions/1"))
        return json({
          id: "profile-1",
          name: "My matrix",
          revision: 1,
          matrix,
        });
      if (pathname.endsWith("/artifacts/preparation"))
        return json({
          origin: { artifactRevision: 1 },
          value: { briefing: draft },
        });
      if (pathname.endsWith("/artifacts")) return json({ artifacts: [] });
      throw new Error(path);
    }),
  );
  render(<InterviewPreparation />);
  await userEvent.type(await screen.findByLabelText(/^Company$/i), " Labs");
  expect(
    screen.getByRole("button", { name: "Regenerate this card" }),
  ).toBeDisabled();
  expect(screen.getByText(/context changed.*complete proposal/i)).toBeVisible();
});

it("reports a synced empty draft when proposal generation fails and prevents saving it", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      const pathname = new URL(path, "http://local").pathname;
      if (pathname.endsWith("/profiles"))
        return json({
          profiles: [{ id: "profile-1", name: "My matrix", revision: 1 }],
        });
      if (pathname.endsWith("/profiles/profile-1/revisions/1"))
        return json({
          id: "profile-1",
          name: "My matrix",
          revision: 1,
          matrix,
        });
      if (pathname.endsWith("/artifacts/preparation/proposals"))
        return json({ error: { message: "Provider unavailable" } }, 503);
      if (pathname.endsWith("/artifacts/preparation") && init?.method === "PUT")
        return json({
          origin: { artifactRevision: 1 },
          value: { briefing: { ...draft, questions: [] } },
        });
      if (pathname.endsWith("/artifacts/preparation"))
        return json({ error: { code: "not-found" } }, 404);
      if (pathname.endsWith("/artifacts")) return json({ artifacts: [] });
      throw new Error(path);
    }),
  );
  render(<InterviewPreparation />);
  await userEvent.selectOptions(
    await screen.findByRole("combobox", { name: "Candidate profile" }),
    "profile-1:1",
  );
  await userEvent.type(screen.getByLabelText(/^Company$/i), "Acme");
  await userEvent.type(screen.getByLabelText(/^Role$/i), "Engineering Manager");
  await userEvent.click(
    screen.getByRole("button", { name: "Generate proposal" }),
  );
  expect(
    await screen.findByText(
      /Draft changes synced, but proposal failed: Provider unavailable/,
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Save complete pack" }),
  ).toBeDisabled();
});

it("requires a new full proposal after editing the question list before saving", async () => {
  let proposedQuestions: unknown;
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      const pathname = new URL(path, "http://local").pathname;
      calls.push(`${init?.method ?? "GET"} ${pathname}`);
      if (pathname.endsWith("/profiles"))
        return json({
          profiles: [{ id: "profile-1", name: "Matrix", revision: 1 }],
        });
      if (pathname.endsWith("/profiles/profile-1/revisions/1"))
        return json({ id: "profile-1", name: "Matrix", revision: 1, matrix });
      if (pathname.endsWith("/artifacts/preparation/proposals")) {
        proposedQuestions = (
          JSON.parse(String(init?.body)) as { questions: unknown }
        ).questions;
        return json({ id: "proposal-1", baseRevision: 1, briefing: draft });
      }
      if (pathname.endsWith("/artifacts/preparation"))
        return json({
          origin: { artifactRevision: 1 },
          value: { briefing: draft },
        });
      if (pathname.endsWith("/artifacts")) return json({ artifacts: [] });
      throw new Error(path);
    }),
  );
  render(<InterviewPreparation />);
  const questionInput = await screen.findByLabelText("Question 1");
  await userEvent.clear(questionInput);
  await userEvent.type(questionInput, "Why this company?");
  expect(
    screen.getByRole("button", { name: "Save complete pack" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Regenerate this card" }),
  ).toBeDisabled();
  expect(
    screen.getByText(/Questions or context changed.*complete proposal/i),
  ).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Generate proposal" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Proposal preview" }),
  ).toBeVisible();
  expect(proposedQuestions).toEqual([
    { id: "q1", question: "Why this company?", category: "background" },
  ]);
  expect(calls.some((call) => call.includes("/save"))).toBe(false);
});

it("clears selected role pointers when switching candidate profiles", async () => {
  let proposalBody: { storyIds?: string[] } | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      const pathname = new URL(path, "http://local").pathname;
      if (pathname.endsWith("/profiles"))
        return json({
          profiles: [
            { id: "profile-1", name: "First", revision: 1 },
            { id: "profile-2", name: "Second", revision: 1 },
          ],
        });
      if (pathname.endsWith("/profiles/profile-1/revisions/1"))
        return json({ id: "profile-1", name: "First", revision: 1, matrix });
      if (pathname.endsWith("/profiles/profile-2/revisions/1"))
        return json({
          id: "profile-2",
          name: "Second",
          revision: 1,
          matrix: {
            candidate: { name: "Blair" },
            roles: [
              { company: "Beta", title: "Manager", proof_points: ["Mentored"] },
            ],
          },
        });
      if (pathname.endsWith("/artifacts/preparation/proposals")) {
        proposalBody = JSON.parse(String(init?.body));
        return json({ id: "proposal-2", baseRevision: 1, briefing: draft });
      }
      if (pathname.endsWith("/artifacts/preparation") && init?.method === "PUT")
        return json({
          origin: { artifactRevision: 1 },
          value: { briefing: { ...draft, questions: [] } },
        });
      if (pathname.endsWith("/artifacts/preparation"))
        return json({ error: { code: "not-found" } }, 404);
      if (pathname.endsWith("/artifacts")) return json({ artifacts: [] });
      throw new Error(path);
    }),
  );
  render(<InterviewPreparation />);
  const profile = await screen.findByRole("combobox", {
    name: "Candidate profile",
  });
  await userEvent.selectOptions(profile, "profile-1:1");
  await userEvent.click(
    await screen.findByRole("checkbox", { name: "Lead at Acme" }),
  );
  await userEvent.selectOptions(profile, "profile-2:1");
  expect(
    await screen.findByRole("checkbox", { name: "Manager at Beta" }),
  ).not.toBeChecked();
  await userEvent.type(screen.getByLabelText(/^Company$/), "Beta");
  await userEvent.type(screen.getByLabelText(/^Role$/), "Manager");
  await userEvent.click(
    screen.getByRole("button", { name: "Generate proposal" }),
  );
  await screen.findByRole("heading", { name: "Proposal preview" });
  expect(proposalBody?.storyIds).toBeUndefined();
});

it("reloads a conflicted draft only after explicit discard", async () => {
  let current = draft;
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      const pathname = new URL(path, "http://local").pathname;
      if (pathname.endsWith("/profiles"))
        return json({
          profiles: [{ id: "profile-1", name: "Matrix", revision: 1 }],
        });
      if (pathname.endsWith("/profiles/profile-1/revisions/1"))
        return json({ id: "profile-1", name: "Matrix", revision: 1, matrix });
      if (pathname.endsWith("/artifacts/preparation") && init?.method === "PUT")
        return json({ error: { code: "revision-conflict" } }, 409);
      if (pathname.endsWith("/artifacts/preparation")) {
        reads += 1;
        return json({
          origin: { artifactRevision: 1 },
          value: { briefing: current },
        });
      }
      if (pathname.endsWith("/artifacts")) return json({ artifacts: [] });
      throw new Error(path);
    }),
  );
  render(<InterviewPreparation />);
  const answer = await screen.findByLabelText(
    "Answer for Tell me about yourself",
  );
  await userEvent.type(answer, " local edit");
  current = {
    ...draft,
    questions: [{ ...question, answerMarkdown: "Server edit" }],
  };
  await userEvent.click(
    screen.getByRole("button", { name: "Save complete pack" }),
  );
  expect(
    await screen.findByRole("button", {
      name: /Discard local edits and reload server version/i,
    }),
  ).toBeVisible();
  expect(answer).toHaveValue("A delivery leader local edit");
  expect(reads).toBe(1);
  await userEvent.click(
    screen.getByRole("button", {
      name: /Discard local edits and reload server version/i,
    }),
  );
  expect(
    await screen.findByLabelText("Answer for Tell me about yourself"),
  ).toHaveValue("Server edit");
  expect(reads).toBe(2);
});

it("starts a distinct pack only after confirming unsaved work can be discarded", async () => {
  const confirm = vi
    .spyOn(window, "confirm")
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);
  const requestedArtifacts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) => {
      const pathname = new URL(path, "http://local").pathname;
      if (pathname.endsWith("/profiles"))
        return json({
          profiles: [{ id: "profile-1", name: "Matrix", revision: 1 }],
        });
      if (pathname.endsWith("/profiles/profile-1/revisions/1"))
        return json({ id: "profile-1", name: "Matrix", revision: 1, matrix });
      if (pathname.endsWith("/artifacts")) return json({ artifacts: [] });
      if (pathname.includes("/artifacts/")) {
        requestedArtifacts.push(pathname);
        return pathname.endsWith("/artifacts/preparation")
          ? json({
              origin: { artifactRevision: 1 },
              value: { briefing: draft },
            })
          : json({ error: { code: "not-found" } }, 404);
      }
      throw new Error(path);
    }),
  );
  render(<InterviewPreparation />);
  await userEvent.type(await screen.findByLabelText(/^Company$/), " Labs");
  await userEvent.click(screen.getByRole("button", { name: "New pack" }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(requestedArtifacts).toEqual([
    "/api/interview/briefing/artifacts/preparation",
  ]);
  expect(screen.getByLabelText(/^Company$/)).toHaveValue("Acme Labs");
  await userEvent.click(screen.getByRole("button", { name: "New pack" }));
  expect(confirm).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(requestedArtifacts).toHaveLength(2));
  expect(requestedArtifacts[1]).not.toBe(requestedArtifacts[0]);
  expect(screen.getByLabelText(/^Company$/)).toHaveValue("");
});

it("selects the host-seeded local matrix for an empty pack without replacing a saved profile", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) => {
      const pathname = new URL(path, "http://local").pathname;
      if (pathname.endsWith("/profiles"))
        return json({
          profiles: [
            {
              id: "local-experience-matrix",
              name: "Local matrix",
              revision: 1,
            },
            { id: "profile-1", name: "Saved matrix", revision: 1 },
          ],
        });
      if (pathname.endsWith("/profiles/local-experience-matrix/revisions/1"))
        return json({
          id: "local-experience-matrix",
          name: "Local matrix",
          revision: 1,
          matrix,
        });
      if (pathname.endsWith("/profiles/profile-1/revisions/1"))
        return json({
          id: "profile-1",
          name: "Saved matrix",
          revision: 1,
          matrix,
        });
      if (pathname.endsWith("/artifacts/preparation"))
        return json({ error: { code: "not-found" } }, 404);
      if (pathname.endsWith("/artifacts/saved"))
        return json({
          origin: { artifactRevision: 1 },
          value: { briefing: draft },
        });
      if (pathname.endsWith("/artifacts")) return json({ artifacts: [] });
      throw new Error(path);
    }),
  );
  const { unmount } = render(<InterviewPreparation />);
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Candidate profile" }),
    ).toHaveValue("local-experience-matrix:1"),
  );
  unmount();
  render(<InterviewPreparation artifactId="saved" />);
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Candidate profile" }),
    ).toHaveValue("profile-1:1"),
  );
});

it("saves an edited title and talking point with the full pack and displays server source review", async () => {
  const source = {
    id: "profile-1",
    revision: 1,
    sha256: "a".repeat(64),
    pointer: "/roles/0/proof_points/0",
    quote: "Led launch",
    sourceKind: "candidate",
  };
  const second = {
    ...question,
    id: "q2",
    question: "How do you lead?",
    answerMarkdown: "I coach directly",
    evidenceRefs: [source],
  };
  const original = {
    ...draft,
    questions: [{ ...question, evidenceRefs: [source] }, second],
  };
  let submitted: typeof original | undefined;
  let savedRevision: number | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      const pathname = new URL(path, "http://local").pathname;
      if (pathname.endsWith("/profiles"))
        return json({
          profiles: [{ id: "profile-1", name: "Matrix", revision: 1 }],
        });
      if (pathname.endsWith("/profiles/profile-1/revisions/1"))
        return json({ id: "profile-1", name: "Matrix", revision: 1, matrix });
      if (
        pathname.endsWith("/artifacts/preparation") &&
        init?.method === "PUT"
      ) {
        submitted = (
          JSON.parse(String(init.body)) as { briefing: typeof original }
        ).briefing;
        const reviewed = {
          ...submitted,
          questions: submitted.questions.map((item) =>
            item.id === "q1"
              ? {
                  ...item,
                  evidenceRefs: [],
                  gaps: [
                    ...item.gaps,
                    "Review the edited answer against its sources.",
                  ],
                }
              : item,
          ),
        };
        return json({
          origin: { artifactRevision: 2 },
          value: { briefing: reviewed },
        });
      }
      if (pathname.endsWith("/artifacts/preparation/save")) {
        savedRevision = (
          JSON.parse(String(init?.body)) as { expectedRevision: number }
        ).expectedRevision;
        return json({
          id: "preparation",
          savedRevision: 1,
          draftRevision: 2,
          value: { briefing: submitted },
        });
      }
      if (pathname.endsWith("/artifacts/preparation"))
        return json({
          origin: { artifactRevision: 1 },
          value: { briefing: original },
        });
      if (pathname.endsWith("/artifacts")) return json({ artifacts: [] });
      throw new Error(path);
    }),
  );
  render(<InterviewPreparation />);
  const title = await screen.findByLabelText("Pack title");
  await userEvent.clear(title);
  await userEvent.type(title, "Acme leadership interview");
  const point = screen.getByLabelText(
    "Talking point 1 for Tell me about yourself",
  );
  await userEvent.clear(point);
  await userEvent.type(point, "Larger scope");
  await userEvent.click(
    screen.getByRole("button", { name: "Save complete pack" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Saved revision 1."),
  );
  expect(savedRevision).toBe(2);
  expect(submitted?.title).toBe("Acme leadership interview");
  expect(submitted?.questions).toHaveLength(2);
  expect(submitted?.questions[0]?.talkingPoints).toEqual([
    "Larger scope",
    "Team",
    "Outcome",
  ]);
  expect(submitted?.questions[1]).toEqual(second);
  const cards = screen.getAllByRole("article");
  await userEvent.click(within(cards[0]!).getByText("Sources and gaps"));
  expect(
    within(cards[0]!).getByText(
      "Review the edited answer against its sources.",
    ),
  ).toBeVisible();
  expect(within(cards[0]!).queryByText(/Led launch/)).not.toBeInTheDocument();
  await userEvent.click(within(cards[1]!).getByText("Sources and gaps"));
  expect(within(cards[1]!).getByText(/Led launch/)).toBeVisible();
});
