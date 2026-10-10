import { expect, it } from "vitest";
import { briefContext, candidateSources, contextSources, sha } from "./sources";

it("escapes pointers, retains numeric leaves and preserves selected role order", () => {
  const result = candidateSources(
    {
      candidate: { "a/b~c": "Name", count: 0, empty: "", active: true },
      roles: [],
      leadership_signals: ["Mentored engineers"],
    },
    [
      { pointer: "/roles/2", role: { company: "Later", title: "Engineer" } },
      { pointer: "/roles/0", role: { company: "Earlier", title: "Lead" } },
    ],
    "profile",
    3,
  );
  expect(result.map(({ pointer }) => pointer)).toEqual([
    "/candidate/a~1b~0c",
    "/candidate/count",
    "/roles/2/company",
    "/roles/2/title",
    "/roles/0/company",
    "/roles/0/title",
    "/leadership_signals/0",
  ]);
  expect(result[0]).toEqual({
    pointer: "/candidate/a~1b~0c",
    text: "Name",
    sourceKind: "candidate",
    id: sha("profile:/candidate/a~1b~0c"),
    revision: 3,
    sha256: sha("Name"),
  });
});
it("keeps employer sources separate from candidate preferences and excludes long prompt fields", () => {
  const context = {
    company: "Acme",
    role: "Engineer",
    stage: "recruiter" as const,
    profile: { id: "profile", revision: 1 },
    request: "Goal",
    employerNotes: "Employer",
    candidatePreferences: "Preference",
    jobDescription: "",
    condensed: { research: "Short" },
    research: "Research",
  };
  expect(
    contextSources(context, 2).map(({ pointer, sourceKind }) => ({
      pointer,
      sourceKind,
    })),
  ).toEqual([
    { pointer: "/context/request", sourceKind: "employer-context" },
    { pointer: "/context/employerNotes", sourceKind: "employer-context" },
    { pointer: "/context/research", sourceKind: "employer-context" },
    {
      pointer: "/context/candidatePreferences",
      sourceKind: "candidate-preference",
    },
  ]);
  expect(briefContext(context)).toEqual({
    company: "Acme",
    role: "Engineer",
    stage: "recruiter",
    profile: { id: "profile", revision: 1 },
  });
});
