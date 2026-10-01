import type { ModelProviderAdapter } from "@omnitech/ai-contracts";

function escape(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** A deterministic draft builder for local development without a model service. */
export function createLocalModelAdapter(): ModelProviderAdapter {
  return {
    providerId: "local",
    modelId: "local-draft",
    capabilities: {
      streaming: true,
      structuredOutput: true,
      tools: false,
      vision: false,
      search: false,
    },
    async execute(request) {
      const prompt = request.task.prompt;
      const brief =
        prompt.split("\n\nCreate an outline for exactly ")[0]?.trim() ||
        prompt.trim();
      const title =
        brief
          .split(/[.!?\n]/)[0]
          ?.trim()
          .slice(0, 120) || "New presentation";
      const properties = request.task.schema?.["properties"];
      const isSlide =
        typeof properties === "object" &&
        properties !== null &&
        "sourceXml" in properties;
      const count = Math.min(
        20,
        Math.max(
          1,
          Number(
            prompt.match(/Create an outline for exactly (\d+) slides\./)?.[1] ??
              5,
          ),
        ),
      );
      const sections = [
        "Overview",
        "Context",
        "Goals",
        "Key points",
        "Practical example",
        "Options",
        "Trade-offs",
        "Recommendation",
        "Action plan",
        "Next steps",
      ];
      const result =
        request.task.type === "structured-generation"
          ? isSlide
            ? {
                sourceXml: `<SECTION layout="vertical"><H1>${escape(title)}</H1><P>${escape(brief.slice(title.length).replace(/^[.!?\s]+/, "") || "Add supporting detail for your audience.")}</P></SECTION>`,
              }
            : {
                title,
                outline: Array.from(
                  { length: count },
                  (_, index) =>
                    `${sections[index % sections.length]}${index >= sections.length ? ` ${Math.floor(index / sections.length) + 1}` : ""}: ${title}`,
                ),
              }
          : { text: `Local draft: ${brief}`, finishReason: "stop" };
      return {
        executionId: crypto.randomUUID(),
        family: "direct-model",
        targetId: "local",
        result,
      };
    },
    async *stream(request) {
      yield { type: "started", executionId: crypto.randomUUID() };
      const text = `Local draft: ${request.task.prompt}`;
      yield { type: "text-delta", text };
      yield { type: "completed", result: { text } };
    },
  };
}
