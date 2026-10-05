import { describe, expect, it } from "vitest";
import { answerAction } from "../testing/live-view-kit";
import { sessionView } from "../testing/session-fixtures";
import { answerResult } from "../testing/session-result-fixtures";
import { approachItems, localityChips } from "./overlay-model";

const run = (profileId: string, policy = "permitted-remote") =>
  answerAction(answerResult({ meta: { profileId, processingPolicy: policy } }));
const remote = sessionView({ processingPolicy: "permitted-remote" });

describe("locality label", () => {
  it("builds the chip text", () => {
    expect(
      localityChips(remote, [run("interview-session-agent-claude")]).locality
        .text,
    ).toBe("Remote · Claude (Agent SDK)");
    expect(
      localityChips(remote, [run("interview-session-agent-codex")]).locality
        .text,
    ).toBe("Remote · Codex");
    expect(localityChips(remote, [run("some-model")]).locality.text).toBe(
      "Remote · some-model",
    );
    expect(localityChips(remote, []).locality.text).toBe("Remote");
    expect(
      localityChips(sessionView({ processingPolicy: "device-only" }), [
        run("interview-session-agent-claude", "device-only"),
      ]).locality.text,
    ).toBe("On this Mac");
  });
});

describe("approach items", () => {
  it("renders a fenced block as code and never keeps the fences", () => {
    const items = approachItems(
      "1. Count with a map\n2. Use a heap\n```typescript\nconst m = new Map();\n  m.set(1, 2);\n```\nReturn the keys",
    );
    expect(items).toEqual([
      { kind: "line", text: "Count with a map" },
      { kind: "line", text: "Use a heap" },
      { kind: "code", text: "const m = new Map();\n  m.set(1, 2);" },
      { kind: "line", text: "Return the keys" },
    ]);
    expect(JSON.stringify(items)).not.toContain("```");
  });
  it("keeps an unclosed fence's code and drops empty fences", () => {
    expect(approachItems("```ts\nlet x = 1;")).toEqual([
      { kind: "code", text: "let x = 1;" },
    ]);
    expect(approachItems("```\n```\nDone")).toEqual([
      { kind: "line", text: "Done" },
    ]);
  });
});
