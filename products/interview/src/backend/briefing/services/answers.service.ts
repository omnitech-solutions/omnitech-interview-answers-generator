import type {
  BriefingContext,
  BriefingQuestion,
} from "@omnitech/interview-contracts";
import { WorkspaceError, type WorkspaceScope } from "../../assistant/workspace";
import { generateChecked } from "../../structured";
import {
  type BriefingDependencies,
  modelSchema,
  type Source,
} from "../contracts";
import { groundAnswers } from "../domain/grounding";
import {
  briefContext,
  candidateSources,
  contextSources,
  sha,
} from "../domain/sources";
import { ANSWER_SYSTEM } from "../prompts";
import { selectCandidateFragments } from "../selection";
import { getProfileRevision } from "./profiles.service";
// The sources an answer may cite: the matrix fragments most relevant to
// the questions, plus the pack's employer and preference material.
export async function sourcesFor(
  options: BriefingDependencies,
  scope: WorkspaceScope,
  context: BriefingContext,
  questions: { question: string; category: string }[],
  storyIds: readonly string[],
  draftRevision: number,
) {
  const profile = await getProfileRevision(
    options.database,
    scope,
    context.profile.id,
    context.profile.revision,
  );
  const selected = selectCandidateFragments(
    profile.matrix,
    `${context.role} ${context.jobDescription ?? ""} ${questions.map((question) => question.question).join(" ")}`,
    questions[0]?.category ?? "background",
    [...storyIds, ...(context.roleIds ?? [])],
  );
  const sources = [
    ...candidateSources(profile.matrix, selected, profile.id, profile.revision),
    ...contextSources(context, draftRevision),
    // [SAFETY] Employer material, cited by pointer like the rest: a line
    // of it is never the candidate's experience, and a gap it names is
    // never written as something the candidate did.
    ...(
      (await options.packContext?.(scope, context).catch(() => [])) ?? []
    ).map(
      (line): Source => ({
        pointer: line.pointer,
        text: line.text,
        sourceKind: "employer-context",
        id: sha(`${line.pointer}:${line.text}`),
        revision: draftRevision,
        sha256: sha(line.text),
      }),
    ),
  ];
  return { profile, sources };
}
export async function answerQuestions(
  options: BriefingDependencies,
  scope: WorkspaceScope,
  input: {
    context: BriefingContext;
    questions: {
      id: string;
      question: string;
      category: BriefingQuestion["category"];
    }[];
    storyIds?: readonly string[] | undefined;
    instruction?: string | undefined;
    draftRevision: number;
  },
) {
  const { profile, sources } = await sourcesFor(
    options,
    scope,
    input.context,
    input.questions,
    input.storyIds ?? [],
    input.draftRevision,
  );
  const generated = await generateChecked(
    options.generate,
    {
      system: ANSWER_SYSTEM,
      prompt: JSON.stringify({
        context: briefContext(input.context),
        questions: input.questions,
        sources: sources.map(({ pointer, text, sourceKind }) => ({
          pointer,
          text,
          sourceKind,
        })),
        instruction: input.instruction ?? "",
        storyIds: input.storyIds ?? [],
      }),
    },
    modelSchema,
    scope,
  );
  const result = groundAnswers(generated, input.questions, sources);
  if (result.error)
    throw new WorkspaceError(result.error.code, result.error.hint);
  return { profile, sources, questions: result.questions };
}
