import { Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type {
  AiEvent,
  AiExecution,
  AiExecutionRequest,
  AiResumeRequest,
  WorkflowEngine,
} from "@omnitech/ai-contracts";

interface DurableGraph {
  invoke(input: unknown, config: unknown): Promise<unknown>;
  stream(input: unknown, config: unknown): Promise<AsyncIterable<unknown>>;
}

export interface LangGraphWorkflowOptions {
  createGraph(
    checkpointer: PostgresSaver,
  ): Promise<DurableGraph> | DurableGraph;
  connectionString: string;
  toInput(request: AiExecutionRequest): unknown;
  toResult(output: unknown): unknown;
  toEvent?(chunk: unknown): AiEvent | undefined;
}

export interface DurableLangGraphWorkflow extends WorkflowEngine {
  resume(request: AiResumeRequest): AsyncIterable<AiEvent>;
  setup(): Promise<void>;
}

export function createLangGraphWorkflowEngine(
  options: LangGraphWorkflowOptions,
): DurableLangGraphWorkflow {
  const checkpointer = PostgresSaver.fromConnString(options.connectionString);
  let setupPromise: Promise<void> | undefined;
  const setup = async () => {
    setupPromise ??= checkpointer.setup();
    await setupPromise;
  };
  const config = (threadId: string) => ({
    configurable: { thread_id: threadId },
    streamMode: ["values", "messages"],
  });

  return {
    engine: "langgraph",
    setup,
    async execute(request): Promise<AiExecution> {
      await setup();
      const executionId = request.idempotencyKey ?? crypto.randomUUID();
      const graph = await options.createGraph(checkpointer);
      const output = await graph.invoke(
        options.toInput(request),
        config(executionId),
      );
      return {
        executionId,
        family: "workflow",
        targetId: "langgraph",
        result: options.toResult(output),
      };
    },
    async *stream(request: AiExecutionRequest): AsyncIterable<AiEvent> {
      await setup();
      const executionId = request.idempotencyKey ?? crypto.randomUUID();
      yield { type: "started", executionId };
      const graph = await options.createGraph(checkpointer);
      const stream = await graph.stream(
        options.toInput(request),
        config(executionId),
      );
      for await (const chunk of stream) {
        const event = options.toEvent?.(chunk);
        if (event) yield event;
      }
      yield { type: "completed", result: { executionId } };
    },
    async *resume(request: AiResumeRequest): AsyncIterable<AiEvent> {
      await setup();
      const graph = await options.createGraph(checkpointer);
      const stream = await graph.stream(
        new Command({ resume: request.input }),
        config(request.executionId),
      );
      for await (const chunk of stream) {
        const event = options.toEvent?.(chunk);
        if (event) yield event;
      }
      yield {
        type: "completed",
        result: { executionId: request.executionId },
      };
    },
  };
}
