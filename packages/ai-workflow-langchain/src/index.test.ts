import { describe, expect, it } from "vitest";
import { createLangChainWorkflowEngine } from "./index.js";

describe("LangChain workflow boundary", () => {
  it("adapts runnable execution and streaming without exposing LangChain", async () => {
    const engine = createLangChainWorkflowEngine({
      createRunnable: () =>
        ({
          invoke: async () => ({ answer: "done" }),
          stream: async function* () {
            yield "one";
            yield "two";
          },
        }) as never,
      toInput: (request) => request.task.prompt,
      toResult: (output) => output,
      toTextDelta: (chunk) => String(chunk),
    });
    const request = {
      context: {
        tenantId: "tenant",
        userId: "user",
        productId: "product",
        permissions: [],
      },
      task: { type: "text-generation" as const, prompt: "hello" },
    };

    await expect(engine.execute(request)).resolves.toMatchObject({
      family: "workflow",
      targetId: "langchain",
      result: { answer: "done" },
    });
    const events = [];
    for await (const event of engine.stream(request)) events.push(event);
    expect(events).toEqual([
      expect.objectContaining({ type: "started" }),
      { type: "text-delta", text: "one" },
      { type: "text-delta", text: "two" },
      expect.objectContaining({ type: "completed" }),
    ]);
  });
});
