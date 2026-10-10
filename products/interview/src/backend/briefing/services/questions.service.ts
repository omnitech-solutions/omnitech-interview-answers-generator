import { randomUUID } from "node:crypto";
import {
  type briefingAskSchema,
  briefingDraftSchema,
  type briefingProposalRequestSchema,
  briefingCategoryOf as categoryOf,
} from "@omnitech/interview-contracts";
import type { z } from "zod";
import {
  InterviewWorkspaceRepository,
  WorkspaceError,
  type WorkspaceScope,
} from "../../assistant/workspace";
import type { BriefingDependencies } from "../contracts";
import {
  artifactRevisionError,
  questionReplacement,
  refinementError,
  replaceAnswers,
} from "../domain/artifacts";
import { answerQuestions } from "./answers.service";
import { createProposal } from "./proposals.service";
export async function proposeAnswers(
  options: BriefingDependencies,
  scope: WorkspaceScope,
  artifactId: string,
  input: z.infer<typeof briefingProposalRequestSchema>,
) {
  const workspace = new InterviewWorkspaceRepository(options.database);
  const current = await workspace.read(scope, "briefings", artifactId);
  if (!current.value.briefing) throw new WorkspaceError("not-found");
  const revisionError = artifactRevisionError(
    current.origin.artifactRevision,
    input.expectedRevision,
  );
  if (revisionError) throw new WorkspaceError(revisionError);
  const error = refinementError(current.value.briefing, input);
  if (error) throw new WorkspaceError(error);
  const { profile, sources, questions } = await answerQuestions(
    options,
    scope,
    {
      context: input.context,
      questions: input.questions,
      storyIds: input.storyIds,
      instruction: input.instruction,
      draftRevision: current.origin.artifactRevision,
    },
  );
  const briefing = briefingDraftSchema.parse({
    kind: "non-technical-briefing",
    title: current.value.briefing.title,
    context: input.context,
    ...(current.value.briefing.prepared
      ? { prepared: current.value.briefing.prepared }
      : {}),
    ...(current.value.briefing.expected
      ? { expected: current.value.briefing.expected }
      : {}),
    questions: input.questionId
      ? current.value.briefing.questions.map((question) =>
          question.id === input.questionId ? questions[0] : question,
        )
      : questions,
  });
  const proposal = await createProposal(options.database, scope, {
    artifactId,
    baseRevision: input.expectedRevision,
    profileId: profile.id,
    profileRevision: profile.revision,
    profileSha256: profile.sha256,
    briefing,
    sourceSnapshot: sources,
  });
  return {
    id: proposal.id,
    baseRevision: proposal.baseRevision,
    briefing: proposal.briefing,
  };
}

export async function askQuestion(
  options: BriefingDependencies,
  scope: WorkspaceScope,
  artifactId: string,
  input: z.infer<typeof briefingAskSchema>,
) {
  const workspace = new InterviewWorkspaceRepository(options.database);
  const current = await workspace.read(scope, "briefings", artifactId);
  const briefing = current.value.briefing;
  if (!briefing) throw new WorkspaceError("not-found");
  const revisionError = artifactRevisionError(
    current.origin.artifactRevision,
    input.expectedRevision,
  );
  if (revisionError) throw new WorkspaceError(revisionError);
  const replacement = questionReplacement(briefing, input.replaceId);
  if (replacement.error)
    throw new WorkspaceError(replacement.error, replacement.hint);
  const { replacing } = replacement;
  const declared = {
    id: replacing?.id ?? `q-${randomUUID()}`,
    question: input.question,
    category: input.category ?? categoryOf(input.question),
  };
  const { questions } = await answerQuestions(options, scope, {
    context: briefing.context,
    questions: [declared],
    draftRevision: current.origin.artifactRevision,
  });
  const updated = await workspace.edit(scope, current.origin, {
    briefing: briefingDraftSchema.parse({
      ...briefing,
      // A redraft keeps its place and needs reviewing again.
      questions: replaceAnswers(briefing.questions, questions, replacing),
    }),
  });
  return updated;
}
