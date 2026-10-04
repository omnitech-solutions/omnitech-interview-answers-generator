import { createBriefsClient } from "@omnitech/interview-api-client";
import type { RehearsalReveal } from "@omnitech/interview-contracts";
import { studioFetch } from "../studio-fetch";
import type { StudioLists } from "../use-studio-lists";
import type { Draft } from "../workspace/use-canonical-draft";
import { FALLBACK_CONCEPTS } from "./config";

// What a rehearsal asks: a concept from the person's briefs (or a built-in
// prompt), and a coding question from their Workspace drafts.
export type QuestionChoice = {
  source: "brief" | "question" | "prompt";
  ref: string;
  title: string;
};
export type ConceptMaterial = {
  choice: QuestionChoice;
  followUps: readonly string[];
};
export type CodingMaterial = {
  choice: QuestionChoice;
  statement: string;
  example: string | null;
  // Only the hints this question's answer can supply.
  reveals: Partial<Record<RehearsalReveal, string>>;
};

export const choiceKey = (choice: QuestionChoice) =>
  `${choice.source}:${choice.ref}`;

export function conceptChoices(lists: StudioLists): QuestionChoice[] {
  return [
    ...lists.briefs.map((brief) => ({
      source: "brief" as const,
      ref: brief.id,
      title: brief.title,
    })),
    ...FALLBACK_CONCEPTS.map((prompt) => ({
      source: "prompt" as const,
      ref: prompt.id,
      title: prompt.title,
    })),
  ];
}

export function codingChoices(lists: StudioLists): QuestionChoice[] {
  return lists.questions.map((question) => ({
    source: "question",
    ref: question.artifactId,
    title: question.title,
  }));
}

export async function loadConcept(
  choice: QuestionChoice,
): Promise<ConceptMaterial> {
  if (choice.source === "brief") {
    const brief = await createBriefsClient({
      baseUrl: "",
      fetch: studioFetch,
    }).get(choice.ref);
    return {
      choice,
      followUps: brief.brief.followUps.map((item) => item.question),
    };
  }
  const prompt = FALLBACK_CONCEPTS.find((item) => item.id === choice.ref);
  return { choice, followUps: prompt?.followUps ?? [] };
}

export async function loadCoding(
  choice: QuestionChoice,
  workspaceId: string,
): Promise<CodingMaterial> {
  const response = await studioFetch(
    `/api/interview/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(choice.ref)}`,
  );
  if (!response.ok) throw new Error(`${response.status}`);
  const record = (await response.json()) as { value: Draft };
  return codingMaterial(choice, record.value);
}

// [DOMAIN] Hints come from the answer's guide, from gentlest to the full
// solution; a question with no answer yet offers none.
export function codingMaterial(
  choice: QuestionChoice,
  draft: Draft,
): CodingMaterial {
  const answer = draft.answer;
  const guide = answer?.guide;
  const example = guide?.understand.examples[0];
  const candidates: Record<RehearsalReveal, string | undefined> = {
    clarify: guide?.understand.clarify.join(" · "),
    hint1: guide?.plan.steps[0],
    pattern: guide?.explain[0]?.heading,
    approach: guide?.plan.steps
      .map((step, index) => `${index + 1}. ${step}`)
      .join("\n"),
    edge: guide?.edgeCases.map((edge) => edge.name).join(" · "),
    solution: answer?.code,
    tests: answer?.testCode,
  };
  const reveals: CodingMaterial["reveals"] = {};
  for (const [id, body] of Object.entries(candidates))
    if (body?.trim()) reveals[id as RehearsalReveal] = body.trim();
  return {
    choice,
    statement: guide?.understand.prompt ?? draft.question,
    example: example ? `${example.input} → ${example.output}` : null,
    reveals,
  };
}
