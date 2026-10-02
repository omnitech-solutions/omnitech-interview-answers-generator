import { expect, it } from "vitest";
import { selectCandidateFragments } from "./selection.js";

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
  ]);
});

it("does not select unrelated roles or let a preferred story outrank a direct skill", () => {
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
  ).toEqual(["/roles/1", "/roles/0"]);
  expect(selectCandidateFragments(matrix, "healthcare", "delivery")).toEqual(
    [],
  );
});

it("uses matching story guidance to select a primary and backup role without unrelated roles", () => {
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
  ).toEqual(["/roles/0", "/roles/1"]);
  expect(selectCandidateFragments(matrix, "unrelated", "delivery")).toEqual([]);
});
