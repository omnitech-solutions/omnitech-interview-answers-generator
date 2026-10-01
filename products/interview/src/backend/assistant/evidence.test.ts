import { createHash } from "node:crypto";
import type { InterviewClaim } from "@omnitech/interview-contracts";
import { expect, it } from "vitest";
import { validateClaims } from "./evidence.js";
import type { InterviewEvidence } from "./workspace.js";

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
      answerMarkdown: generated,
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
