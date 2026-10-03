import {
  generatedAnswerSchema,
  renderGuideMarkdown,
} from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { exampleTemplates } from "./example-templates";

describe("example templates", () => {
  it.each(exampleTemplates.map((template) => [template.id, template]))(
    "%s is a guided answer whose edge cases name its tests",
    (_id, template) => {
      const answer = generatedAnswerSchema.parse(template.answer);
      expect(answer.answerMarkdown).toBe(renderGuideMarkdown(answer.guide));
      for (const edge of answer.guide.edgeCases)
        expect(answer.testCode).toContain(edge.test);
    },
  );
});
