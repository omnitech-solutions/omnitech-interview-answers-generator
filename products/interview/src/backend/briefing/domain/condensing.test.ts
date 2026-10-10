import type { BriefingContext } from "@omnitech/interview-contracts";
import { expect, it } from "vitest";
import {
  condenseBudget,
  condenseMaterial,
  shorterMaterial,
  withCondensedContext,
} from "./condensing";

const context: BriefingContext = {
  company: "Acme",
  role: "Engineer",
  stage: "recruiter",
  profile: { id: "profile", revision: 1 },
};
it("condenses at 4000 characters, preserving short originals", () => {
  expect(
    condenseMaterial({
      ...context,
      jobDescription: "a".repeat(3999),
      research: "b".repeat(4000),
    }),
  ).toEqual({ jobDescription: "", research: "b".repeat(4000) });
  expect(condenseMaterial(context)).toEqual({
    jobDescription: "",
    research: "",
  });
});
it("budgets one quarter with the original lower and upper bounds", () => {
  expect(condenseBudget("")).toBe(3000);
  expect(condenseBudget("a".repeat(16002))).toBe(4001);
  expect(condenseBudget("a".repeat(40000))).toBe(9000);
});
it("keeps only nonempty trimmed text shorter than material actually sent", () => {
  expect(
    shorterMaterial(
      { jobDescription: "long", research: "" },
      { jobDescription: " short ", research: "invented" },
    ),
  ).toEqual({});
  expect(
    shorterMaterial(
      { jobDescription: "long", research: "longer" },
      { jobDescription: "  x  ", research: " " },
    ),
  ).toEqual({ jobDescription: "x" });
});
it("replaces a previous condensation and preserves all originals", () => {
  const previous = {
    ...context,
    jobDescription: "original",
    condensed: { research: "previous" },
  };
  expect(withCondensedContext(previous, {})).toEqual({
    ...context,
    jobDescription: "original",
  });
  expect(withCondensedContext(previous, { jobDescription: "new" })).toEqual({
    ...context,
    jobDescription: "original",
    condensed: { jobDescription: "new" },
  });
  expect(previous.condensed.research).toBe("previous");
});
