import type {
  BriefingDraft,
  BriefingQuestion,
  briefingProposalRequestSchema,
} from "@omnitech/interview-contracts";
import type { z } from "zod";
import type { ProposalRecord, Source } from "../contracts";
import { sha } from "./sources";

export const artifactRevisionError = (actual: number, expected: number) =>
  actual !== expected ? "revision-conflict" : null;

export function refinementError(
  briefing: BriefingDraft,
  input: z.infer<typeof briefingProposalRequestSchema>,
) {
  if (
    input.questionId &&
    (input.questions.length !== 1 ||
      input.questions[0]?.id !== input.questionId ||
      !briefing.questions.some(
        (question) => question.id === input.questionId,
      ) ||
      JSON.stringify(input.context) !== JSON.stringify(briefing.context))
  )
    return "invalid-refinement";
  return null;
}

export function questionReplacement(
  briefing: BriefingDraft,
  replaceId: string | undefined,
) {
  const replacing = replaceId
    ? briefing.questions.find((item) => item.id === replaceId)
    : undefined;
  if (replaceId && !replacing) return { error: "not-found" as const };
  if (!replacing && briefing.questions.length >= 20)
    return {
      error: "pack-full" as const,
      hint: "A pack holds 20 answers. Remove one to ask another.",
    };
  return { replacing };
}

export function replaceAnswers(
  questions: BriefingQuestion[],
  answers: BriefingQuestion[],
  replacing: BriefingQuestion | undefined,
) {
  return replacing
    ? questions.map((item) =>
        item.id === replacing.id ? (answers[0] ?? item) : item,
      )
    : [...questions, ...answers];
}

export const proposalRevisionError = (
  proposal: ProposalRecord,
  artifactId: string,
  expectedRevision: number,
) =>
  proposal.artifactId !== artifactId ||
  proposal.baseRevision !== expectedRevision
    ? "revision-conflict"
    : null;

export function proposalCitationError(
  briefing: BriefingDraft,
  sources: Source[],
) {
  for (const question of briefing.questions)
    for (const ref of question.evidenceRefs) {
      const source = sources.find(
        (item) =>
          item.id === ref.id &&
          item.revision === ref.revision &&
          item.pointer === ref.pointer &&
          item.sourceKind === ref.sourceKind &&
          item.sha256 === ref.sha256 &&
          item.text.includes(ref.quote),
      );
      if (!source || sha(source.text) !== source.sha256)
        return "citation-quote-conflict";
    }
  return null;
}

export function saveRevisionError(
  briefing: BriefingDraft | null | undefined,
  actual: number,
  expected: number,
  first: BriefingDraft,
) {
  if (
    !briefing ||
    actual !== expected ||
    briefing.context.profile.id !== first.context.profile.id ||
    briefing.context.profile.revision !== first.context.profile.revision
  )
    return "revision-conflict";
  return null;
}
