import { expect, it } from "vitest";
import { selectCandidateFragments } from "./selection";

it("prioritizes direct skill over domain matches and preserves source order on ties", () => {
  const matrix = {
    candidate: {},
    roles: [
      { company: "A", title: "Domain", industry: ["health"] },
      { company: "B", title: "Direct", technologies: ["TypeScript"] },
      { company: "C", title: "Adjacent", tags: ["web"] },
    ],
  };
  const selected = selectCandidateFragments(
    matrix,
    "TypeScript health",
    "delivery",
  );
  expect(selected.map((entry) => entry.pointer)).toEqual([
    "/roles/1",
    "/roles/0",
    "/roles/2",
  ]);
});

it("keeps every role, unrelated ones last, without letting a preferred story outrank a direct skill", () => {
  const matrix = {
    candidate: {},
    roles: [
      { company: "A", title: "Manager", tags: ["marketing"] },
      { company: "B", title: "Engineer", technologies: ["TypeScript"] },
      { company: "C", title: "Designer", tags: ["design"] },
    ],
  };
  expect(
    selectCandidateFragments(matrix, "TypeScript", "delivery", [
      "/roles/0",
    ]).map((entry) => entry.pointer),
  ).toEqual(["/roles/1", "/roles/0", "/roles/2"]);
  expect(
    selectCandidateFragments(matrix, "healthcare", "delivery").map(
      (entry) => entry.pointer,
    ),
  ).toEqual(["/roles/0", "/roles/1", "/roles/2"]);
});

it("uses matching story guidance to rank a primary and backup role first", () => {
  const matrix = {
    candidate: {},
    roles: [
      { company: "Orchid", title: "Operator" },
      { company: "Maple", title: "Lead" },
      { company: "Cedar", title: "Designer" },
    ],
    story_selector: [
      {
        need: "cross-team collaboration",
        primary_story: "Orchid",
        backup_story: "Maple",
      },
    ],
  };
  expect(
    selectCandidateFragments(
      matrix,
      "How do you approach collaboration?",
      "collaboration",
    ).map((entry) => entry.pointer),
  ).toEqual(["/roles/0", "/roles/1", "/roles/2"]);
});
