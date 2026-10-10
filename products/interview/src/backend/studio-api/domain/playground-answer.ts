import {
  answerGuideSchema,
  renderGuideMarkdown,
} from "@omnitech/interview-contracts";
import type { PlaygroundPatch } from "@omnitech/interview-playground-control";

// A guide that fails validation is named by its schema path only; the path is
// the schema's, never request text.
export class PlaygroundGuideInvalidError extends Error {
  constructor(readonly path: string) {
    super("The Playground answer guide is invalid.");
    this.name = "PlaygroundGuideInvalidError";
  }
}

// [GUARD] A pushed answer becomes a Workspace answer: its guide must be valid,
// and its Markdown is the guide's rendering, never the pushed text.
export function withRenderedPlaygroundAnswer(
  patch: PlaygroundPatch,
): PlaygroundPatch {
  if (!patch.answer) return patch;
  const guide = answerGuideSchema.safeParse(patch.answer.guide);
  if (!guide.success) {
    const issue = guide.error.issues[0];
    throw new PlaygroundGuideInvalidError(
      ["guide", ...(issue?.path ?? [])].join("."),
    );
  }
  return {
    ...patch,
    answer: {
      ...patch.answer,
      guide: guide.data,
      answerMarkdown: renderGuideMarkdown(guide.data),
    },
  };
}
