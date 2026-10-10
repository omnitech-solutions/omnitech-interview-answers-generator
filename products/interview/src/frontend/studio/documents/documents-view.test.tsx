import type { DocumentFieldError } from "@omnitech/interview-contracts";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioActions } from "../config/commands";
import { keyOpen, pointerOpen } from "../live/overlay/panels/toolbar-test-kit";
import type {
  DocumentContext,
  DocumentReview,
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

type Call = {
  method: string;
  path: string;
  body: unknown;
  accept: string | null;
};
let calls: Call[];
let currentRevision: number;
let revisionValues: Record<number, Record<string, string>>;
let exports: (typeof exportRow)[];
let validationIssues: DocumentFieldError[];
// How the server says the document stands (confirmations, the cast), and
// which fields are the model's.
let review: DocumentReview | undefined;
let modelOwnedKeys: string[];
let saveConflict: boolean;
let templateCatalog: TemplateListItem[];
let editorFields: Array<
  (typeof fields)[number] & {
    group?: { id: string; kind: string; part: string; optional?: boolean };
  }
>;
let documentCandidacyId: string | null;
let documentInterviewId: string | null;
let claimState: "unverified" | "confirmed";
let firstRevisionKind: "generated" | "manual";

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
  review = undefined;
  modelOwnedKeys = ["full_name"];
  claimState = "unverified";
  firstRevisionKind = "generated";
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
      calls.push({
        method,
        path,
        body,
        accept: new Headers(init?.headers).get("accept"),
      });
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
      // Made by hand: one plain answer with the saved document, nothing streamed.
      if (
        path === "/api/interview/documents" &&
        method === "POST" &&
        (body as { mode?: string }).mode === "manual"
      )
        return Response.json(
          {
            document: { id: DOCUMENT_ID },
            revision: { revision: 1 },
            errors: [{ key: "full_name", code: "missing" }],
          },
          { status: 201 },
        );
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
        // "Confirmed by me" clears that field's failure, as the server does.
        const confirmed = (body as { confirm?: string[] }).confirm ?? [];
        if (confirmed.length) {
          validationIssues = validationIssues.filter(
            (issue) => !confirmed.includes(issue.key),
          );
          review = {
            contactKeys: review?.contactKeys ?? [],
            cast: review?.cast ?? null,
            confirmedFields: confirmed,
          };
        }
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
      if (path.endsWith(`/${DOCUMENT_ID}/cast`) && method === "POST") {
        currentRevision++;
        revisionValues[currentRevision] = {
          ...revisionValues[currentRevision - 1]!,
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
              kind: revision === 1 ? firstRevisionKind : "edited",
              modelOwnedKeys,
              claimState,
            },
            createdAt: "2026-10-02",
          },
          template,
          fields: editorFields,
          ...(review ? { review } : {}),
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

// A test that takes the browser's storage away gives it back: later tests
// use it.
afterEach(() => {
  vi.restoreAllMocks();
});

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
    expect(
      screen.getByRole("button", { name: "Generate with AI" }),
    ).toBeDisabled();
  });

  it("creates from candidacy, profile revision, and model", async () => {
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    fireEvent.click(
      screen.getByRole("radio", { name: /Northwind · Engineer/ }),
    );
    expect(screen.getByText(/Resume — Northwind/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
    await waitFor(() =>
      expect(posted("/api/interview/documents")).toBeTruthy(),
    );
    expect(posted("/api/interview/documents")?.body).toMatchObject({
      aiTargetId: "agent/claude-code",
    });
  });

  it("says so when the assistant's model cannot write documents", async () => {
    context.targets = [
      { id: "target-1", label: "Primary model", kind: "model" },
      {
        id: "agent/claude-code",
        label: "Claude Code",
        kind: "agent",
      },
    ];
    localStorage.setItem(
      "omnitech-assistant:model",
      '"lm-studio/qwen3-coder-30b"',
    );
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    expect(screen.getByText(/can't write documents/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "already being written in another window",
    );
    expect(
      screen.getByRole("button", { name: "Generate with AI" }),
    ).toBeEnabled();
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
    fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be completed",
    );
    expect(
      screen.getByRole("button", { name: "Generate with AI" }),
    ).toBeEnabled();
  });

  it("creates a new application first, then writes the document for it", async () => {
    renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    fireEvent.click(screen.getByRole("radio", { name: /New application/ }));
    expect(
      screen.getByRole("button", { name: "Generate with AI" }),
    ).toBeDisabled();
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
    fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
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
    expect(
      screen.getByRole("button", { name: "Generate with AI" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Technical" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
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
    expect(
      screen.getByRole("button", { name: "Generate with AI" }),
    ).toBeEnabled();
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
    fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
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

  // The footer's split button: its main half does the remembered choice, its
  // caret opens the menu that offers the two.
  const MODE_KEY = "interview-studio.documents.creation-mode";
  const modeCaret = () =>
    screen.getByRole("button", { name: "Choose how the document is made" });
  const modeMenu = () =>
    within(screen.getByRole("menu", { name: "How the document is made" }));
  const chooseMode = (name: RegExp) => {
    pointerOpen(modeCaret());
    fireEvent.click(modeMenu().getByRole("menuitemradio", { name }));
  };
  const openNew = async () => {
    const view = renderAt(["new"]);
    await screen.findByRole("dialog", { name: "New document" });
    return view;
  };

  it("writes with AI by default and says so in the button, the menu and the summary", async () => {
    await openNew();
    expect(
      screen.getByRole("button", { name: "Generate with AI" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Create manually" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("2 fields · DOCX · written in a few parallel calls"),
    ).toBeVisible();
    pointerOpen(modeCaret());
    const items = modeMenu().getAllByRole("menuitemradio");
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
    ]);
    expect(items[0]).toHaveTextContent("Generate with AI");
    expect(items[0]).toHaveTextContent(
      "Primary model writes the fields in a few parallel calls",
    );
    expect(items[1]).toHaveTextContent("Create manually");
    expect(items[1]).toHaveTextContent("No AI call");
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
  });

  it("changes the main button and the summary when manual is chosen, without making anything", async () => {
    await openNew();
    chooseMode(/Create manually/);
    expect(
      screen.getByRole("button", { name: "Create manually" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Generate with AI" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("2 fields · DOCX · you write the fields · no AI call"),
    ).toBeVisible();
    expect(screen.queryByText(/parallel calls/)).not.toBeInTheDocument();
    expect(posted("/api/interview/documents")).toBeUndefined();
    // The menu announces the choice now in force.
    pointerOpen(modeCaret());
    expect(
      modeMenu().getByRole("menuitemradio", { name: /Create manually/ }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      modeMenu().getByRole("menuitemradio", { name: /Generate with AI/ }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("remembers the last choice the next time the dialog opens, in either direction", async () => {
    const first = await openNew();
    chooseMode(/Create manually/);
    expect(localStorage.getItem(MODE_KEY)).toBe("manual");
    first.unmount();
    const second = await openNew();
    expect(
      screen.getByRole("button", { name: "Create manually" }),
    ).toBeVisible();
    expect(screen.getByText(/you write the fields · no AI call/)).toBeVisible();
    chooseMode(/Generate with AI/);
    expect(localStorage.getItem(MODE_KEY)).toBe("ai");
    second.unmount();
    await openNew();
    expect(
      screen.getByRole("button", { name: "Generate with AI" }),
    ).toBeVisible();
  });

  it("ignores a stored choice that is not one of the two", async () => {
    for (const stored of ["Manual", "", "both", '"manual"']) {
      localStorage.setItem(MODE_KEY, stored);
      const view = await openNew();
      expect(
        screen.getByRole("button", { name: "Generate with AI" }),
      ).toBeVisible();
      expect(screen.getByText(/written in a few parallel calls/)).toBeVisible();
      view.unmount();
    }
  });

  it("falls back to AI when the browser's storage cannot be read or written", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await openNew();
    expect(
      screen.getByRole("button", { name: "Generate with AI" }),
    ).toBeVisible();
    chooseMode(/Create manually/);
    expect(
      screen.getByRole("button", { name: "Create manually" }),
    ).toBeVisible();
  });

  it("creates manually from the same choices with no generation request, then opens the document", async () => {
    await openNew();
    fireEvent.click(
      screen.getByRole("radio", { name: /Northwind · Engineer/ }),
    );
    chooseMode(/Create manually/);
    fireEvent.click(screen.getByRole("button", { name: "Create manually" }));
    await waitFor(() =>
      expect(actions.go).toHaveBeenCalledWith("documents", [DOCUMENT_ID]),
    );
    const creates = calls.filter(
      (call) =>
        call.method === "POST" && call.path === "/api/interview/documents",
    );
    expect(creates).toHaveLength(1);
    // The same selection as a generated document, with no model named.
    expect(creates[0]?.body).toEqual({
      title: "Resume — Northwind",
      templateId: TEMPLATE_ID,
      templateRevision: 1,
      profileId: "profile-1",
      profileRevision: 3,
      candidacyId: CANDIDACY_ID,
      interviewId: null,
      mode: "manual",
    });
    // No stream is asked for, nothing is drawn as "being written", and no
    // other request that would reach a model is made.
    expect(creates[0]?.accept ?? "").not.toContain("x-ndjson");
    expect(screen.queryByText("Writing your document")).not.toBeInTheDocument();
    expect(
      calls.filter(
        (call) =>
          call.method === "POST" &&
          (call.path.endsWith("/preview") ||
            call.path.endsWith("/regenerate") ||
            call.path.endsWith("/brief")),
      ),
    ).toEqual([]);
  });

  it("creates manually when no model is available, and says the document can still be made", async () => {
    stubFetchFor((path) =>
      path.endsWith("/context")
        ? Response.json({ ...context, targets: [] })
        : undefined,
    );
    await openNew();
    expect(
      screen.getByRole("button", { name: "Generate with AI" }),
    ).toBeDisabled();
    chooseMode(/Create manually/);
    expect(
      screen.getByText(/You can still create the document manually/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create manually" }));
    await waitFor(() =>
      expect(actions.go).toHaveBeenCalledWith("documents", [DOCUMENT_ID]),
    );
    expect(posted("/api/interview/documents")?.body).not.toHaveProperty(
      "aiTargetId",
    );
  });

  it("still needs an experience matrix and a complete application to create manually", async () => {
    localStorage.setItem(MODE_KEY, "manual");
    await openNew();
    fireEvent.click(screen.getByRole("radio", { name: /New application/ }));
    expect(
      screen.getByRole("button", { name: "Create manually" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "Zensurance" },
    });
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "Tech Lead" },
    });
    expect(
      screen.getByText(/Saved to this application when you create/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create manually" }));
    await waitFor(() =>
      expect(actions.go).toHaveBeenCalledWith("documents", [DOCUMENT_ID]),
    );
    // The application is made first, exactly as it is before generating.
    const order = calls
      .filter((call) => call.method === "POST")
      .map((call) => call.path);
    expect(order.indexOf("/api/interview/documents/candidacies")).toBeLessThan(
      order.indexOf("/api/interview/documents"),
    );
    expect(posted("/api/interview/documents")?.body).toMatchObject({
      candidacyId: NEW_CANDIDACY_ID,
      interviewId: null,
      mode: "manual",
    });
  });

  it("adds the stage interview prep needs before creating manually", async () => {
    templateCatalog = [
      listed(template),
      listed({
        ...template,
        id: PREP_TEMPLATE_ID,
        name: "Interview prep",
        kind: "interview_prep",
      }),
    ];
    localStorage.setItem(MODE_KEY, "manual");
    await openNew();
    fireEvent.click(screen.getByRole("button", { name: /Interview prep/ }));
    fireEvent.click(screen.getByRole("button", { name: "Technical" }));
    fireEvent.click(screen.getByRole("button", { name: "Create manually" }));
    await waitFor(() =>
      expect(actions.go).toHaveBeenCalledWith("documents", [DOCUMENT_ID]),
    );
    expect(posted("/interviews")?.body).toEqual({
      kind: "technical",
      label: "Technical",
    });
    expect(posted("/api/interview/documents")?.body).toMatchObject({
      templateId: PREP_TEMPLATE_ID,
      candidacyId: CANDIDACY_ID,
      interviewId: NEW_INTERVIEW_ID,
      mode: "manual",
    });
  });

  it("points at the existing document when a manual create finds a match on the server", async () => {
    localStorage.setItem(MODE_KEY, "manual");
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === "/api/interview/documents" && init?.method === "POST"
          ? Promise.resolve(
              Response.json(
                { existingDocumentId: DOCUMENT_ID, offer: "open-it" },
                { status: 409 },
              ),
            )
          : original(input, init),
      ),
    );
    await openNew();
    fireEvent.click(screen.getByRole("button", { name: "Create manually" }));
    expect(
      await screen.findByText("A matching document already exists."),
    ).toBeVisible();
    expect(actions.go).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Create manually" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    expect(actions.go).toHaveBeenCalledWith("documents", [DOCUMENT_ID]);
  });

  it("returns to the form with the reason when a manual create fails", async () => {
    localStorage.setItem(MODE_KEY, "manual");
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === "/api/interview/documents" && init?.method === "POST"
          ? Promise.resolve(
              Response.json(
                { error: { code: "server-error" } },
                { status: 500 },
              ),
            )
          : original(input, init),
      ),
    );
    await openNew();
    fireEvent.click(screen.getByRole("button", { name: "Create manually" }));
    expect(
      (await screen.findAllByText(/Documents service returned an error/))[0],
    ).toBeVisible();
    expect(actions.go).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Create manually" }),
    ).toBeEnabled();
  });

  it("reaches the choice from the keyboard, and Escape closes the menu, not the dialog", async () => {
    await openNew();
    keyOpen(modeCaret());
    const items = modeMenu().getAllByRole("menuitemradio");
    expect(items).toHaveLength(2);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("dialog", { name: "New document" })).toBeVisible();
    expect(actions.go).not.toHaveBeenCalled();
    // ArrowDown on the main half opens the same menu.
    keyOpen(screen.getByRole("button", { name: "Generate with AI" }));
    fireEvent.keyDown(
      modeMenu().getByRole("menuitemradio", { name: /Create manually/ }),
      { key: "Enter" },
    );
    expect(
      await screen.findByRole("button", { name: "Create manually" }),
    ).toBeVisible();
    // With no menu open, Escape still closes the dialog.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(actions.go).toHaveBeenCalledWith("documents");
  });

  it("locks the choice while a document is being written", async () => {
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === "/api/interview/documents" && init?.method === "POST"
          ? new Promise<Response>(() => undefined)
          : original(input, init),
      ),
    );
    await openNew();
    fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
    expect(
      await screen.findByRole("button", { name: "Generating…" }),
    ).toBeDisabled();
    expect(modeCaret()).toHaveAttribute("aria-disabled", "true");
    pointerOpen(modeCaret());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
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

  it("opens a manually created document editable: blanks need attention, are written by hand, and no model is asked", async () => {
    firstRevisionKind = "manual";
    revisionValues = { 1: { full_name: "", company_name: "Northwind" } };
    validationIssues = [{ key: "full_name", code: "missing" }];
    renderAt([DOCUMENT_ID]);
    const name = await screen.findByRole("textbox", { name: "Full name" });
    expect(name).toHaveValue("");
    expect(name).not.toHaveAttribute("readonly");
    // What the application states is filled in and stays the application's.
    expect(screen.getByRole("textbox", { name: "Company name" })).toHaveValue(
      "Northwind",
    );
    expect(screen.getByText("1 / 2 need attention")).toBeVisible();
    fireEvent.focus(name);
    fireEvent.change(name, { target: { value: "Ada Lovelace" } });
    fireEvent.blur(name);
    await waitFor(() => expect(currentRevision).toBe(2));
    expect(posted(`/${DOCUMENT_ID}/revisions`)?.body).toMatchObject({
      baseRevision: 1,
      values: { full_name: "Ada Lovelace", company_name: "Northwind" },
    });
    expect(posted(`/${DOCUMENT_ID}/regenerate`)).toBeUndefined();
    fireEvent.click(await screen.findByRole("button", { name: /Rev 2/ }));
    expect(
      await screen.findByRole("menuitem", { name: /Rev 1.*Created manually/ }),
    ).toBeVisible();
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

describe("Document editor: verification, the three kinds of empty, and the cast", () => {
  const profileField = (
    key: string,
    label: string,
    group?: { id: string; kind: string; part: string; optional?: boolean },
  ) => ({
    key,
    label,
    source: "candidate-profile",
    required: true,
    maxLength: null,
    ...(group ? { group } : {}),
  });
  const unsupported: DocumentFieldError = {
    key: "contract1_bullet1",
    code: "unsupported",
    against: "Plotline",
    missing: [
      { text: "Compass", kind: "name", foundIn: "Tidewater Learning" },
      { text: "70%", kind: "figure" },
    ],
  };
  function resume() {
    editorFields = [
      profileField("email_address", "Email address"),
      profileField("summary", "Summary"),
      profileField("my_company_name", "My company name", {
        id: "consultancy",
        kind: "consultancy",
        part: "company",
        optional: true,
      }),
      profileField("my_company_role", "My company role", {
        id: "consultancy",
        kind: "consultancy",
        part: "title",
        optional: true,
      }),
      profileField("contract_company1", "Contract company1", {
        id: "contract-1",
        kind: "contract",
        part: "company",
        optional: true,
      }),
      profileField("contract1_bullet1", "Contract1 bullet1", {
        id: "contract-1",
        kind: "contract",
        part: "bullet",
        optional: true,
      }),
    ];
    modelOwnedKeys = ["summary", "contract1_bullet1"];
    revisionValues = {
      1: {
        email_address: "",
        summary: "",
        my_company_name: "",
        my_company_role: "",
        contract_company1: "Plotline",
        contract1_bullet1: "Integrated Tidewater into Compass, up 70%",
      },
    };
    review = {
      confirmedFields: [],
      contactKeys: ["email_address"],
      cast: null,
    };
  }

  it("disables Export while a field is unsupported, and its popover names each field with the reason and a link to it", async () => {
    resume();
    validationIssues = [unsupported];
    renderAt([DOCUMENT_ID]);
    await screen.findByRole("textbox", { name: "Contract1 bullet1" });
    // Export itself is disabled; the popover opens from the control around it.
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
    const control = screen.getByRole("button", {
      name: "Export is blocked: see why",
    });
    // The popover explains; the export menu never opens and nothing is sent.
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(control);
    const why = await screen.findByRole("dialog", {
      name: "Why export is blocked",
    });
    expect(
      within(why).getByText(/Export is blocked: 1 field says/),
    ).toBeVisible();
    expect(
      within(why).getByText(
        "“Compass” is from Tidewater Learning, not Plotline.",
      ),
    ).toBeVisible();
    expect(
      within(why).getByText("“70%” is not in the matrix entry for Plotline."),
    ).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: /Word document/ }),
    ).toBeNull();
    expect(posted(`/${DOCUMENT_ID}/exports`)).toBeUndefined();
    // The field's name is a link to the field.
    fireEvent.click(
      within(why).getByRole("button", { name: "Contract1 bullet1" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Why export is blocked" }),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Contract1 bullet1" }),
      ).toHaveFocus(),
    );
  });

  it("regenerates a single failing field in one click from the popover", async () => {
    resume();
    validationIssues = [unsupported];
    renderAt([DOCUMENT_ID]);
    await screen.findByRole("textbox", { name: "Contract1 bullet1" });
    // From the keyboard, too.
    const blocked = screen.getByRole("button", {
      name: "Export is blocked: see why",
    });
    blocked.focus();
    fireEvent.keyDown(blocked, { key: "Enter" });
    const why = await screen.findByRole("dialog", {
      name: "Why export is blocked",
    });
    fireEvent.click(
      within(why).getByRole("button", { name: "Regenerate Contract1 bullet1" }),
    );
    await waitFor(() =>
      expect(posted(`/${DOCUMENT_ID}/regenerate`)?.body).toEqual({
        baseRevision: 1,
        fieldKey: "contract1_bullet1",
        aiTargetId: "target-1",
      }),
    );
    // Fixed: Export is an ordinary control again.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Export" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(
      screen.getByRole("menuitem", { name: /Word document/ }),
    ).toBeVisible();
  });

  it("says on the field what was not found, and lets the person confirm it themselves", async () => {
    resume();
    validationIssues = [unsupported];
    renderAt([DOCUMENT_ID]);
    const bullet = await screen.findByRole("textbox", {
      name: "Contract1 bullet1",
    });
    expect(bullet).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Not in your experience matrix")).toBeVisible();
    expect(
      screen.getByText("“Compass” is from Tidewater Learning, not Plotline."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Regenerate this field" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmed by me" }));
    await waitFor(() => expect(currentRevision).toBe(2));
    expect(posted(`/${DOCUMENT_ID}/revisions`)?.body).toMatchObject({
      baseRevision: 1,
      confirm: ["contract1_bullet1"],
      values: {
        contract1_bullet1: "Integrated Tidewater into Compass, up 70%",
      },
    });
    // The failure is cleared and the field says who vouched for it.
    expect(await screen.findByText("Confirmed by you")).toBeVisible();
    expect(screen.queryByText("Not in your experience matrix")).toBeNull();
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
  });

  it("tells three kinds of empty field apart, and counts only the two that need something", async () => {
    resume();
    validationIssues = [
      { key: "email_address", code: "missing" },
      { key: "summary", code: "missing" },
    ];
    renderAt([DOCUMENT_ID]);
    await screen.findByRole("textbox", { name: "Email address" });
    // Missing, type it: a contact detail with no stored value.
    expect(screen.getByText("Missing: type it")).toBeVisible();
    expect(
      screen.getByText(/keep it in your contact details file on this machine/),
    ).toBeVisible();
    // No evidence: the model left it empty.
    expect(screen.getByText("No evidence")).toBeVisible();
    expect(
      screen.getByText(/your experience matrix has nothing to support it/),
    ).toBeVisible();
    // Does not apply: the consultancy block, quiet and collapsed, not a field
    // to fill and not counted.
    expect(
      screen.queryByRole("textbox", { name: "My company name" }),
    ).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "My company role" }),
    ).toBeNull();
    expect(screen.getByText("2 / 4 need attention")).toBeVisible();
    const quiet = screen.getByRole("button", {
      name: /Does not apply · 2 fields/,
    });
    expect(quiet).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(quiet);
    expect(await screen.findByText("My company name")).toBeVisible();
    expect(screen.getByText("My company role")).toBeVisible();
    // Only what needs attention is listed under that filter.
    fireEvent.click(screen.getByRole("button", { name: /Needs attention/ }));
    expect(
      screen.getByRole("textbox", { name: "Email address" }),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Summary" })).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "Contract1 bullet1" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Does not apply/ })).toBeNull();
    // Nothing blocks export: an empty field is not an unsupported claim.
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
  });

  it("says which client was left out and swaps it into a contract block", async () => {
    resume();
    review = {
      confirmedFields: [],
      contactKeys: ["email_address"],
      cast: {
        consultancy: "Larkspur Works",
        ranking: "model",
        leftOut: [{ id: "/roles/4", company: "Backerly", title: "Senior" }],
        contracts: [
          {
            block: "contract-1",
            id: "/roles/2",
            company: "Plotline",
            title: "Senior",
          },
          {
            block: "contract-2",
            id: "/roles/3",
            company: "Fleetmark",
            title: "Senior",
          },
        ],
      },
    };
    renderAt([DOCUMENT_ID]);
    await screen.findByRole("textbox", { name: "Contract1 bullet1" });
    expect(screen.getByText("Left out: Backerly")).toBeVisible();
    expect(
      screen.getByText(
        /Larkspur Works has 3 clients and this template has 2 contract blocks\. The most relevant to the posting were chosen\./,
      ),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Swap Backerly in for Fleetmark" }),
    );
    await waitFor(() =>
      expect(posted(`/${DOCUMENT_ID}/cast`)?.body).toEqual({
        baseRevision: 1,
        block: "contract-2",
        roleId: "/roles/4",
        aiTargetId: "target-1",
      }),
    );
    expect(
      await screen.findByText("Backerly swapped in as rev 2"),
    ).toBeVisible();
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
