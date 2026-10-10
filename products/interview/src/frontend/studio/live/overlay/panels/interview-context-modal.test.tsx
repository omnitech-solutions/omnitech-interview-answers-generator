// The interview's context modal over a stubbed documents client: adding an
// interview creates the candidacy then stores its spec and notes; editing one
// reads it first; Clean up with AI saves, asks for the brief, and shows it.

import type {
  CandidacyContext,
  EmployerBrief,
} from "@omnitech/interview-contracts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  briefSections,
  InterviewContextModal,
} from "./interview-context-modal";

const { documentJson, postJson } = vi.hoisted(() => ({
  documentJson: vi.fn(),
  postJson: vi.fn(),
}));
vi.mock("../../../documents/documents-client", () => ({
  documentJson,
  postJson,
}));
// The stages, "Employer said" and "Research" are the form's own (its suite is
// interview-brief-form.test.tsx): here it is only seen to be mounted for the
// application once there is one.
vi.mock("../../../interview-brief/interview-brief-form", () => ({
  InterviewBriefForm: ({ candidacyId }: { candidacyId: string }) => (
    <section data-testid="ib-form-stub">{candidacyId}</section>
  ),
}));

const ID = "22222222-2222-4222-8222-222222222222";
const BRIEF: EmployerBrief = {
  company: "Example Corp",
  role: "Staff Engineer",
  summary: "Platform team hiring a staff engineer.",
  mustHaves: ["TypeScript", "Postgres"],
  niceToHaves: [],
  techStack: ["Hono"],
  responsibilities: ["Own the API"],
  values: [],
  questionsToAsk: ["Team size?"],
};
const stored = (over: Partial<CandidacyContext> = {}): CandidacyContext => ({
  id: ID,
  companyName: "Example Corp",
  title: "Staff Engineer",
  jobDescription: null,
  notes: null,
  brief: null,
  ...over,
});

const settle = () => act(async () => undefined);
const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

function show(candidacyId: string | null) {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <InterviewContextModal
      open
      candidacyId={candidacyId}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />,
  );
  return { onSaved, onOpenChange };
}

beforeEach(() => {
  documentJson.mockReset();
  postJson.mockReset();
});
afterEach(() => {
  cleanup();
});

describe("briefSections", () => {
  it("opens with the company and the owner's prep, then the role", () => {
    const sections = briefSections({
      ...BRIEF,
      companyFacts: ["Builds internal tooling"],
      prepNotes: ["Lead with the billing migration"],
    });
    expect(sections.map((part) => part.heading)).toEqual([
      "About the company",
      "Your prep",
      "Summary",
      "Must-haves",
      "Tech stack",
      "Responsibilities",
      "Questions to ask",
    ]);
    expect(sections[0]?.items).toEqual(["Builds internal tooling"]);
    expect(sections[1]?.items).toEqual(["Lead with the billing migration"]);
  });

  it("leaves both sections out of a brief without facts or notes", () => {
    const headings = [
      briefSections(BRIEF),
      briefSections({ ...BRIEF, companyFacts: [], prepNotes: [] }),
    ].map((sections) => sections.map((part) => part.heading));
    expect(headings[0]).toEqual(headings[1]);
    expect(headings[0]?.[0]).toBe("Summary");
  });
});

describe("adding an interview", () => {
  it("creates the candidacy with one stage, then stores the spec and notes, and hands the saved context back", async () => {
    postJson.mockResolvedValueOnce({ candidacyId: ID });
    const saved = stored({ jobDescription: "Posting text", notes: "Met Sam" });
    documentJson.mockResolvedValueOnce(saved);
    const { onSaved } = show(null);
    const modal = screen.getByTestId("pn-context-modal");
    expect(within(modal).getByText("Add an interview")).toBeInTheDocument();
    // Nothing is read for a new interview, and Save waits for company and role.
    expect(documentJson).not.toHaveBeenCalled();
    // Stages belong to a saved application: none are offered before it is.
    expect(screen.queryByTestId("ib-form-stub")).toBeNull();
    expect(screen.getByTestId("pn-context-save")).toBeDisabled();
    expect(screen.getByTestId("pn-context-clean")).toBeDisabled();
    type("pn-context-company", " Example Corp ");
    type("pn-context-role", "Staff Engineer");
    expect(screen.getByTestId("pn-context-save")).toBeEnabled();
    // Clean up needs a spec to clean.
    expect(screen.getByTestId("pn-context-clean")).toBeDisabled();
    type("pn-context-spec", "Posting text");
    type("pn-context-notes", "Met Sam");
    expect(screen.getByTestId("pn-context-clean")).toBeEnabled();
    fireEvent.click(screen.getByTestId("pn-context-save"));
    await settle();
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(postJson).toHaveBeenCalledWith("/candidacies", {
      companyName: "Example Corp",
      title: "Staff Engineer",
      jobDescription: "Posting text",
      interview: { kind: "other", label: "Interview" },
    });
    expect(documentJson).toHaveBeenCalledTimes(1);
    const [path, init] = documentJson.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/candidacies/${ID}/context`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      title: "Staff Engineer",
      jobDescription: "Posting text",
      notes: "Met Sam",
    });
    expect(onSaved).toHaveBeenCalledWith(saved);
    // Now it exists, its stages, employer-said entries and research are here.
    expect(screen.getByTestId("ib-form-stub")).toHaveTextContent(ID);
    // Saved once: the company is fixed and a second Save updates, not creates.
    expect(screen.getByTestId("pn-context-company")).toBeDisabled();
    documentJson.mockResolvedValueOnce(saved);
    fireEvent.click(screen.getByTestId("pn-context-save"));
    await settle();
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(documentJson).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("pn-context-brief")).toBeNull();
  });

  it("a refused create changes nothing on screen and says so", async () => {
    postJson.mockRejectedValueOnce(new Error("request-failed"));
    const { onSaved } = show(null);
    type("pn-context-company", "Example Corp");
    type("pn-context-role", "Staff Engineer");
    fireEvent.click(screen.getByTestId("pn-context-save"));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Saving did not go through/,
    );
    expect(documentJson).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByTestId("pn-context-company")).toBeEnabled();
  });
});

describe("editing an interview", () => {
  it("reads the stored context first; Clean up with AI saves, then asks for the brief and shows it", async () => {
    documentJson.mockResolvedValueOnce(
      stored({ jobDescription: "Old posting", notes: "Old notes" }),
    );
    const { onSaved } = show(ID);
    await settle();
    expect(documentJson).toHaveBeenCalledWith(`/candidacies/${ID}/context`);
    expect(screen.getByText("Interview context")).toBeInTheDocument();
    expect(screen.getByTestId("pn-context-company")).toHaveValue(
      "Example Corp",
    );
    expect(screen.getByTestId("pn-context-company")).toBeDisabled();
    expect(screen.getByTestId("pn-context-role")).toHaveValue("Staff Engineer");
    expect(screen.getByTestId("pn-context-spec")).toHaveValue("Old posting");
    expect(screen.getByTestId("pn-context-notes")).toHaveValue("Old notes");
    // An existing application opens with its stages.
    expect(screen.getByTestId("ib-form-stub")).toHaveTextContent(ID);
    expect(screen.getByTestId("pn-context-clean")).toHaveTextContent(
      "Clean up with AI",
    );
    type("pn-context-spec", "New posting");
    const saved = stored({ jobDescription: "New posting", notes: "Old notes" });
    const briefed = stored({ ...saved, brief: BRIEF });
    documentJson.mockResolvedValueOnce(saved);
    postJson.mockResolvedValueOnce(briefed);
    fireEvent.click(screen.getByTestId("pn-context-clean"));
    await settle();
    // Save (an update, never a create) before the brief, which is built from
    // what is stored.
    expect(documentJson).toHaveBeenCalledTimes(2);
    const [path, init] = documentJson.mock.calls[1] as [string, RequestInit];
    expect(path).toBe(`/candidacies/${ID}/context`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toMatchObject({
      jobDescription: "New posting",
    });
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(postJson).toHaveBeenCalledWith(`/candidacies/${ID}/brief`, {});
    expect(onSaved.mock.calls.map((call) => call[0])).toEqual([saved, briefed]);
    const brief = screen.getByTestId("pn-context-brief");
    expect(brief).toHaveAccessibleName("Employer brief");
    expect(
      within(brief)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(briefSections(BRIEF).flatMap((part) => part.items));
    expect(within(brief).getByText("Must-haves")).toBeInTheDocument();
    expect(within(brief).getByText("TypeScript")).toBeInTheDocument();
    expect(brief).not.toHaveTextContent("Nice-to-haves");
    // The concise brief leads, then the notes; the raw posting comes last.
    expect(within(brief).getByRole("heading", { level: 4 })).toHaveTextContent(
      "The concise brief · what the answers lean on",
    );
    const notes = screen.getByLabelText("Your notes");
    const spec = screen.getByLabelText("Job spec (the raw posting)");
    expect(notes).toBe(screen.getByTestId("pn-context-notes"));
    expect(spec).toBe(screen.getByTestId("pn-context-spec"));
    expect(spec).toHaveAttribute("rows", "4");
    const follows = (first: Element, second: Element) =>
      Boolean(
        first.compareDocumentPosition(second) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    expect(follows(brief, notes)).toBe(true);
    expect(follows(notes, spec)).toBe(true);
    expect(screen.getByTestId("pn-context-clean")).toHaveTextContent(
      "Clean up again",
    );
  });

  it("a clean-up that does not finish keeps the saved spec and says so", async () => {
    documentJson.mockResolvedValueOnce(stored({ jobDescription: "Posting" }));
    show(ID);
    await settle();
    documentJson.mockResolvedValueOnce(stored({ jobDescription: "Posting" }));
    postJson.mockRejectedValueOnce(new Error("server-error"));
    fireEvent.click(screen.getByTestId("pn-context-clean"));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /clean-up did not finish. The spec is saved/,
    );
    expect(screen.queryByTestId("pn-context-brief")).toBeNull();
  });
});
