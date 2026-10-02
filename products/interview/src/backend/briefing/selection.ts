import type { CandidateMatrix } from "@omnitech/interview-contracts";

export type SelectedRole = Readonly<{
  pointer: string;
  role: CandidateMatrix["roles"][number];
}>;
const normalize = (value: unknown) => String(value ?? "").toLowerCase();
const match = (values: unknown, terms: readonly string[]) =>
  Array.isArray(values) &&
  values.some((value) =>
    terms.some(
      (term) =>
        normalize(value).includes(term) || term.includes(normalize(value)),
    ),
  );

// [DOMAIN] Every role is a source: relevant roles come first so the model
// reads them first, and the rest keep their matrix order.
export function selectCandidateFragments(
  matrix: CandidateMatrix,
  query: string,
  category: string,
  storyIds: readonly string[] = [],
): SelectedRole[] {
  const terms = normalize(query)
    .split(/[^a-z0-9+#.]+/)
    .filter((part) => part.length >= 3);
  const stories = (matrix.story_selector ?? []).filter((item) =>
    terms.some((term) => normalize(item.need).includes(term)),
  );
  const requested = new Set(storyIds);
  for (const story of stories) {
    for (const [index, role] of matrix.roles.entries()) {
      if (
        [story.primary_story, story.backup_story].some(
          (name) =>
            name &&
            [role.company, role.title].some((value) =>
              normalize(name).includes(normalize(value)),
            ),
        )
      )
        requested.add(`/roles/${index}`);
    }
  }
  return matrix.roles
    .map((role, index) => {
      const pointer = `/roles/${index}`;
      const skill =
        match(role.technologies, terms) || match(role.system_types, terms)
          ? 1
          : 0;
      const domain =
        match(role.industry, terms) || match(role.problem_spaces, terms)
          ? 1
          : 0;
      const adjacent =
        match(role.tags, terms) ||
        match(role.patterns, terms) ||
        match(role.responsibilities, terms) ||
        terms.some(
          (term) =>
            normalize(role.title).includes(term) ||
            normalize(role.company).includes(term),
        )
          ? 1
          : 0;
      const leadership =
        ["leadership", "collaboration"].includes(category) &&
        match(role.leadership_signals, terms)
          ? 1
          : 0;
      return {
        pointer,
        role,
        score: [
          skill,
          domain,
          adjacent,
          leadership,
          Number(requested.has(pointer)),
        ],
        index,
      };
    })
    .sort((a, b) => {
      for (let part = 0; part < a.score.length; part++) {
        const difference = (b.score[part] ?? 0) - (a.score[part] ?? 0);
        if (difference) return difference;
      }
      return a.index - b.index;
    })
    .map(({ pointer, role }) => ({ pointer, role }));
}
