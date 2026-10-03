import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioActions } from "../config/commands";
import type { Template, TemplateListItem } from "./documents-client";
import { DocumentsView } from "./documents-view";

const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const OWNED_TEMPLATE_A = "66666666-6666-4666-8666-666666666666";
const OWNED_TEMPLATE_B = "77777777-7777-4777-8777-777777777777";
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
const context = {
  profiles: [{ id: "profile-1", name: "Experience matrix", revision: 3 }],
  candidacies: [
    {
      id: CANDIDACY_ID,
      title: "Engineer",
      company_name: "Northwind",
      job_description: "Build systems",
    },
  ],
  interviews: [
    {
      id: INTERVIEW_ID,
      candidacy_id: CANDIDACY_ID,
      label: "Hiring manager",
      kind: "hiring-manager",
    },
  ],
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

function mockApi() {
  calls = [];
  currentRevision = 1;
  revisionValues = { 1: { full_name: "Ada", company_name: "Northwind" } };
  exports = [];
  validationIssues = [];
  saveConflict = false;
  templateCatalog = [{ template, latestRevision: 1 }];
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
        return Response.json({ template, latestRevision: 1 }, { status: 201 });
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
              updatedAt: "2026-10-02",
            },
          ],
        });
      if (path === "/api/interview/documents" && method === "POST")
        return Response.json(
          { document: { id: DOCUMENT_ID } },
          { status: 201 },
        );
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
        currentRevision++;
        revisionValues[currentRevision] = {
          ...revisionValues[currentRevision - 1]!,
          full_name: "Ada Regenerated",
        };
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
            provenance: { kind: revision === 1 ? "generated" : "edited" },
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

describe("Documents view", () => {
  it("explains missing setup data instead of leaving generation silently disabled", async () => {
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith("/context")
          ? Promise.resolve(
              Response.json({ ...context, profiles: [], targets: [] }),
            )
          : original(input, init),
      ),
    );
    render(
      <DocumentsView
        rest={["new"]}
        actions={actions}
        onDirtyChange={vi.fn()}
      />,
    );
    expect(await screen.findByText(/Save an experience matrix/)).toBeVisible();
    expect(screen.getByText(/No model is available/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Generate document" }),
    ).toBeDisabled();
  });

  it("offers retry when a selected document cannot load", async () => {
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith(`/${DOCUMENT_ID}`)
          ? Promise.resolve(
              new Response("Internal Server Error", { status: 500 }),
            )
          : original(input, init),
      ),
    );
    render(
      <DocumentsView
        rest={[DOCUMENT_ID]}
        actions={actions}
        onDirtyChange={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Document could not load" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("shows a recoverable error when the Documents service returns a non-JSON 500", async () => {
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith("/context")
          ? Promise.resolve(
              new Response("Internal Server Error", { status: 500 }),
            )
          : original(input, init),
      ),
    );
    render(
      <DocumentsView
        rest={["new"]}
        actions={actions}
        onDirtyChange={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Documents could not load" }),
    ).toBeVisible();
    expect(
      screen.getByText(/Check the server and database migrations/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.queryByText("Loading documents…")).not.toBeInTheDocument();
  });

  it("creates from candidacy, profile revision, and model", async () => {
    render(
      <DocumentsView
        rest={["new"]}
        actions={actions}
        onDirtyChange={vi.fn()}
      />,
    );
    await screen.findByRole("button", { name: "Generate document" });
    fireEvent.change(screen.getByLabelText("Candidacy"), {
      target: { value: CANDIDACY_ID },
    });
    fireEvent.change(screen.getByLabelText("Interview stage"), {
      target: { value: INTERVIEW_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate document" }));
    await waitFor(() =>
      expect(actions.go).toHaveBeenCalledWith("documents", [DOCUMENT_ID]),
    );
    const request = calls.find(
      (call) =>
        call.method === "POST" && call.path === "/api/interview/documents",
    );
    expect(request?.body).toMatchObject({
      templateId: TEMPLATE_ID,
      profileId: "profile-1",
      profileRevision: 3,
      candidacyId: CANDIDACY_ID,
      interviewId: INTERVIEW_ID,
      aiTargetId: "target-1",
    });
  });

  it("saves a candidacy job description before generating from it", async () => {
    context.candidacies[0]!.job_description = "";
    render(
      <DocumentsView
        rest={["new"]}
        actions={actions}
        onDirtyChange={vi.fn()}
      />,
    );
    await screen.findByRole("button", { name: "Generate document" });
    fireEvent.change(screen.getByLabelText("Candidacy"), {
      target: { value: CANDIDACY_ID },
    });
    fireEvent.change(screen.getByLabelText("Job description"), {
      target: { value: "Build reliable systems" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate document" }));
    await waitFor(() =>
      expect(actions.go).toHaveBeenCalledWith("documents", [DOCUMENT_ID]),
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
    context.candidacies[0]!.job_description = "Build systems";
  });

  it("previews drafts, saves revisions, restores older revisions, and downloads an export", async () => {
    render(
      <DocumentsView
        rest={[DOCUMENT_ID]}
        actions={actions}
        onDirtyChange={vi.fn()}
      />,
    );
    const name = await screen.findByRole("textbox", { name: "Full name" });
    expect(name).toHaveValue("Ada");
    expect(
      screen.getByRole("textbox", { name: "Company name" }),
    ).toHaveAttribute("readonly");
    fireEvent.change(name, { target: { value: "Ada Lovelace" } });
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
    const frame = screen.getByTitle("Document preview");
    expect(frame).toHaveAttribute("sandbox", "");
    fireEvent.click(screen.getByRole("button", { name: "Save new revision" }));
    await waitFor(() => expect(currentRevision).toBe(2));
    expect(
      calls.find(
        (call) =>
          call.method === "POST" &&
          call.path.endsWith(`/${DOCUMENT_ID}/revisions`),
      )?.body,
    ).toMatchObject({
      baseRevision: 1,
      values: { full_name: "Ada Lovelace", company_name: "Northwind" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Revision")).toHaveValue("2"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export DOCX" }));
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === "POST" &&
            call.path.endsWith(`/${DOCUMENT_ID}/exports`) &&
            (call.body as { revision: number }).revision === 2,
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Revision"), {
      target: { value: "1" },
    });
    await screen.findByText("Older revision · read-only");
    expect(screen.getByRole("textbox", { name: "Full name" })).toHaveAttribute(
      "readonly",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Restore as new revision" }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === "POST" &&
            call.path.endsWith(`/${DOCUMENT_ID}/restore`) &&
            (call.body as { sourceRevision: number }).sourceRevision === 1,
        ),
      ).toBe(true),
    );
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
    render(
      <DocumentsView
        rest={[DOCUMENT_ID]}
        actions={actions}
        onDirtyChange={vi.fn()}
      />,
    );
    const role = await screen.findByRole("textbox", { name: "Target role" });
    const stage = screen.getByRole("textbox", { name: "Interview stage" });
    expect(role).not.toHaveAttribute("readonly");
    expect(stage).not.toHaveAttribute("readonly");
    fireEvent.change(role, { target: { value: "Platform engineer" } });
    fireEvent.change(stage, { target: { value: "Screening" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new revision" }));
    await waitFor(() => expect(currentRevision).toBe(2));
    expect(
      calls.find(
        (call) =>
          call.method === "POST" &&
          call.path.endsWith(`/${DOCUMENT_ID}/revisions`),
      )?.body,
    ).toMatchObject({
      baseRevision: 1,
      values: {
        target_role: "Platform engineer",
        interview_stage: "Screening",
      },
    });
  });

  it("keeps unsaved edits when revision navigation is declined", async () => {
    currentRevision = 2;
    revisionValues[2] = { full_name: "Ada latest", company_name: "Northwind" };
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(
      <DocumentsView
        rest={[DOCUMENT_ID]}
        actions={actions}
        onDirtyChange={vi.fn()}
      />,
    );
    const name = await screen.findByRole("textbox", { name: "Full name" });
    fireEvent.change(name, { target: { value: "Unsaved name" } });
    fireEvent.change(screen.getByLabelText("Revision"), {
      target: { value: "1" },
    });
    expect(confirm).toHaveBeenCalledWith(
      "Discard unsaved edits and open another revision?",
    );
    expect(name).toHaveValue("Unsaved name");
    expect(screen.getByLabelText("Revision")).toHaveValue("2");
    expect(
      calls.some(
        (call) =>
          call.method === "GET" &&
          call.path.endsWith(`${DOCUMENT_ID}?revision=1`),
      ),
    ).toBe(false);

    fireEvent.change(screen.getByLabelText("Revision"), {
      target: { value: "1" },
    });
    await screen.findByText("Older revision · read-only");
    expect(screen.getByRole("textbox", { name: "Full name" })).toHaveValue(
      "Ada",
    );
    expect(screen.getByRole("textbox", { name: "Full name" })).toHaveAttribute(
      "readonly",
    );
  });

  it("keeps built-in templates read-only and offers duplication", async () => {
    render(
      <DocumentsView
        rest={["templates", TEMPLATE_ID]}
        actions={actions}
        onDirtyChange={vi.fn()}
      />,
    );
    await screen.findByText("Built-in template · read-only");
    expect(
      screen.queryByRole("button", { name: "Save new version" }),
    ).not.toBeInTheDocument();
    vi.spyOn(window, "prompt").mockReturnValue("My resume");
    fireEvent.click(screen.getByRole("button", { name: "Duplicate template" }));
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === "POST" &&
            call.path.endsWith(`/templates/${TEMPLATE_ID}/duplicate`),
        ),
      ).toBe(true),
    );
    expect(
      within(screen.getByRole("main")).getByText(/fields:/),
    ).toBeInTheDocument();
  });

  it("uploads a Markdown template with its instructions", async () => {
    render(
      <DocumentsView
        rest={["templates"]}
        actions={actions}
        onDirtyChange={vi.fn()}
      />,
    );
    await screen.findByRole("button", { name: "Add template" });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Practice notes" },
    });
    fireEvent.change(screen.getByLabelText("Format"), {
      target: { value: "md" },
    });
    fireEvent.change(screen.getByLabelText("Generation instructions"), {
      target: { value: "Use concise evidence." },
    });
    fireEvent.change(screen.getByLabelText("Source file"), {
      target: {
        files: [
          new File(["# {{full_name}}"], "notes.md", { type: "text/markdown" }),
        ],
      },
    });
    await screen.findByText("Detected fields");
    fireEvent.click(screen.getByRole("checkbox", { name: "Required" }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Maximum length" }),
      {
        target: { value: "40" },
      },
    );
    fireEvent.submit(
      screen.getByRole("button", { name: "Add template" }).closest("form")!,
    );
    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.method === "POST" && call.path.endsWith("/templates"),
        ),
      ).toBe(true),
    );
    const upload = calls.find(
      (call) => call.method === "POST" && call.path.endsWith("/templates"),
    )?.body;
    expect(upload).toBeInstanceOf(FormData);
    expect((upload as FormData).get("name")).toBe("Practice notes");
    expect((upload as FormData).get("format")).toBe("md");
    expect((upload as FormData).get("instructions")).toBe(
      "Use concise evidence.",
    );
    expect((upload as FormData).get("file")).toBeInstanceOf(File);
    expect(JSON.parse(String((upload as FormData).get("fields")))).toEqual([
      { ...fields[0], required: false, maxLength: 40 },
    ]);
  });

  it("clears previous template file, instructions, and detail when switching templates", async () => {
    templateCatalog = [
      {
        template: {
          ...template,
          id: OWNED_TEMPLATE_A,
          name: "Template A",
          ownerUserId: "member",
        },
        latestRevision: 1,
      },
      {
        template: {
          ...template,
          id: OWNED_TEMPLATE_B,
          name: "Template B",
          ownerUserId: "member",
        },
        latestRevision: 1,
      },
    ];
    const { rerender } = render(
      <DocumentsView
        rest={["templates", OWNED_TEMPLATE_A]}
        actions={actions}
        onDirtyChange={vi.fn()}
      />,
    );
    await screen.findByDisplayValue("Instructions for A");
    fireEvent.change(screen.getByLabelText("Source file"), {
      target: { files: [new File(["{{full_name}}"], "a.docx")] },
    });
    await screen.findByText("Detected fields");
    expect(
      screen.getByRole("button", { name: "Save new version" }),
    ).toBeEnabled();

    rerender(
      <DocumentsView
        rest={["templates", OWNED_TEMPLATE_B]}
        actions={actions}
        onDirtyChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Save new version" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Source file")).toHaveValue("");
    expect(
      screen.queryByDisplayValue("Instructions for A"),
    ).not.toBeInTheDocument();
    await screen.findByDisplayValue("Instructions for B");

    fireEvent.change(screen.getByLabelText("Source file"), {
      target: { files: [new File(["{{full_name}}"], "b.docx")] },
    });
    await screen.findByText("Detected fields");
    fireEvent.submit(
      screen.getByRole("button", { name: "Save new version" }).closest("form")!,
    );
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === "POST" &&
            call.path.endsWith(`/templates/${OWNED_TEMPLATE_B}/revisions`),
        ),
      ).toBe(true),
    );
    expect(
      calls.some(
        (call) =>
          call.method === "POST" &&
          call.path.endsWith(`/templates/${OWNED_TEMPLATE_A}/revisions`),
      ),
    ).toBe(false);
    const upload = calls.find(
      (call) =>
        call.method === "POST" &&
        call.path.endsWith(`/templates/${OWNED_TEMPLATE_B}/revisions`),
    )?.body as FormData;
    expect(upload.get("instructions")).toBe("Instructions for B");
    expect((upload.get("file") as File).name).toBe("b.docx");
  });

  it("offers Markdown export from a DOCX template when a field is missing", async () => {
    validationIssues = [{ key: "full_name", code: "missing" }];
    render(
      <DocumentsView
        rest={[DOCUMENT_ID]}
        actions={actions}
        onDirtyChange={vi.fn()}
      />,
    );
    await screen.findByRole("button", { name: "Export DOCX" });
    expect(screen.getByText(/Missing fields export blank/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Export format"), {
      target: { value: "md" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Export Markdown" }));
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === "POST" &&
            call.path.endsWith(`/${DOCUMENT_ID}/exports`) &&
            (call.body as { format: string }).format === "md",
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it("shows a stale revision error without changing the editor value", async () => {
    saveConflict = true;
    render(
      <DocumentsView
        rest={[DOCUMENT_ID]}
        actions={actions}
        onDirtyChange={vi.fn()}
      />,
    );
    const name = await screen.findByRole("textbox", { name: "Full name" });
    fireEvent.change(name, { target: { value: "Ada edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new revision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A newer revision exists",
    );
    expect(name).toHaveValue("Ada edited");
    expect(currentRevision).toBe(1);
  });
});
