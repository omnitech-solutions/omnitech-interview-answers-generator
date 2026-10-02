import type { BriefingDraft } from "@omnitech/interview-contracts";

// [SAFETY] A briefing edited by the person (or by the assistant on their
// behalf) keeps evidence only where nothing it rests on changed: an edited
// answer, or any answer after the interview context changed, loses its
// evidence links and is marked for review. Evidence is only ever set by the
// server, never accepted from an edit.
export function userEditedBriefing(
  input: BriefingDraft,
  previous?: BriefingDraft | null,
): BriefingDraft {
  const sameContext =
    previous &&
    JSON.stringify(input.context) === JSON.stringify(previous.context);
  return {
    ...input,
    // The person may tick questions or move a story to another role, but
    // the briefing's evidence only ever comes from the server.
    ...(input.prepared
      ? {
          prepared: {
            ...input.prepared,
            evidenceRefs: previous?.prepared?.evidenceRefs ?? [],
          },
        }
      : {}),
    questions: input.questions.map((question) => {
      const prior = previous?.questions.find((item) => item.id === question.id);
      const unchanged =
        sameContext &&
        prior &&
        question.answerMarkdown === prior.answerMarkdown &&
        JSON.stringify(question.talkingPoints) ===
          JSON.stringify(prior.talkingPoints);
      const reason = sameContext
        ? "Review the edited answer against its sources."
        : "Review this answer against the changed interview context.";
      return {
        ...question,
        evidenceRefs: unchanged ? prior.evidenceRefs : [],
        gaps:
          unchanged || !prior
            ? question.gaps
            : [...new Set([...question.gaps, reason])],
      };
    }),
  };
}
