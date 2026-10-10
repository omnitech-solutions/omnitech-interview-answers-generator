import { randomUUID } from "node:crypto";
import { fakeCompletionContent } from "../domain/fake-completion";

export function fakeCompletion(value: unknown) {
  const body = value as {
    messages?: Array<{ content?: unknown }>;
    model?: string;
  };
  const content = fakeCompletionContent(body.messages);
  return {
    id: `fake-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? "fake-interview-model",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content },
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 10,
      total_tokens: 20,
    },
  };
}
