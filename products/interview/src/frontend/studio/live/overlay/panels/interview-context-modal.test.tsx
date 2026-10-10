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
import userEvent from "@testing-library/user-event";
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
// The form's fields are found the way a person and the control inventory
// find them: a text box with its label as its name.
const COMPANY = "Company";
const ROLE = "Role";
const NOTES = "Your notes";
const SPEC = "Job spec (the raw posting)";
const field = (name: string) => screen.getByRole("textbox", { name });
const type = (name: string, value: string) =>
  fireEvent.change(field(name), { target: { value } });

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
    type(COMPANY, " Example Corp ");
    type(ROLE, "Staff Engineer");
    expect(screen.getByTestId("pn-context-save")).toBeEnabled();
    // Clean up needs a spec to clean.
    expect(screen.getByTestId("pn-context-clean")).toBeDisabled();
    type(SPEC, "Posting text");
    type(NOTES, "Met Sam");
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
    expect(field(COMPANY)).toBeDisabled();
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
    type(COMPANY, "Example Corp");
    type(ROLE, "Staff Engineer");
    fireEvent.click(screen.getByTestId("pn-context-save"));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Saving did not go through/,
    );
    expect(documentJson).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(field(COMPANY)).toBeEnabled();
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
    expect(field(COMPANY)).toHaveValue("Example Corp");
    expect(field(COMPANY)).toBeDisabled();
    expect(field(ROLE)).toHaveValue("Staff Engineer");
    expect(field(SPEC)).toHaveValue("Old posting");
    expect(field(NOTES)).toHaveValue("Old notes");
    // An existing application opens with its stages.
    expect(screen.getByTestId("ib-form-stub")).toHaveTextContent(ID);
    expect(screen.getByTestId("pn-context-clean")).toHaveTextContent(
      "Clean up with AI",
    );
    type(SPEC, "New posting");
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
    const notes = field(NOTES);
    const spec = field(SPEC);
    expect(notes).toHaveAttribute("rows", "4");
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

describe("the form's own rules", () => {
  it("marks the two fields the contract requires, and lets Save be pressed only once the contract would take what is typed", () => {
    show(null);
    expect(field(COMPANY)).toBeRequired();
    expect(field(ROLE)).toBeRequired();
    expect(field(NOTES)).not.toBeRequired();
    expect(field(SPEC)).not.toBeRequired();
    // The contract bounds each field; the control holds the same bound.
    expect(field(COMPANY)).toHaveAttribute("maxlength", "200");
    expect(field(SPEC)).toHaveAttribute("maxlength", "20000");
    type(COMPANY, "Example Corp");
    expect(screen.getByTestId("pn-context-save")).toBeDisabled();
    // Spaces are not a role.
    type(ROLE, "   ");
    expect(screen.getByTestId("pn-context-save")).toBeDisabled();
    type(ROLE, "Staff Engineer");
    expect(screen.getByTestId("pn-context-save")).toBeEnabled();
    type(COMPANY, "");
    expect(screen.getByTestId("pn-context-save")).toBeDisabled();
    expect(postJson).not.toHaveBeenCalled();
  });

  it("says what each long field is for, under it", () => {
    show(null);
    expect(
      screen.getByText(/What you know about the team and the process/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Paste the posting as it is/)).toBeInTheDocument();
  });

  it("is filled and saved from the keyboard: Tab moves company, role, notes, spec, and Enter in a field saves", async () => {
    const user = userEvent.setup();
    postJson.mockResolvedValueOnce({ candidacyId: ID });
    documentJson.mockResolvedValueOnce(stored({ notes: "Met Sam" }));
    const { onSaved } = show(null);
    field(COMPANY).focus();
    await user.keyboard("Example Corp");
    await user.tab();
    expect(field(ROLE)).toHaveFocus();
    await user.keyboard("Staff Engineer");
    await user.tab();
    expect(field(NOTES)).toHaveFocus();
    await user.keyboard("Met Sam");
    await user.tab();
    expect(field(SPEC)).toHaveFocus();
    // Enter in a one-line field is Save, never Clean up.
    field(ROLE).focus();
    await user.keyboard("{Enter}");
    await settle();
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(postJson.mock.calls[0]?.[0]).toBe("/candidacies");
    const [, init] = documentJson.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      title: "Staff Engineer",
      jobDescription: "",
      notes: "Met Sam",
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("Enter does nothing while the contract would refuse what is typed", async () => {
    const user = userEvent.setup();
    show(null);
    field(COMPANY).focus();
    await user.keyboard("Example Corp{Enter}");
    await settle();
    expect(postJson).not.toHaveBeenCalled();
  });

  it("cannot be typed in while it saves, and can again once the save has answered", async () => {
    let answer: (made: { candidacyId: string }) => void = () => undefined;
    postJson.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    documentJson.mockResolvedValueOnce(stored());
    show(null);
    type(COMPANY, "Example Corp");
    type(ROLE, "Staff Engineer");
    fireEvent.click(screen.getByTestId("pn-context-save"));
    await settle();
    expect(field(ROLE)).toBeDisabled();
    expect(field(SPEC)).toBeDisabled();
    answer({ candidacyId: ID });
    await settle();
    expect(field(ROLE)).toBeEnabled();
    expect(field(ROLE)).toHaveValue("Staff Engineer");
  });

  it("a context that could not be read says so and leaves the form empty", async () => {
    documentJson.mockRejectedValueOnce(new Error("offline"));
    show(ID);
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be read/);
    expect(field(COMPANY)).toHaveValue("");
  });
});
