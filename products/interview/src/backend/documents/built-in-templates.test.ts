import { describe, expect, it } from "vitest";

import { builtInTemplates } from "./built-in-templates";

describe("the built-in resume's instructions", () => {
  const resume = builtInTemplates().find(
    (template) => template.key === "resume",
  );

  it("keep the city out of the region and strengths as short labels", () => {
    expect(resume?.instructions).toMatch(/city field holds the city only/i);
    expect(resume?.instructions).toMatch(
      /region field holds the province or state only/i,
    );
    expect(resume?.instructions).toMatch(
      /strength is a short label of two to five words/i,
    );
  });
});
