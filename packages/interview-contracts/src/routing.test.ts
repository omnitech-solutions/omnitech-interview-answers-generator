import { describe, expect, it } from "vitest";

import { routeQuestion } from "./routing.js";
import {
  generatedAnswerSchema,
  routeRequestSchema,
  runRequestSchema,
  savedAnswerSchema,
} from "./schemas.js";
import { getWorkflow, listWorkflows } from "./workflows.js";

describe("routeQuestion", () => {
  it("honors an explicit language", () => {
    expect(routeQuestion("anything", "php").language).toBe("php");
  });

  it("routes component questions to React", () => {
    expect(routeQuestion("Build a React component using useState")).toEqual({
      language: "react",
      confidence: 0.8,
      reasons: ["Matched 1 React signal(s)."],
    });
  });

  it("defaults an ambiguous algorithm to TypeScript", () => {
    expect(routeQuestion("Find the shortest path")).toEqual({
      language: "typescript",
      confidence: 0.55,
      reasons: [
        "No language-specific signal was found; TypeScript is the default.",
      ],
    });
  });

  it.each([
    ["Use <?php and foreach over the values", "php"],
    ["Define interface User with a string name", "typescript"],
    ["Write def solve and return before end", "ruby"],
  ] as const)("routes %s to %s", (question, expectedLanguage) => {
    expect(routeQuestion(question).language).toBe(expectedLanguage);
  });

  it("chooses the workflow with the most signals", () => {
    const result = routeQuestion(
      "Build a React TSX component with interface Props: <Counter />",
    );

    expect(result.language).toBe("react");
    expect(result.confidence).toBe(0.95);
  });
});

describe("request and response schemas", () => {
  it("trims questions and supplies request defaults", () => {
    expect(routeRequestSchema.parse({ question: "  Solve it  " })).toEqual({
      question: "Solve it",
      language: "auto",
    });
    expect(runRequestSchema.parse({ language: "php", code: "<?php" })).toEqual({
      language: "php",
      code: "<?php",
      stdin: "",
    });
  });

  it("rejects empty questions and unsupported run languages", () => {
    expect(routeRequestSchema.safeParse({ question: "  " }).success).toBe(
      false,
    );
    expect(
      runRequestSchema.safeParse({
        language: "react",
        code: "function App(){}",
      }).success,
    ).toBe(false);
  });

  it("supplies empty usage and test files for a generated answer", () => {
    const answer = generatedAnswerSchema.parse({
      title: "Answer",
      language: "typescript",
      answerMarkdown: "Explanation",
      code: "export {};",
    });

    expect(answer.usageCode).toBe("");
    expect(answer.testCode).toBe("");
  });

  it("validates persisted answer identifiers and timestamps", () => {
    const valid = {
      id: "01957fcb-06e8-7a1a-a351-cf7225f9d342",
      title: "Answer",
      language: "php",
      answerMarkdown: "Explanation",
      code: "<?php",
      usageCode: "",
      testCode: "",
      question: "Solve it",
      notes: "",
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:00:00.000Z",
    };

    expect(savedAnswerSchema.parse(valid)).toEqual(valid);
    expect(
      savedAnswerSchema.safeParse({ ...valid, id: "not-a-uuid" }).success,
    ).toBe(false);
    expect(
      savedAnswerSchema.safeParse({ ...valid, updatedAt: "yesterday" }).success,
    ).toBe(false);
  });
});

describe("answer workflows", () => {
  it("lists every supported workflow once", () => {
    const workflows = listWorkflows();

    expect(workflows.map(({ id }) => id)).toEqual([
      "php",
      "react",
      "typescript",
      "ruby",
    ]);
    expect(new Set(workflows.map(({ id }) => id))).toHaveLength(4);
  });

  it("returns the complete workflow for a language", () => {
    const workflow = getWorkflow("react");

    expect(workflow.label).toBe("React");
    expect(workflow.codeFence).toBe("tsx");
    expect(workflow.systemPrompt).toContain(
      "Start with the simplest correct scalable solution",
    );
    expect(workflow.systemPrompt).toContain('"usageCode"');
    expect(workflow.systemPrompt).toContain("accessible");
  });

  it("requires point-form Markdown talking points and visible entry-point code", () => {
    const contract = getWorkflow("ruby").systemPrompt;

    expect(contract).toContain("## Question");
    expect(contract).toContain("## Approach");
    expect(contract).toContain("## Complexity");
    expect(contract).toContain("## Talking");
    expect(contract).toContain("Bold key domain terms");
    // The model writes a guide; the Markdown headings are rendered from it.
    expect(contract).toContain('"guide"');
    expect(contract).toContain("do not write answerMarkdown yourself");
    expect(contract).toContain("exact title of the test in testCode");
    expect(contract).not.toContain('"answerMarkdown"');
    expect(contract).toContain("entry-point function or component above");
    expect(contract).toContain("must never include example");
  });
});
