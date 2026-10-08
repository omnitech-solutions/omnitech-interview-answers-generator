import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioActions } from "../config/commands";
import type {
  DocumentContext,
  Template,
  TemplateListItem,
} from "./documents-client";
import { DocumentsView } from "./documents-view";

const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const OWNED_TEMPLATE_A = "66666666-6666-4666-8666-666666666666";
const OWNED_TEMPLATE_B = "77777777-7777-4777-8777-777777777777";
const NEW_CANDIDACY_ID = "99999999-9999-4999-8999-999999999999";
const NEW_INTERVIEW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PREP_TEMPLATE_ID = "88888888-8888-4888-8888-888888888888";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const CANDIDACY_ID = "33333333-3333-4333-8333-333333333333";
const INTERVIEW_ID = "44444444-4444-4444-8444-444444444444";

const template: Template = {
  id: TEMPLATE_ID,
  name: "Resume",
  kind: "resume",
  format: "docx",
  ownerUserId: null,
};
const fields = [
  {
    key: "full_name",
    label: "Full name",
    source: "candidate-profile",
    required: true,
    maxLength: null,
  },
  {
    key: "company_name",
    label: "Company name",
    source: "candidacy",
    required: true,
    maxLength: null,
  },
];
const baseCandidacy = {
  id: CANDIDACY_ID,
  title: "Engineer",
  company_name: "Northwind",
  job_description: "Build systems" as string | null,
};
const baseInterview = {
  id: INTERVIEW_ID,
  candidacy_id: CANDIDACY_ID,
  label: "Hiring manager",
  kind: "hiring-manager",
};
const context: DocumentContext = {
  profiles: [{ id: "profile-1", name: "Experience matrix", revision: 3 }],
  candidacies: [baseCandidacy],
  interviews: [baseInterview],
  targets: [{ id: "target-1", label: "Primary model" }],
};
const exportRow = {
  id: "55555555-5555-4555-8555-555555555555",
  revision: 2,
  format: "docx",
  createdAt: "2026-10-02",
};

type Call = { method: string; path: string; body: unknown };
let calls: Call[];
let currentRevision: number;
let revisionValues: Record<number, Record<string, string>>;
let exports: (typeof exportRow)[];
let validationIssues: Array<{ key: string; code: "missing" }>;
let saveConflict: boolean;
let templateCatalog: TemplateListItem[];
let editorFields: typeof fields;
let documentCandidacyId: string | null;
let documentInterviewId: string | null;
let claimState: "unverified" | "confirmed";

function listed(item: Template, latestRevision = 1): TemplateListItem {
  return {
    template: item,
    latestRevision,
    fieldCount: 2,
    revisions: Array.from({ length: latestRevision }, (_, index) => ({
      revision: latestRevision - index,
      createdAt: "2026-10-02",
    })),
  };
}

function mockApi() {
  calls = [];
  currentRevision = 1;
  revisionValues = { 1: { full_name: "Ada", company_name: "Northwind" } };
  exports = [];
  validationIssues = [];
  claimState = "unverified";
  saveConflict = false;
  templateCatalog = [listed(template)];
  editorFields = fields;
  documentCandidacyId = CANDIDACY_ID;
  documentInterviewId = INTERVIEW_ID;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      const body =
        init?.body && !(init.body instanceof FormData)
          ? JSON.parse(String(init.body))
          : (init?.body ?? null);
      calls.push({ method, path, body });
      if (path.endsWith("/context")) return Response.json(context);
      if (
        path.includes("/candidacies/") &&
        path.endsWith("/job-description") &&
        method === "PATCH"
      )
        return Response.json({
          jobDescription: (body as { jobDescription: string }).jobDescription,
        });
      if (path.endsWith("/templates/intake") && method === "POST")
        return Response.json({ fields: [fields[0]] });
      if (path.endsWith("/candidacies") && method === "POST")
        return Response.json(
          {
            candidacyId: NEW_CANDIDACY_ID,
            interviewId: (body as { interview?: unknown }).interview
              ? NEW_INTERVIEW_ID
              : null,
          },
          { status: 201 },
        );
      if (path.endsWith("/interviews") && method === "POST")
        return Response.json(
          { interviewId: NEW_INTERVIEW_ID },
          { status: 201 },
        );
      if (path.endsWith("/instructions") && method === "POST")
        return Response.json({ revision: 2 }, { status: 201 });
      if (path.endsWith("/duplicate") && method === "POST")
        return Response.json(
          { template: { ...template, id: OWNED_TEMPLATE_A } },
          { status: 201 },
        );
      if (
        path.endsWith(`/templates/${OWNED_TEMPLATE_A}/revisions`) &&
        method === "POST"
      )
        return Response.json({ revision: { revision: 2 } }, { status: 201 });
      if (
        path.endsWith(`/templates/${OWNED_TEMPLATE_B}/revisions`) &&
        method === "POST"
      )
        return Response.json({ revision: { revision: 2 } }, { status: 201 });
      if (path.endsWith("/templates") && method === "POST")
        return Response.json(
          { template: { ...template, id: OWNED_TEMPLATE_B } },
          { status: 201 },
        );
      if (path.endsWith("/templates"))
        return Response.json({ templates: templateCatalog });
      if (path.endsWith(`/templates/${OWNED_TEMPLATE_A}`))
        return Response.json({
          template: templateCatalog.find(
            (item) => item.template.id === OWNED_TEMPLATE_A,
          )?.template,
          revision: { revision: 1, instructions: "Instructions for A" },
          fields,
        });
      if (path.endsWith(`/templates/${OWNED_TEMPLATE_B}`))
        return Response.json({
          template: templateCatalog.find(
            (item) => item.template.id === OWNED_TEMPLATE_B,
          )?.template,
          revision: { revision: 1, instructions: "Instructions for B" },
          fields,
        });
      if (path.endsWith(`/templates/${TEMPLATE_ID}`))
        return Response.json({
          template,
          revision: { revision: 1, instructions: "Use evidence." },
          fields,
        });
      if (path === "/api/interview/documents" && method === "GET")
        return Response.json({
          documents: [
            {
              id: DOCUMENT_ID,
              title: "Resume for Northwind",
              status: "ready",
              currentRevision,
              profileId: "profile-1",
              profileRevision: 2,
              candidacyId: documentCandidacyId,
              interviewId: documentInterviewId,
              templateId: TEMPLATE_ID,
              templateRevision: 1,
              updatedAt: "2026-10-02",
            },
          ],
        });
      if (path === "/api/interview/documents" && method === "POST")
        return new Response(
          `${[
            {
              t: "plan",
              batches: [{ id: "batch-1", title: "Header", count: 2 }],
              fixed: {},
            },
            {
              t: "batch",
              id: "batch-1",
              title: "Header",
              values: { full_name: "Ada" },
            },
            { t: "done", document: { id: DOCUMENT_ID }, errors: [] },
          ]
            .map((event) => JSON.stringify(event))
            .join("\n")}\n`,
          { headers: { "content-type": "application/x-ndjson" } },
        );
      if (
        path.endsWith("/preview") &&
        path.includes("/templates/") &&
        method === "POST"
      )
        return Response.json({ kind: "html", html: "<p>draft</p>" });
      if (path.endsWith(`/${DOCUMENT_ID}/preview`) && method === "POST") {
        return Response.json({
          html: `<pre>${(body as { values: Record<string, string> }).values["full_name"]}</pre>`,
          validation: validationIssues,
        });
      }
      if (path.includes(`/${DOCUMENT_ID}/preview`) && method === "GET")
        return Response.json({
          html: "<pre>Ada</pre>",
          revision: 1,
          validation: [],
        });
      if (path.endsWith(`/${DOCUMENT_ID}/revisions`) && method === "POST") {
        if (saveConflict)
          return Response.json(
            { error: { code: "revision-conflict" } },
            { status: 409 },
          );
        currentRevision++;
        revisionValues[currentRevision] = (
          body as { values: Record<string, string> }
        ).values;
        return Response.json({ revision: currentRevision }, { status: 201 });
      }
      if (path.endsWith(`/${DOCUMENT_ID}/restore`) && method === "POST") {
        currentRevision++;
        revisionValues[currentRevision] =
          revisionValues[(body as { sourceRevision: number }).sourceRevision]!;
        return Response.json({ revision: currentRevision }, { status: 201 });
      }
      if (path.endsWith(`/${DOCUMENT_ID}/regenerate`) && method === "POST") {
        claimState = "unverified";
        validationIssues = [];
        currentRevision++;
        revisionValues[currentRevision] = {
          ...revisionValues[currentRevision - 1]!,
          full_name: "Ada Regenerated",
        };
        return Response.json({ revision: currentRevision }, { status: 201 });
      }
      if (path.endsWith(`/${DOCUMENT_ID}/confirm`) && method === "POST") {
        currentRevision++;
        revisionValues[currentRevision] = {
          ...revisionValues[currentRevision - 1]!,
        };
        claimState = "confirmed";
        return Response.json({ revision: currentRevision }, { status: 201 });
      }
      if (
        path.endsWith(`/${DOCUMENT_ID}/refresh-sources`) &&
        method === "POST"
      ) {
        currentRevision++;
        revisionValues[currentRevision] = {
          ...revisionValues[currentRevision - 1]!,
        };
        claimState = "unverified";
        return Response.json({ revision: currentRevision }, { status: 201 });
      }
      if (path.endsWith(`/${DOCUMENT_ID}/exports`) && method === "POST") {
        const row = {
          ...exportRow,
          revision: (body as { revision: number }).revision,
        };
        exports = [row, ...exports];
        return Response.json(row, { status: 201 });
      }
      if (path.endsWith(`/${DOCUMENT_ID}/exports`) && method === "GET")
        return Response.json({ exports });
      if (path.includes("/download"))
        return new Response("docx", {
          headers: { "content-type": "application/octet-stream" },
        });
      if (path.includes(`/${DOCUMENT_ID}`) && method === "GET") {
        const revision = Number(
          new URL(path, "http://local").searchParams.get("revision") ??
            currentRevision,
        );
        return Response.json({
          document: {
            id: DOCUMENT_ID,
            title: "Resume for Northwind",
            status: "ready",
            currentRevision,
            templateId: TEMPLATE_ID,
            templateRevision: 1,
            profileId: "profile-1",
            profileRevision: 2,
            candidacyId: documentCandidacyId,
            interviewId: documentInterviewId,
          },
          revision: {
            revision,
            values: revisionValues[revision],
            validation: validationIssues,
            provenance: {
              kind: revision === 1 ? "generated" : "edited",
              modelOwnedKeys: ["full_name"],
              claimState,
            },
            createdAt: "2026-10-02",
          },
          template,
          fields: editorFields,
        });
      }
      return Response.json({ error: { code: "not-found" } }, { status: 404 });
    }),
  );
}

const actions = {
  go: vi.fn(),
  openArtifact: vi.fn(),
  openBriefing: vi.fn(),
  openBrief: vi.fn(),
  newQuestion: vi.fn(),
  runTests: vi.fn(),
  toggleTheme: vi.fn(),
  toggleAssistant: vi.fn(),
} satisfies StudioActions;

beforeEach(() => {
  localStorage.clear();
  context.targets = [{ id: "target-1", label: "Primary model" }];
  context.candidacies = [baseCandidacy];
  context.interviews = [baseInterview];
  context.profiles[0]!.revision = 3;
  context.candidacies[0]!.job_description = "Build systems";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mockApi();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:example"),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    () => undefined,
  );
});

function renderAt(rest: readonly string[]) {
  return render(
    <DocumentsView rest={rest} actions={actions} onDirtyChange={vi.fn()} />,
  );
}

function stubFetchFor(match: (path: string) => Response | undefined): void {
  const original = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const response = match(String(input));
      return response ? Promise.resolve(response) : original(input, init);
    }),
  );
}

const posted = (suffix: string) =>
  calls.find((call) => call.method === "POST" && call.path.endsWith(suffix));

describe("Documents list", () => {
  it("groups documents under their application and keeps a General group", async () => {
    renderAt([]);
    const northwind = await screen.findByRole("region", {
      name: "Northwind · Engineer",
    });
    expect(
      within(northwind).getByText("Resume for Northwind"),
    ).toBeInTheDocument();
    expect(within(northwind).getByText(/Resume · rev 1/)).toBeInTheDocument();
    expect(within(northwind).getByText("Ready to export")).toBeInTheDocument();
    const general = screen.getByRole("region", { name: "General" });
    expect(
      within(general).getByText(/A general resume is useful/),
    ).toBeVisible();

    fireEvent.click(
      within(northwind).getByRole("button", { name: /Resume for Northwind/ }),
    );
    expect(actions.go).toHaveBeenCalledWith("documents", [DOCUMENT_ID]);
    fireEvent.click(
      screen.getByRole("button", { name: "Add document to General" }),
    );
    expect(actions.go).toHaveBeenCalledWith("documents", ["new"]);
  });

  it("refreshes when the person comes back to the window, not on every focus", async () => {
    renderAt([]);
    await screen.findByRole("heading", { name: "Documents" });
    const loads = () =>
      calls.filter((call) => call.path.endsWith("/context")).length;
    const before = loads();
    // Too soon after loading: nothing to catch up on.
    fireEvent.focus(window);
    expect(loads()).toBe(before);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 10_000);
    fireEvent.focus(window);
    vi.useRealTimers();
    await waitFor(() => expect(loads()).toBe(before + 1));
  });

  it("switches between documents and templates from the tabs", async () => {
    renderAt([]);
    await screen.findByRole("heading", { name: "Documents" });
    fireEvent.click(screen.getByRole("tab", { name: "Templates" }));
    expect(actions.go).toHaveBeenCalledWith("documents", ["templates"]);
  });

  it("offers retry when the catalog cannot load", async () => {
    stubFetchFor((path) =>
      path.endsWith("/context")
        ? new Response("Internal Server Error", { status: 500 })
        : undefined,
    );
    renderAt([]);
    expect(
      await screen.findByRole("heading", { name: "Documents could not load" }),
    ).toBeVisible();
    expect(
      screen.getByText(/Check the server and database migrations/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.queryByText("Loading documents…")).not.toBeInTheDocument();
  });
});

describe("New document dialog", () => {
  it("explains missing setup data instead of leaving generation silently disabled", async () => {
    stubFetchFor((path) =>
      path.endsWith("/context")
        ? Response.json({ ...context, profiles: [], targets: [] })
        : undefined,
    );
    renderAt(["new"]);
    expect(await screen.findByText(/Save an experience matrix/)).toBeVisible();
    expect(screen.getByText(/No model is available/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
  });

  it("creates from candidacy, profile revision, and model", async () => {
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    fireEvent.click(
      screen.getByRole("radio", { name: /Northwind · Engineer/ }),
    );
    expect(screen.getByText(/Resume — Northwind/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(
      () => expect(actions.go).toHaveBeenCalledWith("documents", [DOCUMENT_ID]),
      { timeout: 4000 },
    );
    expect(posted("/api/interview/documents")?.body).toMatchObject({
      templateId: TEMPLATE_ID,
      templateRevision: 1,
      profileId: "profile-1",
      profileRevision: 3,
      candidacyId: CANDIDACY_ID,
      interviewId: null,
      aiTargetId: "target-1",
    });
  });

  it("generates with the model the assistant has chosen", async () => {
    context.targets = [
      { id: "target-1", label: "Primary model" },
      { id: "agent/claude-code", label: "Claude Code" },
    ];
    localStorage.setItem("omnitech-assistant:model", '"agent/claude-code"');
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    expect(screen.getByText("Claude Code")).toBeVisible();
    expect(screen.getByText(/Follows the model chosen/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() =>
      expect(posted("/api/interview/documents")).toBeTruthy(),
    );
    expect(posted("/api/interview/documents")?.body).toMatchObject({
      aiTargetId: "agent/claude-code",
    });
  });

  it("says so when the assistant's model cannot write documents", async () => {
    context.targets = [
      { id: "target-1", label: "Primary model", family: "direct-model" },
      {
        id: "agent/claude-code",
        label: "Claude Code",
        family: "agent-runtime",
      },
    ];
    localStorage.setItem(
      "omnitech-assistant:model",
      '"lm-studio/qwen3-coder-30b"',
    );
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    expect(screen.getByText(/can't write documents/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() =>
      expect(posted("/api/interview/documents")).toBeTruthy(),
    );
    expect(posted("/api/interview/documents")?.body).toMatchObject({
      aiTargetId: "agent/claude-code",
    });
  });

  it("asks for the interview stage when the template is interview prep", async () => {
    templateCatalog = [
      listed(template),
      listed({
        ...template,
        id: PREP_TEMPLATE_ID,
        name: "Interview prep",
        kind: "interview_prep",
        format: "md",
      }),
    ];
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    fireEvent.click(screen.getByRole("button", { name: /Interview prep/ }));
    expect(
      screen.getByRole("radio", { name: /General — no application/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("radio", { name: /Northwind · Engineer/ }),
    ).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Hiring manager" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() =>
      expect(posted("/api/interview/documents")).toBeTruthy(),
    );
    expect(posted("/api/interview/documents")?.body).toMatchObject({
      templateId: PREP_TEMPLATE_ID,
      candidacyId: CANDIDACY_ID,
      interviewId: INTERVIEW_ID,
    });
  });

  it("shows the document being written: sections tick off as each lands, then it opens", async () => {
    let send!: (event: object) => void;
    let close!: () => void;
    const encoder = new TextEncoder();
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (
          path === "/api/interview/documents" &&
          (init?.method ?? "GET") === "POST"
        )
          return Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  send = (event) =>
                    controller.enqueue(
                      encoder.encode(`${JSON.stringify(event)}\n`),
                    );
                  close = () => controller.close();
                },
              }),
              { headers: { "content-type": "application/x-ndjson" } },
            ),
          );
        return original(input, init);
      }),
    );
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByText("Writing your document")).toBeVisible();
    expect(screen.getByText("Reading your experience…")).toBeVisible();
    await waitFor(() => expect(send).toBeDefined());
    send({
      t: "plan",
      batches: [
        { id: "batch-1", title: "Header", count: 7 },
        { id: "batch-2", title: "Core skills", count: 7 },
      ],
      fixed: { company_name: "Northwind" },
    });
    expect(await screen.findByText("0 of 2 sections")).toBeVisible();
    expect(screen.getByText("Core skills")).toBeVisible();
    send({
      t: "batch",
      id: "batch-1",
      title: "Header",
      values: { full_name: "Ada" },
    });
    expect(await screen.findByText("1 of 2 sections")).toBeVisible();
    // The page is redrawn from what has landed so far.
    await waitFor(() => {
      const drawn = calls.filter(
        (call) => call.method === "POST" && call.path.endsWith("/preview"),
      );
      expect(drawn.length).toBeGreaterThan(1);
      expect(drawn.at(-1)?.body).toMatchObject({
        values: { company_name: "Northwind", full_name: "Ada" },
      });
    });
    send({
      t: "batch",
      id: "batch-2",
      title: "Core skills",
      values: {},
    });
    send({ t: "done", document: { id: DOCUMENT_ID }, errors: [] });
    close();
    expect(await screen.findByText("Done. Opening it…")).toBeVisible();
    await waitFor(
      () => expect(actions.go).toHaveBeenCalledWith("documents", [DOCUMENT_ID]),
      { timeout: 4000 },
    );
  });

  it("asks before the page is left while a document is being written, and not otherwise", async () => {
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === "/api/interview/documents" &&
        (init?.method ?? "GET") === "POST"
          ? new Promise<Response>((_resolve, reject) =>
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("Aborted", "AbortError")),
              ),
            )
          : original(input, init),
      ),
    );
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await screen.findByText("Writing your document");
    expect(leave()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel generation" }));
    await waitFor(() => expect(leave()).toBe(false));
  });

  it("says when another window is already writing the same document", async () => {
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === "/api/interview/documents" &&
        (init?.method ?? "GET") === "POST"
          ? Promise.resolve(
              Response.json(
                { inProgress: true, offer: "wait" },
                { status: 409 },
              ),
            )
          : original(input, init),
      ),
    );
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "already being written in another window",
    );
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
  });

  it("returns to the form with the reason when writing fails part way", async () => {
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === "/api/interview/documents" &&
        (init?.method ?? "GET") === "POST"
          ? Promise.resolve(
              new Response(
                `${JSON.stringify({ t: "plan", batches: [], fixed: {} })}\n${JSON.stringify({ t: "error", code: "generation-failed" })}\n`,
                { headers: { "content-type": "application/x-ndjson" } },
              ),
            )
          : original(input, init),
      ),
    );
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be completed",
    );
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
  });

  it("creates a new application first, then writes the document for it", async () => {
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    fireEvent.click(screen.getByRole("radio", { name: /New application/ }));
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "Zensurance" },
    });
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "Tech Lead" },
    });
    fireEvent.change(screen.getByLabelText("Job description"), {
      target: { value: "Own payments" },
    });
    expect(screen.getByText(/Resume — Zensurance/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(
      () => expect(actions.go).toHaveBeenCalledWith("documents", [DOCUMENT_ID]),
      { timeout: 4000 },
    );
    const order = calls
      .filter((call) => call.method === "POST")
      .map((call) => call.path);
    expect(order.indexOf("/api/interview/documents/candidacies")).toBeLessThan(
      order.indexOf("/api/interview/documents"),
    );
    expect(posted("/candidacies")?.body).toEqual({
      companyName: "Zensurance",
      title: "Tech Lead",
      jobDescription: "Own payments",
    });
    expect(posted("/api/interview/documents")?.body).toMatchObject({
      candidacyId: NEW_CANDIDACY_ID,
      interviewId: null,
    });
  });

  it("prepares for a new application with a stage made on the spot", async () => {
    context.candidacies = [];
    context.interviews = [];
    templateCatalog = [
      listed(template),
      listed({
        ...template,
        id: PREP_TEMPLATE_ID,
        name: "Interview prep",
        kind: "interview_prep",
        format: "md",
      }),
    ];
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    fireEvent.click(screen.getByRole("button", { name: /Interview prep/ }));
    expect(
      screen.getByRole("radio", { name: /New application/ }),
    ).toBeChecked();
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "Roofr" },
    });
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "Senior Engineer" },
    });
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Technical" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() =>
      expect(posted("/api/interview/documents")).toBeTruthy(),
    );
    expect(posted("/candidacies")?.body).toMatchObject({
      companyName: "Roofr",
      interview: { kind: "technical", label: "Technical" },
    });
    expect(posted("/api/interview/documents")?.body).toMatchObject({
      candidacyId: NEW_CANDIDACY_ID,
      interviewId: NEW_INTERVIEW_ID,
    });
  });

  it("preselects a stage for prep when the application has none, so Generate is ready", async () => {
    context.interviews = [];
    templateCatalog = [
      listed(template),
      listed({
        ...template,
        id: PREP_TEMPLATE_ID,
        name: "Interview prep",
        kind: "interview_prep",
        format: "md",
      }),
    ];
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    fireEvent.click(screen.getByRole("button", { name: /Interview prep/ }));
    expect(
      screen.getByRole("button", { name: "Hiring manager" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
    expect(
      screen.getByText(/Interview prep — Northwind · Hiring manager/),
    ).toBeVisible();
  });

  it("adds a stage to an existing application when prep needs one it doesn't have", async () => {
    templateCatalog = [
      listed(template),
      listed({
        ...template,
        id: PREP_TEMPLATE_ID,
        name: "Interview prep",
        kind: "interview_prep",
        format: "md",
      }),
    ];
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    fireEvent.click(screen.getByRole("button", { name: /Interview prep/ }));
    fireEvent.click(screen.getByRole("button", { name: "System design" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() =>
      expect(posted("/api/interview/documents")).toBeTruthy(),
    );
    expect(posted(`/candidacies/${CANDIDACY_ID}/interviews`)?.body).toEqual({
      kind: "system_design",
      label: "System design",
    });
    expect(posted("/api/interview/documents")?.body).toMatchObject({
      candidacyId: CANDIDACY_ID,
      interviewId: NEW_INTERVIEW_ID,
    });
  });

  it("saves a candidacy job description before generating from it", async () => {
    context.candidacies[0]!.job_description = "";
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    fireEvent.click(
      screen.getByRole("radio", { name: /Northwind · Engineer/ }),
    );
    fireEvent.change(screen.getByLabelText("Job description"), {
      target: { value: "Build reliable systems" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(
      () => expect(actions.go).toHaveBeenCalledWith("documents", [DOCUMENT_ID]),
      { timeout: 4000 },
    );
    const saveIndex = calls.findIndex(
      (call) =>
        call.method === "PATCH" && call.path.endsWith("/job-description"),
    );
    const generateIndex = calls.findIndex(
      (call) =>
        call.method === "POST" && call.path === "/api/interview/documents",
    );
    expect(saveIndex).toBeGreaterThan(-1);
    expect(generateIndex).toBeGreaterThan(saveIndex);
    expect(calls[saveIndex]?.body).toEqual({
      jobDescription: "Build reliable systems",
    });
  });

  it("points at the existing document instead of generating a duplicate", async () => {
    context.profiles[0]!.revision = 2;
    documentInterviewId = null;
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    fireEvent.click(
      screen.getByRole("radio", { name: /Northwind · Engineer/ }),
    );
    expect(
      screen.getByText(/You already have “Resume for Northwind”/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    expect(actions.go).toHaveBeenCalledWith("documents", [DOCUMENT_ID]);
  });

  it("treats a newer experience revision as a new document, not a duplicate", async () => {
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    fireEvent.click(
      screen.getByRole("radio", { name: /Northwind · Engineer/ }),
    );
    expect(screen.queryByText(/You already have/)).not.toBeInTheDocument();
  });
});

describe("Document editor", () => {
  it("previews drafts and saves a revision when a field loses focus", async () => {
    renderAt([DOCUMENT_ID]);
    const name = await screen.findByRole("textbox", { name: "Full name" });
    expect(name).toHaveValue("Ada");
    expect(
      screen.getByRole("textbox", { name: "Company name" }),
    ).toHaveAttribute("readonly");
    fireEvent.focus(name);
    fireEvent.change(name, { target: { value: "Ada Lovelace" } });
    expect(screen.getByText("Editing…")).toBeVisible();
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === "POST" &&
            call.path.endsWith(`/${DOCUMENT_ID}/preview`) &&
            (call.body as { values: Record<string, string> }).values[
              "full_name"
            ] === "Ada Lovelace",
        ),
      ).toBe(true),
    );
    expect(screen.getByTitle("Document preview")).toHaveAttribute(
      "sandbox",
      "allow-same-origin",
    );
    expect(posted(`/${DOCUMENT_ID}/revisions`)).toBeUndefined();
    fireEvent.blur(name);
    await waitFor(() => expect(currentRevision).toBe(2));
    expect(posted(`/${DOCUMENT_ID}/revisions`)?.body).toMatchObject({
      baseRevision: 1,
      values: { full_name: "Ada Lovelace", company_name: "Northwind" },
    });
    expect(await screen.findByText("Saved as rev 2")).toBeVisible();
    expect(await screen.findByText("Saved · rev 2")).toBeVisible();
  });

  it("zooms the preview and hides the fields to focus on the document", async () => {
    renderAt([DOCUMENT_ID]);
    await screen.findByRole("textbox", { name: "Full name" });
    expect(screen.getByText("Fit")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("100%")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("110%")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Fit to width" }));
    expect(screen.getByText("Fit")).toBeVisible();
    const body = screen
      .getByRole("region", { name: "Document fields" })
      .closest(".dx-editor-body");
    expect(body).toHaveAttribute("data-focus", "false");
    fireEvent.click(
      screen.getByRole("button", { name: "Focus on the document" }),
    );
    expect(body).toHaveAttribute("data-focus", "true");
    fireEvent.click(screen.getByRole("button", { name: "Show fields" }));
    expect(body).toHaveAttribute("data-focus", "false");
  });

  it("groups fields by where their values come from", async () => {
    renderAt([DOCUMENT_ID]);
    await screen.findByRole("textbox", { name: "Full name" });
    expect(screen.getByText("From the application")).toBeVisible();
    expect(screen.getByText("Written from your experience")).toBeVisible();
    expect(screen.getByText("All 2 valid")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Needs attention/ }));
    expect(screen.getByText("Nothing needs attention")).toBeVisible();
  });

  it("lists revisions, opens an older one read-only, and restores it", async () => {
    currentRevision = 2;
    revisionValues[2] = { full_name: "Ada latest", company_name: "Northwind" };
    renderAt([DOCUMENT_ID]);
    await screen.findByRole("textbox", { name: "Full name" });
    fireEvent.click(screen.getByRole("button", { name: /Rev 2/ }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Rev 1.*Generated/ }),
    );
    await screen.findByText("Viewing rev 1 of 2. Read-only.");
    expect(screen.getByRole("textbox", { name: "Full name" })).toHaveValue(
      "Ada",
    );
    expect(screen.getByRole("textbox", { name: "Full name" })).toHaveAttribute(
      "readonly",
    );
    fireEvent.click(screen.getByRole("button", { name: "Restore as rev 3" }));
    await waitFor(() => expect(posted(`/${DOCUMENT_ID}/restore`)).toBeTruthy());
    expect(posted(`/${DOCUMENT_ID}/restore`)?.body).toMatchObject({
      baseRevision: 2,
      sourceRevision: 1,
    });
  });

  it("exports the shown revision and keeps earlier exports downloadable", async () => {
    currentRevision = 2;
    revisionValues[2] = { full_name: "Ada latest", company_name: "Northwind" };
    exports = [{ ...exportRow, revision: 1 }];
    renderAt([DOCUMENT_ID]);
    await screen.findByRole("textbox", { name: "Full name" });
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByText("EXPORT REV 2")).toBeVisible();
    expect(screen.getByText("PREVIOUS EXPORTS")).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: /Word document/ }));
    await waitFor(() => expect(posted(`/${DOCUMENT_ID}/exports`)).toBeTruthy());
    expect(posted(`/${DOCUMENT_ID}/exports`)?.body).toEqual({
      revision: 2,
      format: "docx",
    });
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(await screen.findByText("Exported rev 2 as DOCX")).toBeVisible();
  });

  it("shows draft review state and confirms only the current saved revision", async () => {
    renderAt([DOCUMENT_ID]);
    await screen.findByRole("textbox", { name: "Full name" });
    await waitFor(() =>
      expect(
        screen.getByLabelText("Candidate review status"),
      ).toHaveTextContent("Draft — review model prose"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm reviewed" }));
    await waitFor(() => expect(posted(`/${DOCUMENT_ID}/confirm`)).toBeTruthy());
    expect(posted(`/${DOCUMENT_ID}/confirm`)?.body).toEqual({
      baseRevision: 1,
    });
    expect(await screen.findByText("Candidate confirmed")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh source facts" }),
    );
    await waitFor(() =>
      expect(posted(`/${DOCUMENT_ID}/refresh-sources`)).toBeTruthy(),
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText("Candidate review status"),
      ).toHaveTextContent("Draft — review model prose"),
    );
  });

  it("warns that missing fields export blank and still offers Markdown", async () => {
    validationIssues = [{ key: "full_name", code: "missing" }];
    renderAt([DOCUMENT_ID]);
    await screen.findByRole("textbox", { name: "Full name" });
    expect(screen.getByText("1 / 2 need attention")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByText(/Missing fields export blank/)).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: /Markdown/ }));
    await waitFor(() => expect(posted(`/${DOCUMENT_ID}/exports`)).toBeTruthy());
    expect(posted(`/${DOCUMENT_ID}/exports`)?.body).toMatchObject({
      format: "md",
    });
  });

  it("regenerates only what needs attention, or every profile field", async () => {
    validationIssues = [{ key: "full_name", code: "missing" }];
    renderAt([DOCUMENT_ID]);
    await screen.findByRole("textbox", { name: "Full name" });
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: /Fix fields that need attention/ }),
    );
    await waitFor(() =>
      expect(posted(`/${DOCUMENT_ID}/regenerate`)).toBeTruthy(),
    );
    expect(posted(`/${DOCUMENT_ID}/regenerate`)?.body).toEqual({
      baseRevision: 1,
      mode: "fix",
      aiTargetId: "target-1",
    });
    await waitFor(() => expect(currentRevision).toBe(2));
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", {
          name: /Fix fields that need attention/,
        }),
      ).toBeDisabled(),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: /Regenerate every field/ }),
    );
    await waitFor(() => expect(currentRevision).toBe(3));
  });

  it("regenerates one profile field and never offers it for candidacy fields", async () => {
    renderAt([DOCUMENT_ID]);
    await screen.findByRole("textbox", { name: "Full name" });
    expect(
      screen.queryByRole("button", { name: "Regenerate Company name" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Regenerate Full name" }),
    );
    await waitFor(() =>
      expect(posted(`/${DOCUMENT_ID}/regenerate`)).toBeTruthy(),
    );
    expect(posted(`/${DOCUMENT_ID}/regenerate`)?.body).toEqual({
      baseRevision: 1,
      fieldKey: "full_name",
      aiTargetId: "target-1",
    });
  });

  it("offers a fresh document when the experience matrix has moved on", async () => {
    renderAt([DOCUMENT_ID]);
    await screen.findByRole("textbox", { name: "Full name" });
    expect(screen.getByText(/newer revision \(rev 3\)/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "New with rev 3" }));
    expect(actions.go).toHaveBeenCalledWith("documents", ["new"]);
  });

  it("lets a general resume fill missing role and interview fields without a linked candidacy", async () => {
    documentCandidacyId = null;
    documentInterviewId = null;
    editorFields = [
      fields[0]!,
      {
        key: "target_role",
        label: "Target role",
        source: "candidacy",
        required: true,
        maxLength: null,
      },
      {
        key: "interview_stage",
        label: "Interview stage",
        source: "interview",
        required: false,
        maxLength: null,
      },
    ];
    revisionValues[1] = {
      full_name: "Ada",
      target_role: "",
      interview_stage: "",
    };
    renderAt([DOCUMENT_ID]);
    const role = await screen.findByRole("textbox", { name: "Target role" });
    const stage = screen.getByRole("textbox", { name: "Interview stage" });
    expect(role).not.toHaveAttribute("readonly");
    expect(stage).not.toHaveAttribute("readonly");
    fireEvent.focus(role);
    fireEvent.change(role, { target: { value: "Platform engineer" } });
    fireEvent.change(stage, { target: { value: "Screening" } });
    fireEvent.blur(role);
    await waitFor(() => expect(currentRevision).toBe(2));
    expect(posted(`/${DOCUMENT_ID}/revisions`)?.body).toMatchObject({
      baseRevision: 1,
      values: {
        target_role: "Platform engineer",
        interview_stage: "Screening",
      },
    });
  });

  it("shows a stale revision error without changing the editor value", async () => {
    saveConflict = true;
    renderAt([DOCUMENT_ID]);
    const name = await screen.findByRole("textbox", { name: "Full name" });
    fireEvent.focus(name);
    fireEvent.change(name, { target: { value: "Ada edited" } });
    fireEvent.blur(name);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A newer revision exists",
    );
    expect(name).toHaveValue("Ada edited");
    expect(currentRevision).toBe(1);
  });

  it("offers retry when a selected document cannot load", async () => {
    stubFetchFor((path) =>
      path.endsWith(`/${DOCUMENT_ID}`)
        ? new Response("Internal Server Error", { status: 500 })
        : undefined,
    );
    renderAt([DOCUMENT_ID]);
    expect(
      await screen.findByRole("heading", { name: "Document could not load" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });
});

describe("Templates", () => {
  it("lists templates with kind, format, field count, and documents using them", async () => {
    renderAt(["templates"]);
    const row = await screen.findByRole("row", { name: /Resume/ });
    expect(within(row).getByText("Built-in · rev 1")).toBeVisible();
    expect(within(row).getByText("DOCX")).toBeVisible();
    expect(within(row).getByText("2")).toBeVisible();
    expect(within(row).getByText("1 doc")).toBeVisible();
    fireEvent.click(row);
    expect(actions.go).toHaveBeenCalledWith("documents", [
      "templates",
      TEMPLATE_ID,
    ]);
  });

  it("keeps built-in templates read-only and offers duplication", async () => {
    renderAt(["templates", TEMPLATE_ID]);
    await screen.findByText("Built-in templates are read-only.");
    expect(screen.getByLabelText("GENERATION INSTRUCTIONS")).toHaveAttribute(
      "readonly",
    );
    expect(
      screen.queryByRole("button", { name: "Upload new version" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("{full_name}")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate to customize" }),
    );
    await waitFor(() =>
      expect(posted(`/templates/${TEMPLATE_ID}/duplicate`)).toBeTruthy(),
    );
    expect(posted(`/templates/${TEMPLATE_ID}/duplicate`)?.body).toEqual({
      name: "Resume (copy)",
    });
    expect(actions.go).toHaveBeenCalledWith("documents", [
      "templates",
      OWNED_TEMPLATE_A,
    ]);
  });

  it("uploads a Markdown template; fields come from the file", async () => {
    renderAt(["templates"]);
    await screen.findByRole("row", { name: /Resume/ });
    fireEvent.click(screen.getByRole("button", { name: "Upload template" }));
    expect(
      screen.getByRole("button", { name: "Save template" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Template file"), {
      target: {
        files: [
          new File(["# {{full_name}}"], "notes.md", { type: "text/markdown" }),
        ],
      },
    });
    expect(await screen.findByText("1 fields found")).toBeVisible();
    expect(screen.getByLabelText("Name")).toHaveValue("notes");
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Practice notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Interview prep" }));
    fireEvent.change(screen.getByLabelText("Generation instructions"), {
      target: { value: "Use concise evidence." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(posted("/templates")).toBeTruthy());
    const upload = posted("/templates")?.body as FormData;
    expect(upload.get("name")).toBe("Practice notes");
    expect(upload.get("kind")).toBe("interview_prep");
    expect(upload.get("format")).toBe("md");
    expect(upload.get("instructions")).toBe("Use concise evidence.");
    expect(upload.get("file")).toBeInstanceOf(File);
    expect(upload.get("fields")).toBeNull();
    await waitFor(() =>
      expect(actions.go).toHaveBeenCalledWith("documents", [
        "templates",
        OWNED_TEMPLATE_B,
      ]),
    );
  });

  it("rejects a file that is neither .docx nor .md", async () => {
    renderAt(["templates"]);
    await screen.findByRole("row", { name: /Resume/ });
    fireEvent.click(screen.getByRole("button", { name: "Upload template" }));
    fireEvent.change(screen.getByLabelText("Template file"), {
      target: { files: [new File(["x"], "notes.txt")] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a .docx or .md file.",
    );
    expect(posted("/templates/intake")).toBeUndefined();
  });

  it("saves edited instructions as the next template revision", async () => {
    templateCatalog = [
      listed({
        ...template,
        id: OWNED_TEMPLATE_A,
        name: "Template A",
        ownerUserId: "member",
      }),
    ];
    renderAt(["templates", OWNED_TEMPLATE_A]);
    const instructions = await screen.findByDisplayValue("Instructions for A");
    expect(
      screen.queryByRole("button", { name: /Save as rev/ }),
    ).not.toBeInTheDocument();
    fireEvent.change(instructions, { target: { value: "Be brief." } });
    fireEvent.click(screen.getByRole("button", { name: "Save as rev 2" }));
    await waitFor(() =>
      expect(
        posted(`/templates/${OWNED_TEMPLATE_A}/instructions`),
      ).toBeTruthy(),
    );
    expect(posted(`/templates/${OWNED_TEMPLATE_A}/instructions`)?.body).toEqual(
      {
        expectedRevision: 1,
        instructions: "Be brief.",
      },
    );
    expect(await screen.findByText("Template A saved as rev 2")).toBeVisible();
  });

  it("uploads a new version for the selected template only, with its own instructions", async () => {
    templateCatalog = [
      listed({
        ...template,
        id: OWNED_TEMPLATE_A,
        name: "Template A",
        ownerUserId: "member",
      }),
      listed({
        ...template,
        id: OWNED_TEMPLATE_B,
        name: "Template B",
        ownerUserId: "member",
      }),
    ];
    const { rerender } = renderAt(["templates", OWNED_TEMPLATE_A]);
    await screen.findByDisplayValue("Instructions for A");
    rerender(
      <DocumentsView
        rest={["templates", OWNED_TEMPLATE_B]}
        actions={actions}
        onDirtyChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByDisplayValue("Instructions for A"),
    ).not.toBeInTheDocument();
    await screen.findByDisplayValue("Instructions for B");
    fireEvent.change(screen.getByLabelText("New template version file"), {
      target: { files: [new File(["{{full_name}}"], "b.docx")] },
    });
    await waitFor(() =>
      expect(posted(`/templates/${OWNED_TEMPLATE_B}/revisions`)).toBeTruthy(),
    );
    expect(posted(`/templates/${OWNED_TEMPLATE_A}/revisions`)).toBeUndefined();
    const upload = posted(`/templates/${OWNED_TEMPLATE_B}/revisions`)
      ?.body as FormData;
    expect(upload.get("instructions")).toBe("Instructions for B");
    expect(upload.get("expectedRevision")).toBe("1");
    expect((upload.get("file") as File).name).toBe("b.docx");
  });
});
