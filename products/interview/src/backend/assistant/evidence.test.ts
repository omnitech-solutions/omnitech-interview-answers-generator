import { createHash } from "node:crypto";
import {
  type InterviewClaim,
  renderGuideMarkdown,
} from "@omnitech/interview-contracts";
import { expect, it } from "vitest";
import { guidedProse } from "../../answer-fixture";
import { validateClaims } from "./evidence";
import type { InterviewEvidence } from "./workspace";

function check(generated: string, quoted: string, value: number, unit = "%") {
  const source: InterviewEvidence = {
    id: "metric",
    revision: 1,
    sha256: createHash("sha256").update(quoted).digest("hex"),
    text: quoted,
    locator: "candidate://synthetic",
    classification: "public",
    audience: ["alice"],
    sourceKind: "candidate",
    metrics: [{ value, unit }],
  };
  const claim: InterviewClaim = {
    kind: "candidate-metric",
    field: "answerMarkdown",
    text: generated,
    metric: { value, unit },
    citations: [
      { id: source.id, revision: 1, sha256: source.sha256, quote: quoted },
    ],
  };
  validateClaims(
    {
      title: "Synthetic",
      language: "typescript",
      ...guidedProse(generated),
      code: "",
      usageCode: "",
      testCode: "",
    },
    [claim],
    new Map([["metric:1", source]]),
  );
}
it.each([
  ["I improved latency by 40%,80%.", "I improved latency by 40%.", 40],
  ["I improved latency by 40%,80ms.", "I improved latency by 40%.", 40],
  ["I improved latency by 1,040%.", "I improved latency by 40%.", 40],
  ["I improved latency by 1,40%.", "I improved latency by 40%.", 40],
  ["I improved latency by 140%.", "I improved latency by 40%.", 40],
  ["I improved latency by -40%.", "I improved latency by 40%.", 40],
  ["I improved latency by 140.5%.", "I improved latency by 40.5%.", 40.5],
  ["I improved latency by +140.5%.", "I improved latency by +40.5%.", 40.5],
  ["I improved latency by 40% and 80%.", "I improved latency by 40%.", 40],
  ["I improved latency by 40% and 80ms.", "I improved latency by 40%.", 40],
  ["I improved latency by 40%.", "I improved latency by 140%.", 40],
  [
    "I improved latency by 40percentile.",
    "I improved latency by 40percent.",
    40,
    "percent",
  ],
])(
  "rejects complete unsupported metric tokens: %s",
  (generated, quoted, value, unit?: string) => {
    expect(() => check(generated, quoted, value, unit)).toThrow(
      expect.objectContaining({ code: "unsupported-metric" }),
    );
  },
);
it.each([
  ["I improved latency by 40%.", "I improved latency by 40%.", 40],
  ["I improved latency by +40.5%.", "I improved latency by 40.5%.", 40.5],
  ["I changed latency by -0.5%.", "I changed latency by -.5%.", -0.5],
  ["I improved latency by .5%.", "I improved latency by 0.5%.", 0.5],
  ["I improved latency by 40 % twice: 40%.", "I improved latency by 40%.", 40],
])(
  "accepts equivalent complete numeric values: %s",
  (generated, quoted, value) => {
    expect(() => check(generated, quoted, value)).not.toThrow();
  },
);

it("checks the guide's spoken prose like the Markdown", () => {
  const quoted = "I led the migration to optimistic locking.";
  const source: InterviewEvidence = {
    id: "story",
    revision: 1,
    sha256: createHash("sha256").update(quoted).digest("hex"),
    text: quoted,
    locator: "candidate://synthetic",
    classification: "public",
    audience: ["alice"],
    sourceKind: "candidate",
  };
  const guide = {
    version: 1 as const,
    understand: {
      prompt: "Locking.",
      examples: [],
      constraints: [],
      clarify: [],
    },
    plan: {
      steps: ["Compare revisions."],
      complexity: { time: "O(1)", space: "O(1)" },
    },
    edgeCases: [],
    explain: [{ heading: "Story", body: quoted }],
    talkingPoints: ["a", "b", "c"],
  };
  const answer = {
    title: "Locking",
    language: "typescript" as const,
    answerMarkdown: renderGuideMarkdown(guide),
    code: "",
    usageCode: "",
    testCode: "",
    guide,
  };
  const sources = new Map([["story:1", source]]);
  // A personal statement in the explanation needs a source behind it…
  expect(() => validateClaims(answer, [], sources)).toThrow();
  // …and a claim on the guide is matched against the guide's text.
  const claim: InterviewClaim = {
    kind: "candidate-fact",
    field: "guide",
    text: quoted,
    citations: [
      { id: "story", revision: 1, sha256: source.sha256, quote: quoted },
    ],
  };
  expect(() => validateClaims(answer, [claim], sources)).not.toThrow();
  const retold = { ...guide, explain: [{ heading: "Story", body: "Retold." }] };
  expect(() =>
    validateClaims({ ...answer, guide: retold }, [claim], sources),
  ).toThrow(expect.objectContaining({ code: "claim-text-conflict" }));
});
