"use client";

import { Collapse } from "@oc-tech/omni-ui-components";
import { MarkdownContent } from "./markdown-content";

const conceptKeywords = [
  "accessibility",
  "API",
  "batching",
  "cache",
  "commit phase",
  "context",
  "DOM",
  "edge case",
  "invariant",
  "memoization",
  "performance",
  "reconciliation",
  "render",
  "state",
  "Strict Mode",
  "time complexity",
  "space complexity",
  "trade-off",
];

function ConceptMarkdown({ children }: { children: string }) {
  return (
    <MarkdownContent keywords={conceptKeywords}>{children}</MarkdownContent>
  );
}

interface QuestionSection {
  answer: string;
  label: string;
}

function splitQuestionSections(markdown: string): {
  after: string;
  before: string;
  questions: QuestionSection[];
} {
  const lines = markdown.split(/\r?\n/);
  const firstQuestion = lines.findIndex((line) =>
    /^###\s+Question\s+#?\d+\s*:/i.test(line),
  );
  if (firstQuestion === -1) {
    return { before: markdown, questions: [], after: "" };
  }

  const questions: QuestionSection[] = [];
  let index = firstQuestion;
  while (index < lines.length) {
    const heading = /^###\s+(Question\s+#?\d+\s*:\s*.+)$/i.exec(
      lines[index] ?? "",
    );
    if (!heading) break;
    const answerStart = index + 1;
    index = answerStart;
    while (
      index < lines.length &&
      !/^###\s+Question\s+#?\d+\s*:/i.test(lines[index] ?? "") &&
      !/^##\s+/.test(lines[index] ?? "")
    ) {
      index += 1;
    }
    questions.push({
      label: heading[1] ?? "Question",
      answer: lines.slice(answerStart, index).join("\n").trim(),
    });
    if (/^##\s+/.test(lines[index] ?? "")) break;
  }

  const beforeLines = lines.slice(0, firstQuestion);
  while (
    beforeLines.length &&
    (/^\s*$/.test(beforeLines.at(-1) ?? "") ||
      /^##\s+(?:Questions|Work through the questions)\s*$/i.test(
        beforeLines.at(-1) ?? "",
      ))
  ) {
    beforeLines.pop();
  }

  return {
    before: beforeLines.join("\n").trim(),
    questions,
    after: lines.slice(index).join("\n").trim(),
  };
}

export function ConceptMarkdownContent({ children }: { children: string }) {
  const { after, before, questions } = splitQuestionSections(children);
  if (!questions.length) return <ConceptMarkdown>{children}</ConceptMarkdown>;

  return (
    <>
      {before ? <ConceptMarkdown>{before}</ConceptMarkdown> : null}
      <Collapse
        className="concept-question-collapse"
        defaultActiveKey={questions[0]!.label}
        items={questions.map((question) => ({
          key: question.label,
          label: question.label,
          children: <ConceptMarkdown>{question.answer}</ConceptMarkdown>,
        }))}
      />
      {after ? <ConceptMarkdown>{after}</ConceptMarkdown> : null}
    </>
  );
}
