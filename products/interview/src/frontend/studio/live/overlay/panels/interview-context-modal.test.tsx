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
import { briefSummary, InterviewContextModal } from "./interview-context-modal";

const { documentJson, postJson } = vi.hoisted(() => ({
  documentJson: vi.fn(),
  postJson: vi.fn(),
}));
vi.mock("../../../documents/documents-client", () => ({
  documentJson,
  postJson,
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
    ).toEqual(briefSummary(BRIEF));
    expect(brief).toHaveTextContent("Must-haves: TypeScript, Postgres");
    expect(brief).not.toHaveTextContent("Nice-to-haves");
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
