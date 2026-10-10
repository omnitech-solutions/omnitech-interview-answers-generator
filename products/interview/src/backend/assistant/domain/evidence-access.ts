// [DOMAIN] Evidence is used only by its audience and never once restricted.
export const evidenceUsableBy = (
  actorId: string,
  evidence: { classification: unknown; audience: unknown },
): boolean =>
  evidence.classification !== "restricted" &&
  Array.isArray(evidence.audience) &&
  evidence.audience.includes(actorId);

// [SAFETY] Revocation: one restricted (or no longer shared) latest source
// closes the whole private workspace; a workspace with no source is open.
export const workspaceReadableBy = (
  actorId: string,
  latestSources: readonly { classification?: unknown; audience?: unknown }[],
): boolean =>
  latestSources.every((source) =>
    evidenceUsableBy(actorId, {
      classification: source.classification,
      audience: source.audience,
    }),
  );
