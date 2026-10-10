import { generatedAnswerSchema } from "@omnitech/interview-contracts";
import type { PlaygroundPatch } from "@omnitech/interview-playground-control";
import { describe, expect, it } from "vitest";
import { guidedProse } from "../../../answer-fixture";
import {
  coachWriterOptions,
  conversationIsCurrent,
  notesSpace,
  transcriptCursor,
} from "./conversation";
import { exceedsExecutionBounds, previewComponentName } from "./execution";
import { fakeCompletionContent } from "./fake-completion";
import { answerPagination } from "./pagination";
import {
  PlaygroundGuideInvalidError,
  withRenderedPlaygroundAnswer,
} from "./playground-answer";

describe("answer pagination", () => {
  it("keeps unpaged requests separate from explicitly requested defaults", () => {
    expect(answerPagination(undefined, undefined)).toEqual({ kind: "all" });
    expect(answerPagination("2", undefined)).toEqual({
      kind: "page",
      page: 2,
      pageSize: 20,
    });
    expect(answerPagination(undefined, "100")).toEqual({
      kind: "page",
      page: 1,
      pageSize: 100,
    });
  });

  it.each(["", "0", "-1", "1.5", "NaN", "Infinity", "word"])(
    "rejects invalid page %s",
    (page) => {
      expect(answerPagination(page, "20")).toEqual({ kind: "invalid" });
    },
  );

  it.each(["", "0", "-1", "1.5", "101", "NaN", "Infinity"])(
    "rejects invalid page size %s",
    (size) => {
      expect(answerPagination("1", size)).toEqual({ kind: "invalid" });
    },
  );

  it("preserves Number's accepted numeric spellings", () => {
    expect(answerPagination(" 2 ", "1e2")).toEqual({
      kind: "page",
      page: 2,
      pageSize: 100,
    });
  });
});

describe("execution policy", () => {
  it("accepts the exact caps for every field", () => {
    expect(
      exceedsExecutionBounds({
        code: "x".repeat(200_000),
        usageCode: "x".repeat(200_000),
        testCode: "x".repeat(200_000),
        stdin: "x".repeat(64_000),
      }),
    ).toBe(false);
  });

  it.each(["code", "usageCode", "testCode", "stdin"] as const)(
    "rejects one character above the %s cap",
    (field) => {
      expect(
        exceedsExecutionBounds({
          code: "1",
          [field]: "x".repeat(field === "stdin" ? 64_001 : 200_001),
        }),
      ).toBe(true);
    },
  );

  it.each([undefined, null, 2, "", "app", "App-name", "App;throw"])(
    "defaults invalid component name %s",
    (name) => {
      expect(previewComponentName(name)).toBe("App");
    },
  );

  it("keeps an explicit valid component name", () => {
    expect(previewComponentName("Counter_2")).toBe("Counter_2");
  });
});

describe("conversation policy", () => {
  it("only permits a literal takeover and a numeric lease", () => {
    expect(coachWriterOptions({ takeover: true, leaseSeconds: 1.5 })).toEqual({
      takeover: true,
      leaseMs: 1500,
    });
    expect(
      coachWriterOptions({ takeover: "true", leaseSeconds: "15" }),
    ).toEqual({ takeover: false });
    expect(coachWriterOptions({})).toEqual({ takeover: false });
    expect(coachWriterOptions({ leaseSeconds: Number.NaN }).leaseMs).toBeNaN();
  });
  it("selects replay only by its exact name", () => {
    expect(notesSpace("replay")).toBe("replay");
    for (const value of [undefined, "", "live", "Replay", "anything"]) {
      expect(notesSpace(value)).toBe("live");
    }
  });

  it("normalises cursors without rounding", () => {
    for (const value of [undefined, "", "0", "-1", "1.5", "Infinity", "x"]) {
      expect(transcriptCursor(value)).toBe(0);
    }
    expect(transcriptCursor(" 3 ")).toBe(3);
    expect(transcriptCursor("1e2")).toBe(100);
  });

  it("accepts unnamed conversations and rejects a mismatched epoch", () => {
    expect(conversationIsCurrent(undefined, "current")).toBe(true);
    expect(conversationIsCurrent("current", "current")).toBe(true);
    expect(conversationIsCurrent("", "current")).toBe(false);
    expect(conversationIsCurrent("earlier", "current")).toBe(false);
  });
});

describe("Playground answer policy", () => {
  it("preserves a patch with no answer", () => {
    const patch = { notes: "Keep this note", answer: null };
    expect(withRenderedPlaygroundAnswer(patch)).toBe(patch);
  });

  it("renders the guide instead of trusting supplied Markdown, without mutation", () => {
    const patch: PlaygroundPatch = {
      notes: "Keep this note",
      answer: {
        title: "Counter",
        language: "typescript",
        ...guidedProse("Keep state local."),
        answerMarkdown: "untrusted pushed text",
        code: "const count = 0;",
        usageCode: "console.log(count)",
        testCode: "",
      },
    };
    const rendered = withRenderedPlaygroundAnswer(patch);
    expect(rendered.notes).toBe(patch.notes);
    expect(rendered.answer?.answerMarkdown).toContain("Keep state local.");
    expect(rendered.answer?.answerMarkdown).not.toContain(
      "untrusted pushed text",
    );
    expect(patch.answer?.answerMarkdown).toBe("untrusted pushed text");
  });

  it("refuses an invalid guide using only its schema path", () => {
    const patch = {
      answer: { guide: { version: 2, privateText: "never echo" } },
    } as unknown as PlaygroundPatch;
    try {
      withRenderedPlaygroundAnswer(patch);
      expect.fail("An invalid guide must be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(PlaygroundGuideInvalidError);
      expect((error as PlaygroundGuideInvalidError).path).toBe("guide.version");
      expect((error as Error).message).not.toContain("never echo");
    }
  });
});

describe("deterministic fake completion", () => {
  it.each(["PHP", "React", "TypeScript", "Ruby"])(
    "keeps a valid fake answer for %s",
    (language) => {
      const answer = JSON.parse(
        fakeCompletionContent([{ content: `Target language: ${language}` }]),
      );
      expect(answer.language).toBe(language.toLowerCase());
      expect(
        generatedAnswerSchema.omit({ answerMarkdown: true }).safeParse(answer)
          .success,
      ).toBe(true);
    },
  );

  it("defaults missing or null message content to TypeScript", () => {
    for (const messages of [undefined, [{ content: null }], []]) {
      expect(JSON.parse(fakeCompletionContent(messages)).language).toBe(
        "typescript",
      );
    }
  });

  it("chooses the concept response from the joined prompt", () => {
    expect(
      JSON.parse(
        fakeCompletionContent([
          { content: "Target language: PHP" },
          { content: "Concept to explain: hooks" },
        ]),
      ),
    ).toMatchObject({ title: "Interview-ready concept" });
  });
});
