import {
  type DocumentBlock,
  type DocumentField,
  type DocumentFieldError,
  documentBlocks,
  documentValuesSchema,
  validateDocumentValues,
} from "@omnitech/interview-contracts";
import {
  castFromValues,
  castRoles,
  castValues,
  type DocumentCast,
  revisionCast,
} from "./cast";
import type { DocumentContext } from "./context";
import { revisionClaimState } from "./source-digest";
import {
  fieldHash,
  revisionConfirmations,
  standingConfirmations,
  verifyDocumentFields,
} from "./verify";

// The rules of a document, as pure functions: no database, no model, no
// request. Services call them to decide; the repository calls them for what a
// stored revision holds.

type Values = Record<string, string>;

/** What a revision is saved with, before the rules below are applied. */
export type RevisionDraft = {
  values: Values;
  provenance: Record<string, unknown>;
  aiUsage?: unknown;
  // Fields whose text says something its evidence does not (`verify.ts`),
  // found by the caller, which holds the matrix.
  unsupported?: readonly DocumentFieldError[];
};

/** A document with any field problem needs attention; without, it is ready. */
export const documentStatus = (
  validation: readonly DocumentFieldError[],
): "invalid" | "ready" => (validation.length ? "invalid" : "ready");

/**
 * What a revision stores: its values, checked against the template's field
 * contract, with every field problem (missing, too long, unexpected, and the
 * unsupported claims the caller found).
 */
export function revisionContent(
  fields: readonly DocumentField[],
  draft: RevisionDraft,
) {
  const values = documentValuesSchema.parse(draft.values);
  return {
    values,
    provenance: draft.provenance,
    validation: [
      ...validateDocumentValues(fields, values),
      ...(draft.unsupported ?? []),
    ],
    aiUsage: draft.aiUsage ?? null,
  };
}

/**
 * [DOMAIN] Restoring a revision makes a new one with the same values. It
 * says where it came from, is the candidate's to confirm again, and keeps
 * what was unsupported: the same text against the same matrix still is.
 */
export function restoredDraft(
  source: { values: unknown; provenance: unknown; validation: unknown },
  sourceRevision: number,
): RevisionDraft {
  return {
    values: source.values as Values,
    provenance: {
      ...(source.provenance as Record<string, unknown>),
      restoredFromRevision: sourceRevision,
      claimState: "unverified",
    },
    aiUsage: null,
    unsupported: (Array.isArray(source.validation)
      ? (source.validation as DocumentFieldError[])
      : []
    ).filter((issue) => issue?.code === "unsupported"),
  };
}

/**
 * [SAFETY] A field the application or the interview states is not the
 * person's to retype while the document is tied to that source: a request
 * that changes one is refused, whatever the page allowed.
 */
export function changesSourceBoundField(
  fields: readonly DocumentField[],
  document: { candidacyId: string | null; interviewId: string | null },
  stored: Values,
  next: Values,
): boolean {
  return fields.some(
    (field) =>
      ((field.source === "candidacy" && document.candidacyId) ||
        (field.source === "interview" && document.interviewId)) &&
      next[field.key] !== stored[field.key],
  );
}

/**
 * How a document stands with these values: its cast, who owns each field,
 * which confirmations still hold, and which fields say something their
 * evidence does not. Computed from the pinned matrix every time, so a
 * document made before verification existed is held to the same check.
 */
export function standing(
  item: { fields: DocumentField[]; template: { kind: string } },
  candidate: DocumentContext,
  values: Values,
  provenance: unknown,
  change: { cast?: DocumentCast | null; confirm?: readonly string[] } = {},
) {
  const matrix = candidate.candidateProfile;
  const hasBlocks = documentBlocks(item.fields).length > 0;
  // The cast the revision keeps; a document older than casts implies one
  // by the employer each block names.
  const storedCast =
    change.cast !== undefined ? change.cast : revisionCast(provenance);
  const cast =
    storedCast ??
    (hasBlocks ? castFromValues(item.fields, values, matrix) : null);
  const facts = {
    ...candidate.profileValues,
    ...(cast && hasBlocks ? castValues(item.fields, cast, matrix) : {}),
  };
  const modelOwned = (field: DocumentField) =>
    field.source === "candidate-profile" &&
    !Object.hasOwn(facts, field.key) &&
    !candidate.missingProfileKeys.includes(field.key);
  const modelOwnedKeys = item.fields
    .filter(modelOwned)
    .map((field) => field.key);
  const confirmed = standingConfirmations(
    {
      ...revisionConfirmations(provenance),
      ...Object.fromEntries(
        (change.confirm ?? []).map((key) => [
          key,
          fieldHash(values[key] ?? ""),
        ]),
      ),
    },
    values,
  );
  // A resume claims only what the matrix holds. A letter or a prep sheet
  // also speaks about the employer, so the posting's own words are theirs.
  const about = [
    candidate.candidacyValues["company_name"] ?? "",
    candidate.candidacyValues["role_title"] ?? "",
    ...(item.template.kind === "resume"
      ? []
      : [
          candidate.candidacyValues["job_description"] ?? "",
          ...Object.values(candidate.interviewValues),
        ]),
  ];
  const unsupported = verifyDocumentFields({
    fields: item.fields,
    values,
    // Prose is checked whoever wrote it: the model's fields, and every
    // bullet or skills line of a block (in a document older than casts a
    // block may show an employer that matches no role).
    checkedKeys: [
      ...modelOwnedKeys,
      ...item.fields
        .filter(
          (field) =>
            field.group?.part === "bullet" || field.group?.part === "skills",
        )
        .map((field) => field.key),
    ],
    matrix,
    cast,
    allowed: about,
    confirmed,
  });
  return {
    cast,
    facts,
    modelOwned,
    modelOwnedKeys,
    confirmed,
    unsupported,
    // What the next revision's provenance carries forward.
    kept: {
      ...(storedCast ? { cast: storedCast } : {}),
      ...(Object.keys(confirmed).length ? { confirmedFields: confirmed } : {}),
    },
  };
}

/** Every problem a draft has: the field contract's, and the unsupported. */
export function draftValidation(
  item: { fields: DocumentField[]; template: { kind: string } },
  candidate: DocumentContext,
  values: Values,
  provenance: unknown,
): DocumentFieldError[] {
  return [
    ...validateDocumentValues(item.fields, values),
    ...standing(item, candidate, values, provenance).unsupported,
  ];
}

/**
 * A document as the page reads it: field problems and ownership as they
 * stand now, and what the cast left out.
 */
export function documentView<
  Item extends {
    fields: DocumentField[];
    template: { kind: string };
    revision: { values: unknown; provenance: unknown };
  },
>(item: Item, candidate: DocumentContext) {
  const values = item.revision.values as Values;
  const state = standing(item, candidate, values, item.revision.provenance);
  const roles = new Map(
    castRoles(candidate.candidateProfile).map((role) => [role.id, role]),
  );
  const named = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const role = roles.get(id);
      return role ? [{ id, company: role.company, title: role.title }] : [];
    });
  const stored = revisionCast(item.revision.provenance);
  return {
    ...item,
    revision: {
      ...item.revision,
      validation: [
        ...validateDocumentValues(item.fields, values),
        ...state.unsupported,
      ],
      provenance: {
        ...(item.revision.provenance as Record<string, unknown>),
        modelOwnedKeys: state.modelOwnedKeys,
      },
    },
    review: {
      confirmedFields: Object.keys(state.confirmed),
      // Fields with no stored value that only the person can supply.
      contactKeys: candidate.privateKeys,
      cast: stored
        ? {
            consultancy: stored.consultancy,
            ranking: stored.ranking,
            leftOut: named(stored.leftOut),
            contracts: documentBlocks(item.fields)
              .filter((block) => block.kind === "contract")
              .flatMap((block) =>
                named(stored.slots[block.id] ?? []).map((role) => ({
                  block: block.id,
                  ...role,
                })),
              ),
          }
        : null,
    },
  };
}

/**
 * [DOMAIN] Source facts read again: what the application and the interview
 * state replaces what the document held; a fact stored since the document
 * was made (a contact detail) fills its field when that is still blank; what
 * the person typed stays.
 */
export function refreshedValues(
  fields: readonly DocumentField[],
  stored: Values,
  candidate: DocumentContext,
): Values {
  const values = { ...stored };
  for (const field of fields) {
    if (field.source === "candidacy")
      values[field.key] = candidate.candidacyValues[field.key] ?? "";
    if (field.source === "interview")
      values[field.key] = candidate.interviewValues[field.key] ?? "";
    if (
      field.source === "candidate-profile" &&
      !(values[field.key] ?? "").trim() &&
      candidate.profileValues[field.key]
    )
      values[field.key] = candidate.profileValues[field.key] ?? "";
  }
  return values;
}

/**
 * [DOMAIN] A client that was left out takes a contract block from the client
 * that holds it. Only a client left out may be swapped in, and only for one
 * that holds a block: the cast stays the matrix's roles, each used once.
 * Null when the swap is not one of those.
 */
export function swappedCast(
  stored: DocumentCast | null,
  blocks: readonly DocumentBlock[],
  blockId: string,
  roleId: string,
): {
  cast: DocumentCast;
  block: DocumentBlock;
  consultancyBlock: DocumentBlock | undefined;
} | null {
  const block = blocks.find(
    (item) => item.id === blockId && item.kind === "contract",
  );
  const replaced = stored?.slots[blockId]?.[0];
  if (!stored || !block || !replaced || !stored.leftOut.includes(roleId))
    return null;
  const slots = { ...stored.slots, [blockId]: [roleId] };
  const consultancyBlock = blocks.find((item) => item.kind === "consultancy");
  if (consultancyBlock)
    slots[consultancyBlock.id] = blocks
      .filter((item) => item.kind === "contract")
      .flatMap((item) => slots[item.id] ?? []);
  return {
    cast: {
      ...stored,
      slots,
      leftOut: [...stored.leftOut.filter((role) => role !== roleId), replaced],
    },
    block,
    consultancyBlock,
  };
}

export const DRAFT_LABEL = "DRAFT — Unverified candidate content";

/**
 * An export is labelled a draft until the candidate has confirmed the
 * revision and it has no field problem.
 */
export function isDraftExport(revision: {
  provenance: unknown;
  validation: unknown;
}): boolean {
  return (
    revisionClaimState(revision.provenance) !== "confirmed" ||
    (Array.isArray(revision.validation) && revision.validation.length > 0)
  );
}
