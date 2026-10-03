// Defensive parsers for the two kinds of session content the stream carries as
// `unknown`: an action's published result and an observation's content. The
// shapes mirror what the backend publishes (assist-stage.ts, coding-path.ts,
// session-drafts.ts, escalation.ts) but are read here with lenient schemas:
// extra fields are ignored, and anything that does not parse is null. A screen
// shows nothing rather than a guess (rule:inert-draft-rendering: whatever these
// return is plain text for the screen to render inertly).
import { z } from "zod";

// ---- Answers (action kind "draft-answer") ---------------------------------

export const CLAIM_KINDS = [
  "matrix-backed",
  "preference-backed",
  "suggested-interpretation",
  "general-knowledge",
  "not-in-matrix",
] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const STAR_ELEMENTS = ["situation", "task", "action", "result"] as const;
export type StarElement = (typeof STAR_ELEMENTS)[number];
export const LOGISTICS_FIELDS = [
  "notice-period",
  "compensation",
  "work-arrangement",
] as const;
export type LogisticsField = (typeof LOGISTICS_FIELDS)[number];

const MAX_ITEMS = 50;

const claimRefSchema = z.object({
  sourceId: z.string(),
  revision: z.number().int(),
  pointer: z.string(),
  quote: z.string(),
});
const claimSchema = z.object({
  kind: z.enum(CLAIM_KINDS),
  text: z.string(),
  refs: z.array(claimRefSchema).max(MAX_ITEMS),
});
const indexes = z.array(z.number().int().min(0)).max(MAX_ITEMS);
const starElement = z.object({ text: z.string(), claimIndexes: indexes });
const starSchema = z.object({
  situation: starElement,
  task: starElement,
  action: starElement,
  result: starElement,
  missing: z.array(z.enum(STAR_ELEMENTS)).max(STAR_ELEMENTS.length),
});
const logisticsSchema = z.object({
  found: z
    .array(
      z.object({
        field: z.enum(LOGISTICS_FIELDS),
        claimIndex: z.number().int().min(0),
      }),
    )
    .max(MAX_ITEMS),
  missing: z.array(z.enum(LOGISTICS_FIELDS)).max(LOGISTICS_FIELDS.length),
});
const briefSchema = z.object({
  language: z.string(),
  restatement: z.string(),
  constraints: z.array(z.string()).max(MAX_ITEMS),
});
const answerSchema = z.object({
  category: z.string(),
  draft: z.string(),
  claims: z.array(claimSchema).max(MAX_ITEMS),
  star: starSchema.nullable().optional(),
  logistics: logisticsSchema.nullable().optional(),
  codingBrief: briefSchema.nullable().optional(),
  pinned: z
    .object({ profileId: z.string(), revision: z.number().int() })
    .nullable()
    .optional(),
});

export type ClaimRefView = z.infer<typeof claimRefSchema>;
export type ClaimView = z.infer<typeof claimSchema>;
export type CodingBriefView = z.infer<typeof briefSchema>;
export type StarElementView = {
  element: StarElement;
  text: string;
  // Claims (by position in `claims`) the element rests on; out-of-range
  // indexes are dropped, never guessed at.
  claims: ClaimView[];
  // The approved experience cannot support this element: it has no text.
  missing: boolean;
};
export type LogisticsFoundView = {
  field: LogisticsField;
  claim: ClaimView | null;
};
export type AnswerResult = {
  category: string;
  draft: string;
  claims: ClaimView[];
  star: StarElementView[] | null;
  logistics: { found: LogisticsFoundView[]; missing: LogisticsField[] } | null;
  codingBrief: CodingBriefView | null;
  // The matrix revision every matrix-backed claim was verified against.
  pinned: { profileId: string; revision: number } | null;
  claimCounts: Record<ClaimKind, number>;
};

export function parseAnswerResult(raw: unknown): AnswerResult | null {
  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { data } = parsed;
  const at = (index: number): ClaimView | null => data.claims[index] ?? null;
  const claimCounts = Object.fromEntries(
    CLAIM_KINDS.map((kind) => [kind, 0]),
  ) as Record<ClaimKind, number>;
  for (const claim of data.claims) claimCounts[claim.kind] += 1;
  return {
    category: data.category,
    draft: data.draft,
    claims: data.claims,
    star: data.star
      ? STAR_ELEMENTS.map((element) => ({
          element,
          text: data.star?.[element].text ?? "",
          claims: (data.star?.[element].claimIndexes ?? [])
            .map(at)
            .filter((claim): claim is ClaimView => claim !== null),
          missing: data.star?.missing.includes(element) ?? false,
        }))
      : null,
    logistics: data.logistics
      ? {
          found: data.logistics.found.map(({ field, claimIndex }) => ({
            field,
            claim: at(claimIndex),
          })),
          missing: data.logistics.missing,
        }
      : null,
    codingBrief: data.codingBrief ?? null,
    pinned: data.pinned ?? null,
    claimCounts,
  };
}

// ---- Code (action kind "solve-code") ---------------------------------------

const testSchema = z.object({
  name: z.string(),
  status: z.enum(["passed", "failed", "skipped"]),
});
const workspaceSchema = z.union([
  z.object({
    published: z.literal(true),
    workspaceId: z.string(),
    artifactId: z.string(),
    artifactRevision: z.number().int(),
  }),
  z.object({
    published: z.literal(false),
    conflict: z.literal(true),
    reason: z.string(),
    expectedRevision: z.number().int().nullable(),
    foundRevision: z.number().int().nullable(),
  }),
]);
const codeSchema = z.object({
  language: z.string(),
  code: z.string(),
  usageCode: z.string().optional(),
  testCode: z.string(),
  notes: z.string().optional(),
  // Three DISTINCT states; none implies another (code-states.ts).
  states: z.object({
    generated: z.boolean(),
    testsPassed: z.boolean(),
    fullyVerified: z.boolean(),
    reasons: z.array(z.string()).max(MAX_ITEMS),
  }),
  tests: z
    .object({
      total: z.number().int(),
      passed: z.number().int(),
      failed: z.number().int(),
      skipped: z.number().int(),
      results: z.array(testSchema).max(100),
    })
    .optional(),
  run: z
    .object({
      available: z.boolean(),
      exitCode: z.number().int().nullable(),
      timedOut: z.boolean(),
      durationMs: z.number().nullable(),
    })
    .optional(),
  syntax: z
    .object({ checked: z.boolean(), clean: z.boolean().nullable() })
    .optional(),
  repair: z
    .object({ attempted: z.boolean(), succeeded: z.boolean() })
    .optional(),
  replacesRevision: z.number().int().nullable().optional(),
  workspace: workspaceSchema.optional(),
});

export type CodeStatesView = z.infer<typeof codeSchema>["states"];
export type WorkspaceOutcomeView = z.infer<typeof workspaceSchema>;
export type CodeResult = {
  language: string;
  code: string;
  usageCode: string;
  testCode: string;
  notes: string;
  states: CodeStatesView;
  tests: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    results: { name: string; status: "passed" | "failed" | "skipped" }[];
  };
  runner: { available: boolean; timedOut: boolean; durationMs: number | null };
  syntax: { checked: boolean; clean: boolean | null };
  repair: { attempted: boolean; succeeded: boolean };
  // The earlier revision this solution replaces, if any.
  replacesRevision: number | null;
  // Absent when the result predates the Workspace write.
  workspace: WorkspaceOutcomeView | null;
};

export function parseCodeResult(raw: unknown): CodeResult | null {
  const parsed = codeSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { data } = parsed;
  return {
    language: data.language,
    code: data.code,
    usageCode: data.usageCode ?? "",
    testCode: data.testCode,
    notes: data.notes ?? "",
    states: data.states,
    tests: data.tests ?? {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      results: [],
    },
    runner: {
      available: data.run?.available ?? false,
      timedOut: data.run?.timedOut ?? false,
      durationMs: data.run?.durationMs ?? null,
    },
    syntax: data.syntax ?? { checked: false, clean: null },
    repair: data.repair ?? { attempted: false, succeeded: false },
    replacesRevision: data.replacesRevision ?? null,
    workspace: data.workspace ?? null,
  };
}

// ---- Agent job (action kind "agent-solve") ---------------------------------

const agentSchema = z.object({
  agent: z.object({
    jobRequested: z.boolean(),
    kind: z.string().optional(),
    jobId: z.string().optional(),
  }),
});
export type AgentResult = { jobRequested: boolean; kind: string | null };

export function parseAgentResult(raw: unknown): AgentResult | null {
  const parsed = agentSchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    jobRequested: parsed.data.agent.jobRequested,
    kind: parsed.data.agent.kind ?? null,
  };
}

// ---- Withheld draft (a suppressed "draft-answer", reason invalid_output) ----

// The backend records only a count of the claims verification rejected, never
// their text (withheld.ts). Parsed leniently so a server without the count
// shows the generic notice instead of failing.
const withheldSchema = z.object({
  withheld: z.object({ rejectedClaimCount: z.number().int().min(0) }),
});
export function parseWithheldResult(
  raw: unknown,
): { rejectedClaimCount: number } | null {
  const parsed = withheldSchema.safeParse(raw);
  return parsed.success
    ? { rejectedClaimCount: parsed.data.withheld.rejectedClaimCount }
    : null;
}

// ---- Observation content ----------------------------------------------------

const sourceSchema = z.enum(["microphone", "application-audio", "screen"]);
const transcriptContent = z.object({
  speaker: z.string(),
  text: z.string(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  supersedes: z.string().optional(),
});
const snapshotContent = z.object({
  windowLabel: z.string(),
  mediaType: z.string(),
  byteLength: z.number().int().min(0),
});
const disconnectedContent = z.object({
  source: sourceSchema,
  reason: z.enum([
    "user-stopped",
    "permission-revoked",
    "device-lost",
    "error",
  ]),
});
const gapContent = z.object({
  source: sourceSchema,
  durationMs: z.number().int().min(0),
  reason: z.enum(["buffer-overflow", "source-interrupted", "paused", "error"]),
});

export type TranscriptContent = z.infer<typeof transcriptContent>;
export type SnapshotContent = z.infer<typeof snapshotContent>;
export type DisconnectedContent = z.infer<typeof disconnectedContent>;
export type GapContent = z.infer<typeof gapContent>;

const orNull =
  <T>(schema: z.ZodType<T>) =>
  (raw: unknown): T | null => {
    const parsed = schema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  };
export const parseTranscriptContent = orNull(transcriptContent);
export const parseSnapshotContent = orNull(snapshotContent);
export const parseDisconnectedContent = orNull(disconnectedContent);
export const parseGapContent = orNull(gapContent);
