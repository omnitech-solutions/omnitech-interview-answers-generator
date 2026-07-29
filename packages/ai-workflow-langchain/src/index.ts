import type { RunnableInterface } from "@langchain/core/runnables";
import type {
  AiEvent,
  AiExecution,
  AiExecutionRequest,
  WorkflowEngine,
} from "@omnitech/ai-contracts";

export interface LangChainWorkflowOptions {
  createRunnable(request: AiExecutionRequest): RunnableInterface;
  toInput(request: AiExecutionRequest): unknown;
  toResult(output: unknown): unknown;
  toTextDelta?(chunk: unknown): string | undefined;
}

export function createLangChainWorkflowEngine(
  options: LangChainWorkflowOptions,
): WorkflowEngine {
  return {
    engine: "langchain",
    async execute(request): Promise<AiExecution> {
      const output = await options
        .createRunnable(request)
        .invoke(
          options.toInput(request),
          request.signal === undefined ? {} : { signal: request.signal },
        );
      return {
        executionId: crypto.randomUUID(),
        family: "workflow",
        targetId: "langchain",
        result: options.toResult(output),
      };
    },
    async *stream(request: AiExecutionRequest): AsyncIterable<AiEvent> {
      const executionId = crypto.randomUUID();
      yield { type: "started", executionId };
      const output = await options
        .createRunnable(request)
        .stream(
          options.toInput(request),
          request.signal === undefined ? {} : { signal: request.signal },
        );
      for await (const chunk of output) {
        const text = options.toTextDelta?.(chunk);
        if (text) yield { type: "text-delta", text };
      }
      yield { type: "completed", result: { executionId } };
    },
  };
}
