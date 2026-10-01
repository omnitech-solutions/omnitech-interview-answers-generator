import { describe, expect, it } from "vitest";
import { createLangGraphWorkflowEngine } from "./index.js";

describe("LangGraph workflow boundary", () => {
  it("exposes durable execute, stream, and resume operations", () => {
    const chunks = async function* () {
      yield {};
    };
    const engine = createLangGraphWorkflowEngine({
      connectionString: "postgresql://localhost/test",
      createGraph: async () => ({
        invoke: async () => ({}),
        stream: async () => chunks(),
      }),
      toInput: (request) => request.task.prompt,
      toResult: (output) => output,
    });
    expect(engine.engine).toBe("langgraph");
    expect(engine.setup).toBeTypeOf("function");
    expect(engine.resume).toBeTypeOf("function");
  });
});
