import type {
  BriefingPrepared,
  BriefingQuestion,
} from "@omnitech/interview-contracts";
import type { z } from "zod";
import type {
  citationSchema,
  modelSchema,
  preparedModelSchema,
  Source,
} from "../contracts";

// One answer per question asked; match by id, otherwise preserve model order.
export function groundAnswers(
  generated: z.infer<typeof modelSchema>,
  declared: Pick<BriefingQuestion, "id" | "question" | "category">[],
  sources: Source[],
) {
  if (generated.questions.length !== declared.length)
    return {
      error: {
        code: "generation-failed",
        hint: `The model answered ${generated.questions.length} of ${declared.length} questions.`,
      },
    };
  return {
    questions: declared.map((question, index) =>
      validateQuestion(
        generated.questions.find((item) => item.id === question.id) ??
          generated.questions[index]!,
        question,
        sources,
      ),
    ),
  };
}
// [DOMAIN] Every factual claim must be grounded in an exact quotation from
// the matrix or the employer material. A claim that cannot be verified keeps
// no evidence and becomes a visible gap, so nothing unproven reads as fact,
// rather than the whole answer being discarded.
export function verifiedCitation(
  citation: z.infer<typeof citationSchema>,
  fieldText: string,
  sources: Source[],
) {
  if (!citation.quote || !fieldText.includes(citation.text)) return null;
  const source = sources.find(
    (item) =>
      item.pointer === citation.pointer &&
      item.sourceKind === citation.sourceKind &&
      item.text.includes(citation.quote),
  );
  return source
    ? {
        id: source.id,
        revision: source.revision,
        sha256: source.sha256,
        pointer: source.pointer,
        quote: citation.quote,
        sourceKind: source.sourceKind,
        text: citation.text,
      }
    : null;
}
const unverified = (text: string) =>
  `Could not verify “${text.length > 80 ? `${text.slice(0, 79)}…` : text}” against your sources.`;
const NUMBER = /\d+(?:[.,]\d+)*(?:[%kKmMbB])?\+?/g;
const RANGE =
  /\d+(?:[.,]\d+)*(?:%|[kKmMbB])?\s*(?:to|–|—|-)\s*\d+(?:[.,]\d+)*(?:%|[kKmMbB])?/gi;
// [DOMAIN] Figures backed by the cited quotes, plus the metric values of
// every role those quotes come from: a metric's number lives in its own
// leaf, apart from the role's prose the answer usually quotes.
export function supportedFigures(
  refs: readonly { pointer: string; quote: string }[],
  sources: Source[],
) {
  const roles = new Set(
    refs.flatMap((ref) => ref.pointer.match(/^\/roles\/\d+\//) ?? []),
  );
  const metrics = sources.filter((source) =>
    [...roles].some(
      (role) =>
        source.pointer.startsWith(`${role}metrics/`) &&
        source.pointer.endsWith("/value"),
    ),
  );
  return new Set(
    [
      ...refs.map((ref) => ref.quote),
      ...metrics.map((item) => item.text),
    ].flatMap((text) => text.match(NUMBER) ?? []),
  );
}

export function validateQuestion(
  question: z.infer<typeof modelSchema>["questions"][number],
  declared: {
    id: string;
    question: string;
    category: BriefingQuestion["category"];
  },
  sources: Source[],
): BriefingQuestion {
  const gaps = [...question.gaps];
  const evidenceRefs: BriefingQuestion["evidenceRefs"] = [];
  for (const citation of question.citations) {
    const fieldText =
      citation.field === "answerMarkdown"
        ? question.answerMarkdown
        : question.talkingPoints.join(" ");
    const ref = verifiedCitation(citation, fieldText, sources);
    if (ref) evidenceRefs.push({ ...ref, field: citation.field });
    else gaps.push(unverified(citation.text));
  }
  if (!evidenceRefs.length && !gaps.length)
    gaps.push("No source was cited for this answer.");
  // [SAFETY] A figure is only stated as fact when a cited quote, or a
  // metric of a cited role, contains it.
  for (const [field, body] of [
    ["answerMarkdown", question.answerMarkdown],
    ["talkingPoints", question.talkingPoints.join(" ")],
  ] as const) {
    const quoted = supportedFigures(
      evidenceRefs.filter((ref) => ref.field === field),
      sources,
    );
    for (const figure of new Set(body.match(NUMBER) ?? []))
      if (!quoted.has(figure))
        gaps.push(
          `States a figure your sources don’t support: ${figure}. Check it before using.`,
        );
    // A cited metric, lower bound ("4M+") or range keeps its exact wording.
    for (const ref of evidenceRefs.filter((item) => item.field === field)) {
      const source = sources.find((item) => item.pointer === ref.pointer);
      if (!source) continue;
      const metric = /\/metrics\/\d+\/value$/.test(source.pointer)
        ? [source.text]
        : [];
      const ranges = (source.text.match(RANGE) ?? []).filter((range) =>
        (range.match(NUMBER) ?? []).some((figure) => body.includes(figure)),
      );
      for (const exact of [...metric, ...ranges])
        if (!body.includes(exact))
          gaps.push(
            `Use the figure exactly as your sources state it: “${exact}”.`,
          );
    }
  }
  if (question.answerMarkdown.trim().split(/\s+/).length > 180)
    gaps.push("This runs past 60 seconds spoken; trim it.");
  return {
    ...declared,
    answerMarkdown: question.answerMarkdown,
    talkingPoints: question.talkingPoints,
    evidenceRefs,
    gaps: [...new Set(gaps)],
  };
}

// Every line of text in a prepared briefing, for checking its claims.
function textOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textOf);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(textOf);
  return [];
}

// [DOMAIN] The same grounding rules as answers: claims that cannot be
// verified, figures no quote supports and stories from roles the matrix
// does not have become gaps for the person to check.
export function validatePrepared(
  generated: z.infer<typeof preparedModelSchema>,
  sources: Source[],
  roleCount: number,
): BriefingPrepared {
  const { citations, gaps: modelGaps, ...content } = generated;
  const gaps = [...modelGaps];
  const evidenceRefs: BriefingPrepared["evidenceRefs"] = [];
  // Agenda minutes are a plan and role ids are references, not claims, so
  // they are left out here.
  const body = textOf({
    ...content,
    agenda: content.agenda.map((item) => item.topic),
    stories: content.stories.map(({ roleId: _role, ...story }) => story),
  }).join("\n");
  for (const citation of citations) {
    const ref = verifiedCitation(citation, body, sources);
    if (ref) evidenceRefs.push(ref);
    else gaps.push(unverified(citation.text));
  }
  const quoted = supportedFigures(evidenceRefs, sources);
  for (const figure of new Set(body.match(NUMBER) ?? []))
    if (!quoted.has(figure))
      gaps.push(
        `States a figure your sources don’t support: ${figure}. Check it before using.`,
      );
  const stories = content.stories.map((story) => {
    const index = story.roleId ? Number(story.roleId.split("/")[2]) : -1;
    if (index >= 0 && index < roleCount) return story;
    const { roleId: _unknown, ...rest } = story;
    return rest;
  });
  return { ...content, stories, evidenceRefs, gaps: [...new Set(gaps)] };
}
