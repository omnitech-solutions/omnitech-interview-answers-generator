import { type AiEngine, executionFromHeaders } from "@omnitech/ai-engine";
import {
  candidateMatrixSchema,
  type DocumentField,
  type DocumentFieldError,
  type DocumentFormat,
  type DocumentValues,
  documentBlocks,
  type documentCreateSchema,
  documentLayout,
  validateDocumentValues,
} from "@omnitech/interview-contracts";
import type { DocumentArtifactRepository } from "@omnitech/platform-storage";
import type { z } from "zod";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import type { ApplicationPacks } from "../context-pack/application";
import type { createInFlight } from "../work-guards";
import {
  castValues,
  type DocumentCast,
  decideCast,
  planCast,
  revisionCast,
} from "./cast";
import type { DocumentsConfig } from "./config";
import type { DocumentContext, resolveDocumentContext } from "./context";
import {
  changesSourceBoundField,
  DRAFT_LABEL,
  documentView,
  draftValidation,
  isDraftExport,
  refreshedValues,
  standing,
  swappedCast,
} from "./document.domain";
import { documentFieldOwnership, generateDocumentValues } from "./generate";
import type { LineLayout } from "./render-blank";
import { renderDocxTemplate } from "./render-docx";
import { renderDocxAsMarkdown } from "./render-docx-markdown";
import {
  renderMarkdownPreview,
  renderMarkdownTemplate,
} from "./render-markdown";
import {
  DocumentAlreadyExists,
  DocumentNotFound,
  DocumentRevisionConflict,
  type InterviewDocumentRepository,
} from "./repository";
import {
  documentSourceDigest,
  revisionClaimState,
  revisionModelOwnedKeys,
  revisionSourceDigest,
} from "./source-digest";

// The document use cases: each loads under the member's scope, applies the
// rules (document.domain.ts), asks the repository to persist, and returns the
// result. No HTTP here and no SQL: the route parses and maps (api.ts), the
// repository persists (repository.ts).

export type DocumentScope = {
  tenantId: string;
  actorId: string;
  productId: typeof INTERVIEW_PRODUCT_ID;
  canWrite?: boolean;
};

export class InvalidField extends Error {}
export class TargetUnavailable extends Error {}
export class GenerationFailed extends Error {}
export class RequestCancelled extends Error {}
export class DocumentSourceChanged extends Error {}
// [SAFETY] A document that says something its evidence does not is not
// exported: the refusal names each field and what was not found.
export class DocumentVerificationFailed extends Error {
  constructor(readonly fields: Array<DocumentFieldError & { label: string }>) {
    super("Document has unsupported claims");
  }
}

/** What every use case is given: where state lives and who writes prose. */
export type DocumentDeps = {
  repo: InterviewDocumentRepository;
  artifacts: DocumentArtifactRepository;
  engine: AiEngine;
  config: DocumentsConfig;
  // Documents being written right now, so a second window asking for the
  // same one is told so instead of paying for it twice.
  writing: ReturnType<typeof createInFlight>;
  // The sources a document is written from, read under the member's scope.
  contextFor(
    scope: DocumentScope,
    input: Parameters<typeof resolveDocumentContext>[1],
  ): Promise<DocumentContext>;
  applicationPacks?: Pick<ApplicationPacks, "forDocument"> | undefined;
};

/** What a use case that calls a model needs of the request that asked. */
export type Asking = {
  headers: Headers;
  signal: AbortSignal;
  retryKey: string | null;
  // Identifies the request for a retry: the same key must ask the same thing.
  bindingHash: string;
};

const scopeKey = (scope: DocumentScope) => ({
  tenantId: scope.tenantId,
  actorId: scope.actorId,
});

// Who a documents call is made for: the member, with the two permissions
// every documents write holds.
export const asking = (scope: DocumentScope) => ({
  scope: {
    tenantId: scope.tenantId,
    actorId: scope.actorId,
    productId: INTERVIEW_PRODUCT_ID,
  },
  permissions: ["interview.read", "interview.documents.write"],
});

// [DOMAIN] A document is written by a named model profile or by an agent:
// never by an image profile, and never by a catalogue's model (LM Studio's
// or OpenRouter's), which only the assistant's picker offers.
export async function writers(deps: DocumentDeps, scope: DocumentScope) {
  return (await deps.engine.profiles(asking(scope))).filter(
    (profile) =>
      profile.kind === "agent" ||
      (profile.kind === "model" && !profile.listing),
  );
}

async function authorizedTarget(
  deps: DocumentDeps,
  scope: DocumentScope,
  targetId: string,
) {
  if (!(await writers(deps, scope)).some((profile) => profile.id === targetId))
    throw new TargetUnavailable();
}

const contextOf = (
  deps: DocumentDeps,
  scope: DocumentScope,
  selection: {
    profileId: string;
    profileRevision: number;
    candidacyId: string | null;
    interviewId: string | null;
  },
) =>
  deps.contextFor(scope, {
    tenantId: scope.tenantId,
    actorId: scope.actorId,
    profileId: selection.profileId,
    profileRevision: selection.profileRevision,
    candidacyId: selection.candidacyId,
    interviewId: selection.interviewId,
  });

// The application's facts as a document reads them, with their fingerprint:
// a document's role is the application's title.
function sourcesOf(candidate: DocumentContext): string {
  candidate.candidacyValues["target_role"] =
    candidate.candidacyValues["role_title"] ?? "";
  return documentSourceDigest(
    candidate.candidacyValues,
    candidate.interviewValues,
  );
}

async function load(
  deps: DocumentDeps,
  scope: DocumentScope,
  id: string,
  revision?: number,
) {
  const item = await deps.repo.getDocument(scopeKey(scope), id, revision);
  if (!item) throw new DocumentNotFound();
  return item;
}

async function loadWithContext(
  deps: DocumentDeps,
  scope: DocumentScope,
  id: string,
  revision?: number,
) {
  const item = await load(deps, scope, id, revision);
  return { item, candidate: await contextOf(deps, scope, item.document) };
}

/** Refuses with not-found unless the document is the member's. */
export async function requireDocument(
  deps: DocumentDeps,
  scope: DocumentScope,
  id: string,
) {
  return load(deps, scope, id);
}

/** A template revision's source file, as it was uploaded or provisioned. */
export async function templateSource(
  deps: Pick<DocumentDeps, "artifacts">,
  scope: DocumentScope,
  item: {
    revision: { sourceArtifactId: string };
    template: { ownerUserId: string | null };
  },
) {
  const bytes = await deps.artifacts.read({
    ...scopeKey(scope),
    artifactId: item.revision.sourceArtifactId,
    expectedType: item.template.ownerUserId
      ? "interview.document-template-source"
      : "interview.document-template-builtin",
  });
  if (!bytes) throw new DocumentNotFound();
  return bytes;
}

// DOCX previews are the filled file itself, rendered in the browser so the
// layout is the document's own; Markdown previews are tagged HTML.
export async function previewOf(
  format: string,
  bytes: Buffer,
  values: Record<string, string>,
  layout?: LineLayout,
) {
  return format === "docx"
    ? {
        kind: "docx" as const,
        docx: (
          await renderDocxTemplate(bytes, values, {
            missing: "tagged",
            ...(layout ? { layout } : {}),
          })
        ).toString("base64"),
      }
    : {
        kind: "html" as const,
        html: renderMarkdownPreview(
          bytes.toString("utf8"),
          values,
          layout?.absent,
        ),
      };
}

// [DOMAIN] The pack a writing call reads: for the application the document
// is for, the roles it was cast with. The cast and the verification are
// untouched (cast.ts, verify.ts); the pack adds which achievement is
// evidence for which requirement, and where the gaps are.
async function packFor(
  deps: DocumentDeps,
  scope: DocumentScope,
  input: {
    candidacyId: string | null;
    profileId: string;
    profileRevision: number;
    matrix: unknown;
    cast: DocumentCast | null | undefined;
    signal: AbortSignal;
  },
) {
  if (!deps.applicationPacks || !input.candidacyId) return null;
  const matrix = candidateMatrixSchema.safeParse(input.matrix);
  if (!matrix.success) return null;
  const roles = input.cast
    ? [...new Set(Object.values(input.cast.slots).flat())]
    : undefined;
  return deps.applicationPacks.forDocument(scope, {
    candidacyId: input.candidacyId,
    matrix: matrix.data,
    profile: { id: input.profileId, revision: input.profileRevision },
    ...(roles ? { roles } : {}),
    signal: input.signal,
  });
}

async function templateBytes(
  deps: DocumentDeps,
  scope: DocumentScope,
  document: { templateId: string; templateRevision: number },
) {
  const template = await deps.repo.getTemplateRevision(
    scopeKey(scope),
    document.templateId,
    document.templateRevision,
  );
  if (!template) throw new DocumentNotFound();
  return templateSource(deps, scope, template);
}

export async function viewDocument(
  deps: DocumentDeps,
  scope: DocumentScope,
  id: string,
  revision?: number,
) {
  const { item, candidate } = await loadWithContext(deps, scope, id, revision);
  return documentView(item, candidate);
}

/** An edit by hand: one new revision on the revision it was read at. */
export async function saveRevision(
  deps: DocumentDeps,
  scope: DocumentScope,
  id: string,
  input: {
    baseRevision: number;
    values: DocumentValues;
    confirm?: string[] | undefined;
  },
) {
  const { item: current, candidate } = await loadWithContext(deps, scope, id);
  if (input.baseRevision !== current.document.currentRevision)
    throw new DocumentRevisionConflict();
  if (
    changesSourceBoundField(
      current.fields,
      current.document,
      current.revision.values as Record<string, string>,
      input.values,
    )
  )
    throw new InvalidField();
  if (
    input.confirm?.some(
      (key) => !current.fields.some((field) => field.key === key),
    )
  )
    throw new InvalidField();
  // An edit is checked like the model's text; a field the person marks
  // "confirmed by me" is theirs to state, and stays so until it changes.
  const state = standing(
    current,
    candidate,
    input.values,
    current.revision.provenance,
    input.confirm ? { confirm: input.confirm } : {},
  );
  return deps.repo.appendRevision(scopeKey(scope), {
    documentId: id,
    baseRevision: input.baseRevision,
    values: input.values,
    provenance: {
      kind: input.confirm?.length ? "field-confirmed" : "edited",
      ...(input.confirm?.length ? { fieldKeys: input.confirm } : {}),
      sourceDigest: revisionSourceDigest(current.revision.provenance),
      modelOwnedKeys: revisionModelOwnedKeys(current.revision.provenance),
      claimState: "unverified",
      ...state.kept,
    },
    unsupported: state.unsupported,
  });
}

export type RegenerateInput = { baseRevision: number; aiTargetId: string } & (
  | { fieldKey: string }
  | { mode: "all" | "fix" }
);
type Revision = Awaited<
  ReturnType<InterviewDocumentRepository["appendRevision"]>
>;
export type WriteOutcome =
  | { kind: "saved"; revision: Revision }
  | { kind: "replayed"; revision: Revision }
  | { kind: "in-progress" };

/** The model writes one field, the fields with a problem, or all its own. */
export async function regenerateDocument(
  deps: DocumentDeps,
  scope: DocumentScope,
  id: string,
  input: RegenerateInput,
  request: Asking,
): Promise<WriteOutcome> {
  const current = await load(deps, scope, id);
  if (request.retryKey) {
    const prior = await deps.repo.getGenerationRequest(
      scopeKey(scope),
      request.retryKey,
      request.bindingHash,
    );
    if (prior) {
      const saved = await deps.repo.getDocument(
        scopeKey(scope),
        prior.documentId,
        prior.revision,
      );
      if (!saved || saved.document.id !== id) throw new DocumentNotFound();
      return { kind: "replayed", revision: saved.revision };
    }
  }
  if (input.baseRevision !== current.document.currentRevision)
    throw new DocumentRevisionConflict();
  await authorizedTarget(deps, scope, input.aiTargetId);
  const candidate = await contextOf(deps, scope, current.document);
  const before = current.revision.values as Record<string, string>;
  const everything = !("fieldKey" in input) && input.mode === "all";
  let state = standing(current, candidate, before, current.revision.provenance);
  const problems = new Set(
    [
      ...validateDocumentValues(current.fields, before),
      ...state.unsupported,
    ].map((issue) => issue.key),
  );
  // Which fields are rewritten: one, all the model's, or the model's with
  // a problem (missing, too long, or saying something unsupported).
  const chosen = (owned: (field: DocumentField) => boolean) =>
    "fieldKey" in input
      ? current.fields.filter(
          (item) => item.key === input.fieldKey && owned(item),
        )
      : input.mode === "all"
        ? current.fields.filter(owned)
        : current.fields.filter(
            (item) => owned(item) && problems.has(item.key),
          );
  if (!chosen(state.modelOwned).length) throw new InvalidField();
  const sourceDigest = sourcesOf(candidate);
  if (sourceDigest !== revisionSourceDigest(current.revision.provenance))
    throw new DocumentSourceChanged();
  const requestIdentity = request.retryKey
    ? {
        key: request.retryKey,
        bindingHash: request.bindingHash,
        sourceDigest,
      }
    : undefined;
  if (requestIdentity)
    await deps.repo.reserveGeneration(scopeKey(scope), requestIdentity);
  // A second window regenerating the same revision is told, not charged.
  const release = deps.writing.claim(
    JSON.stringify(["regenerate", scope.tenantId, id, input.baseRevision]),
  );
  if (!release) return { kind: "in-progress" };
  const rewrite = async () => {
    // [STRATEGY] Rewriting every field decides the cast afresh, which also
    // brings a document made before casts under one: its employers, titles
    // and dates become the server's. Rewriting some fields keeps the cast.
    if (everything && documentBlocks(current.fields).length > 0)
      state = standing(
        current,
        candidate,
        before,
        current.revision.provenance,
        {
          cast: await decideCast(deps.engine, {
            ...scopeKey(scope),
            profileId: input.aiTargetId,
            request: executionFromHeaders(request.headers),
            fields: current.fields,
            matrix: candidate.candidateProfile,
            candidacyValues: candidate.candidacyValues,
            signal: request.signal,
          }),
        },
      );
    const fields = chosen(state.modelOwned);
    const generated = await generateDocumentValues(deps.engine, {
      ...scopeKey(scope),
      profileId: input.aiTargetId,
      request: executionFromHeaders(request.headers),
      for: { kind: "document", id },
      cast: state.cast,
      pack: await packFor(deps, scope, {
        candidacyId: current.document.candidacyId,
        profileId: current.document.profileId,
        profileRevision: current.document.profileRevision,
        matrix: candidate.candidateProfile,
        cast: state.cast,
        signal: request.signal,
      }),
      privateKeys: candidate.privateKeys,
      blockKeys: current.fields
        .filter((field) => field.group)
        .map((field) => field.key),
      // Text that failed verification is not shown back to the model.
      rejectedKeys: state.unsupported.map((issue) => issue.key),
      templateId: current.document.templateId,
      templateRevision: current.document.templateRevision,
      candidateProfileRevisionId: `${current.document.profileId}:${current.document.profileRevision}`,
      fields,
      instructions: current.templateRevision.instructions,
      candidateProfile: candidate.candidateProfile,
      candidacyValues: candidate.candidacyValues,
      interviewValues: candidate.interviewValues,
      profileValues: state.facts,
      missingProfileKeys: candidate.missingProfileKeys,
      // Regenerating one field keeps the kind and length of what it replaces. A whole
      // document rewrite does not pay for second tries, and "fix" mode replaces the
      // very value that failed validation (often too long).
      ...("fieldKey" in input
        ? {
            replacing: Object.fromEntries(
              fields.map((item) => [item.key, before[item.key] ?? ""]),
            ),
          }
        : {}),
      generation: deps.config.generation,
      signal: request.signal,
    });
    return { fields, generated };
  };
  const { fields, generated } = await rewrite()
    .catch(() => {
      throw request.signal.aborted
        ? new RequestCancelled()
        : new GenerationFailed();
    })
    .finally(release);
  if (request.signal.aborted) throw new RequestCancelled();
  const values = {
    ...before,
    // A fresh cast's employers, titles and dates replace the old ones.
    ...(everything
      ? Object.fromEntries(
          current.fields
            .filter(
              (field) => field.group && Object.hasOwn(state.facts, field.key),
            )
            .map((field) => [field.key, state.facts[field.key] ?? ""]),
        )
      : {}),
    ...generated.values,
  };
  // The new text is checked like the first; a field rewritten no longer
  // carries the person's confirmation of its old text.
  const after = standing(
    current,
    candidate,
    values,
    current.revision.provenance,
    {
      cast: everything ? state.cast : revisionCast(current.revision.provenance),
    },
  );
  return {
    kind: "saved",
    revision: await deps.repo.appendRevision(scopeKey(scope), {
      documentId: id,
      baseRevision: input.baseRevision,
      values,
      provenance: {
        kind: "regenerated",
        fieldKeys: fields.map((field) => field.key),
        targetId: input.aiTargetId,
        sourceDigest,
        modelOwnedKeys: after.modelOwnedKeys,
        claimState: "unverified",
        ...after.kept,
      },
      aiUsage: generated.usage,
      unsupported: after.unsupported,
      ...(requestIdentity ? { requestIdentity } : {}),
    }),
  };
}

// [DOMAIN] A consultancy with more clients than the template has contract
// blocks leaves one out. The person may put it in a block instead of the
// client there: the block's employer and title become the server's from the
// new role, and its prose (and the shared skills line) is written again
// from that role alone, so nothing of the replaced client stays behind.
export async function swapCast(
  deps: DocumentDeps,
  scope: DocumentScope,
  id: string,
  input: {
    baseRevision: number;
    block: string;
    roleId: string;
    aiTargetId: string;
  },
  request: Pick<Asking, "headers" | "signal">,
): Promise<WriteOutcome> {
  const { item: current, candidate } = await loadWithContext(deps, scope, id);
  if (input.baseRevision !== current.document.currentRevision)
    throw new DocumentRevisionConflict();
  const swap = swappedCast(
    revisionCast(current.revision.provenance),
    documentBlocks(current.fields),
    input.block,
    input.roleId,
  );
  if (!swap) throw new InvalidField();
  const { cast, block, consultancyBlock } = swap;
  await authorizedTarget(deps, scope, input.aiTargetId);
  const sourceDigest = sourcesOf(candidate);
  if (sourceDigest !== revisionSourceDigest(current.revision.provenance))
    throw new DocumentSourceChanged();
  const before = current.revision.values as Record<string, string>;
  const state = standing(
    current,
    candidate,
    before,
    current.revision.provenance,
    { cast },
  );
  const fields = current.fields.filter(
    (field) =>
      state.modelOwned(field) &&
      (field.group?.id === input.block ||
        field.group?.id === consultancyBlock?.id),
  );
  const release = deps.writing.claim(
    JSON.stringify(["regenerate", scope.tenantId, id, input.baseRevision]),
  );
  if (!release) return { kind: "in-progress" };
  const generated = await generateDocumentValues(deps.engine, {
    ...scopeKey(scope),
    profileId: input.aiTargetId,
    request: executionFromHeaders(request.headers),
    for: { kind: "document", id },
    cast,
    privateKeys: candidate.privateKeys,
    blockKeys: current.fields
      .filter((field) => field.group)
      .map((field) => field.key),
    templateId: current.document.templateId,
    templateRevision: current.document.templateRevision,
    candidateProfileRevisionId: `${current.document.profileId}:${current.document.profileRevision}`,
    fields,
    instructions: current.templateRevision.instructions,
    candidateProfile: candidate.candidateProfile,
    candidacyValues: candidate.candidacyValues,
    interviewValues: candidate.interviewValues,
    profileValues: state.facts,
    missingProfileKeys: candidate.missingProfileKeys,
    generation: deps.config.generation,
    signal: request.signal,
  })
    .catch(() => {
      throw request.signal.aborted
        ? new RequestCancelled()
        : new GenerationFailed();
    })
    .finally(release);
  if (request.signal.aborted) throw new RequestCancelled();
  const values = {
    ...before,
    ...Object.fromEntries(
      block.fields
        .filter((field) => Object.hasOwn(state.facts, field.key))
        .map((field) => [field.key, state.facts[field.key] ?? ""]),
    ),
    ...generated.values,
  };
  const after = standing(
    current,
    candidate,
    values,
    current.revision.provenance,
    { cast },
  );
  return {
    kind: "saved",
    revision: await deps.repo.appendRevision(scopeKey(scope), {
      documentId: id,
      baseRevision: input.baseRevision,
      values,
      provenance: {
        kind: "recast",
        fieldKeys: fields.map((field) => field.key),
        targetId: input.aiTargetId,
        sourceDigest,
        modelOwnedKeys: after.modelOwnedKeys,
        claimState: "unverified",
        ...after.kept,
      },
      aiUsage: generated.usage,
      unsupported: after.unsupported,
    }),
  };
}

/** The application's and the interview's facts, read again into the document. */
export async function refreshSources(
  deps: DocumentDeps,
  scope: DocumentScope,
  id: string,
  input: { baseRevision: number },
) {
  const current = await load(deps, scope, id);
  if (input.baseRevision !== current.document.currentRevision)
    throw new DocumentRevisionConflict();
  const candidate = await contextOf(deps, scope, current.document);
  const sourceDigest = sourcesOf(candidate);
  const values = refreshedValues(
    current.fields,
    current.revision.values as Record<string, string>,
    candidate,
  );
  const state = standing(
    current,
    candidate,
    values,
    current.revision.provenance,
  );
  return deps.repo.appendRevision(scopeKey(scope), {
    documentId: id,
    baseRevision: input.baseRevision,
    values,
    provenance: {
      kind: "source-refreshed",
      sourceDigest,
      modelOwnedKeys: state.modelOwnedKeys,
      claimState: "unverified",
      ...state.kept,
    },
    unsupported: state.unsupported,
  });
}

/** The candidate vouches for the current revision as a whole. */
export async function confirmDocument(
  deps: DocumentDeps,
  scope: DocumentScope,
  id: string,
  input: { baseRevision: number },
) {
  const { item: current, candidate } = await loadWithContext(deps, scope, id);
  if (input.baseRevision !== current.document.currentRevision)
    throw new DocumentRevisionConflict();
  const values = current.revision.values as Record<string, string>;
  const state = standing(
    current,
    candidate,
    values,
    current.revision.provenance,
  );
  return deps.repo.appendRevision(scopeKey(scope), {
    documentId: id,
    baseRevision: input.baseRevision,
    values,
    provenance: {
      kind: "candidate-confirmed",
      sourceDigest: revisionSourceDigest(current.revision.provenance),
      modelOwnedKeys: revisionModelOwnedKeys(current.revision.provenance),
      claimState: "confirmed",
      ...state.kept,
    },
    unsupported: state.unsupported,
  });
}

/** An earlier revision becomes the latest, as a new revision. */
export function restoreRevision(
  deps: DocumentDeps,
  scope: DocumentScope,
  id: string,
  input: { baseRevision: number; sourceRevision: number },
) {
  return deps.repo.restoreRevision(scopeKey(scope), {
    documentId: id,
    ...input,
  });
}

export async function previewRevision(
  deps: DocumentDeps,
  scope: DocumentScope,
  id: string,
  revision?: number,
) {
  const { item, candidate } = await loadWithContext(deps, scope, id, revision);
  const bytes = await templateBytes(deps, scope, item.document);
  const values = item.revision.values as Record<string, string>;
  return {
    ...(await previewOf(
      item.template.format,
      bytes,
      values,
      documentLayout(item.fields, values),
    )),
    revision: item.revision.revision,
    validation: documentView(item, candidate).revision.validation,
    claimState: revisionClaimState(item.revision.provenance),
  };
}

/** A draft is drawn and checked as it would be saved, without saving it. */
export async function previewDraft(
  deps: DocumentDeps,
  scope: DocumentScope,
  id: string,
  input: { baseRevision: number; values: DocumentValues },
) {
  const { item, candidate } = await loadWithContext(deps, scope, id);
  if (input.baseRevision !== item.document.currentRevision)
    throw new DocumentRevisionConflict();
  if (
    changesSourceBoundField(
      item.fields,
      item.document,
      item.revision.values as Record<string, string>,
      input.values,
    )
  )
    throw new InvalidField();
  const bytes = await templateBytes(deps, scope, item.document);
  return {
    ...(await previewOf(
      item.template.format,
      bytes,
      input.values,
      documentLayout(item.fields, input.values),
    )),
    validation: draftValidation(
      item,
      candidate,
      input.values,
      item.revision.provenance,
    ),
  };
}

export async function exportDocument(
  deps: DocumentDeps,
  scope: DocumentScope,
  id: string,
  input: { revision: number; format: DocumentFormat },
) {
  const { item, candidate } = await loadWithContext(
    deps,
    scope,
    id,
    input.revision,
  );
  if (item.template.format === "md" && input.format !== "md")
    return { kind: "unsupported-format" as const };
  const bytes = await templateBytes(deps, scope, item.document);
  const values = item.revision.values as Record<string, string>;
  // [SAFETY] Export is refused while any field says something its evidence
  // does not and the person has not confirmed it. Checked here, now, so a
  // document saved before verification existed is held to it as well.
  const unsupported = standing(
    item,
    candidate,
    values,
    item.revision.provenance,
  ).unsupported;
  if (unsupported.length)
    throw new DocumentVerificationFailed(
      unsupported.map((issue) => ({
        ...issue,
        label:
          item.fields.find((field) => field.key === issue.key)?.label ??
          issue.key,
      })),
    );
  const layout = documentLayout(item.fields, values);
  const draft = isDraftExport(item.revision);
  const rendered =
    input.format === "docx"
      ? await renderDocxTemplate(bytes, values, {
          missing: "blank",
          layout,
          ...(draft ? { draftLabel: DRAFT_LABEL } : {}),
        })
      : Buffer.from(
          (draft ? `# ${DRAFT_LABEL}\n\n` : "") +
            (item.template.format === "docx"
              ? await renderDocxAsMarkdown(bytes, values, layout)
              : renderMarkdownTemplate(bytes.toString("utf8"), values, {
                  missing: "blank",
                  layout,
                })),
          "utf8",
        );
  const exported = await deps.repo.recordExport(scopeKey(scope), {
    documentId: id,
    revision: input.revision,
    format: input.format,
    bytes: rendered,
    title: item.document.title,
    metadata: { revision: input.revision, format: input.format, draft },
  });
  return {
    kind: "exported" as const,
    export: { ...exported, draft, warnings: item.revision.validation },
  };
}

export async function listExports(
  deps: DocumentDeps,
  scope: DocumentScope,
  id: string,
) {
  await load(deps, scope, id);
  return deps.repo.listExports(scopeKey(scope), id);
}

export async function readExport(
  deps: DocumentDeps,
  scope: DocumentScope,
  id: string,
  exportId: string,
) {
  const item = await load(deps, scope, id);
  const record = (await deps.repo.listExports(scopeKey(scope), id)).find(
    (entry) => entry.id === exportId,
  );
  if (!record) throw new DocumentNotFound();
  const artifactId = await deps.repo.getExportArtifactId(
    scopeKey(scope),
    exportId,
  );
  if (!artifactId) throw new DocumentNotFound();
  const bytes = await deps.artifacts.read({
    ...scopeKey(scope),
    artifactId,
    expectedType: "interview.document-export",
  });
  if (!bytes) throw new DocumentNotFound();
  return { bytes, format: record.format, title: item.document.title };
}

type CreateInput = z.infer<typeof documentCreateSchema>;
type Created = Awaited<
  ReturnType<InterviewDocumentRepository["createDocument"]>
>;
type GenerationHooks = Parameters<typeof generateDocumentValues>[2];
export type WrittenDocument =
  | (Created & { existingDocumentId?: never })
  | { existingDocumentId: string };
export type CreateOutcome =
  | {
      kind: "replayed";
      document: Created["document"];
      revision: Created["revision"];
    }
  | { kind: "exists"; existingDocumentId: string }
  | { kind: "created"; created: Created; errors: DocumentFieldError[] }
  | { kind: "in-progress" }
  | {
      // A model is to write it: the caller runs the work (watching it or
      // not) and releases the claim when the work has settled.
      kind: "writing";
      write(hooks?: GenerationHooks): Promise<WrittenDocument>;
      release(): void;
    };

/**
 * A new document from a template and the member's sources: made by hand
 * (no model is called), or written by a model.
 */
export async function createDocument(
  deps: DocumentDeps,
  scope: DocumentScope,
  input: CreateInput,
  request: Asking,
): Promise<CreateOutcome> {
  const { repo } = deps;
  const template = await repo.getTemplateRevision(
    scopeKey(scope),
    input.templateId,
    input.templateRevision,
  );
  if (!template) throw new DocumentNotFound();
  if (request.retryKey) {
    const prior = await repo.getGenerationRequest(
      scopeKey(scope),
      request.retryKey,
      request.bindingHash,
    );
    if (prior) {
      const saved = await repo.getDocument(
        scopeKey(scope),
        prior.documentId,
        prior.revision,
      );
      if (!saved) throw new DocumentNotFound();
      return {
        kind: "replayed",
        document: saved.document,
        revision: saved.revision,
      };
    }
  }
  // A document made by hand names no model, so there is none to authorise.
  if ("aiTargetId" in input)
    await authorizedTarget(deps, scope, input.aiTargetId);
  const candidate = await contextOf(deps, scope, input);
  const sourceDigest = sourcesOf(candidate);
  const hasBlocks = documentBlocks(template.fields).length > 0;
  const existing = await repo.findMatchingDocument(scopeKey(scope), input);
  if (existing) return { kind: "exists", existingDocumentId: existing.id };
  // Two saves of the same selection can race; the loser is pointed at the
  // document that won.
  const orExisting = async (error: unknown) => {
    if (error instanceof DocumentAlreadyExists) {
      await contextOf(deps, scope, input);
      const winner = await repo.findMatchingDocument(scopeKey(scope), input);
      if (winner) return { existingDocumentId: winner.id };
    }
    throw error;
  };
  if ("mode" in input) {
    // [DOMAIN] Made by hand: the same template and the same sources, and no
    // model call. The application, the interview and the facts the matrix
    // states outright are filled in; every field only prose can fill is left
    // blank for the person, so nothing is invented. Blank required fields
    // fail validation, which keeps the document at "invalid" (Needs
    // attention) until they are written.
    // The cast is decided in code alone here (no model is called): each
    // block's employer, title and dates are filled in for the person.
    const cast = hasBlocks
      ? planCast(template.fields, candidate.candidateProfile)
      : null;
    const { modelFields, fixed } = documentFieldOwnership({
      fields: template.fields,
      candidacyValues: candidate.candidacyValues,
      interviewValues: candidate.interviewValues,
      profileValues: {
        ...candidate.profileValues,
        ...(cast
          ? castValues(template.fields, cast, candidate.candidateProfile)
          : {}),
      },
      missingProfileKeys: candidate.missingProfileKeys,
    });
    const values = {
      ...fixed,
      ...Object.fromEntries(modelFields.map((field) => [field.key, ""])),
    };
    const { mode: _mode, ...selection } = input;
    const created = await repo
      .createDocument(scopeKey(scope), {
        ...selection,
        signal: request.signal,
        values,
        provenance: {
          kind: "manual",
          sourceDigest,
          // The fields a model may still be asked to write from the editor.
          modelOwnedKeys: modelFields.map((field) => field.key),
          claimState: "unverified",
          ...(cast ? { cast } : {}),
        },
      })
      .catch(orExisting);
    if ("existingDocumentId" in created)
      return { kind: "exists", existingDocumentId: created.existingDocumentId };
    return {
      kind: "created",
      created,
      errors: validateDocumentValues(template.fields, values),
    };
  }
  const requestIdentity = request.retryKey
    ? {
        key: request.retryKey,
        bindingHash: request.bindingHash,
        sourceDigest,
      }
    : undefined;
  if (requestIdentity)
    await repo.reserveGeneration(scopeKey(scope), requestIdentity);
  const completedBatches = requestIdentity
    ? await repo.getGenerationBatches(scopeKey(scope), requestIdentity)
    : undefined;
  const release = deps.writing.claim(
    JSON.stringify([
      scope.tenantId,
      scope.actorId,
      input.templateId,
      input.templateRevision,
      input.profileId,
      input.profileRevision,
      input.candidacyId,
      input.interviewId,
    ]),
  );
  if (!release) return { kind: "in-progress" };
  const { signal } = request;
  const generate = async (hooks?: GenerationHooks) => {
    // [STRATEGY] The cast comes first: which role fills which block. Code
    // decides it; a small ranking call is made only when the matrix cannot
    // (more clients than contract blocks). A ranking an earlier try of
    // this request kept is replayed, so its kept batches still fit.
    const keptRanking = completedBatches?.["cast"]?.values["order"];
    const cast = hasBlocks
      ? await decideCast(
          deps.engine,
          {
            ...scopeKey(scope),
            profileId: input.aiTargetId,
            request: executionFromHeaders(request.headers),
            fields: template.fields,
            matrix: candidate.candidateProfile,
            candidacyValues: candidate.candidacyValues,
            ...(keptRanking
              ? { kept: JSON.parse(keptRanking) as string[] }
              : {}),
            signal,
          },
          async (order) => {
            if (requestIdentity)
              await repo.saveGenerationBatch(scopeKey(scope), requestIdentity, {
                id: "cast",
                fieldsHash: "cast",
                values: { order: JSON.stringify(order) },
                usage: null,
              });
          },
        )
      : null;
    const facts = {
      ...candidate.profileValues,
      ...(cast
        ? castValues(template.fields, cast, candidate.candidateProfile)
        : {}),
    };
    const generated = await generateDocumentValues(
      deps.engine,
      {
        ...scopeKey(scope),
        profileId: input.aiTargetId,
        request: executionFromHeaders(request.headers),
        // No document exists yet: the call is for the application, or for
        // the template when the document is for no application.
        for: input.candidacyId
          ? { kind: "candidacy", id: input.candidacyId }
          : { kind: "document-template", id: input.templateId },
        cast,
        pack: await packFor(deps, scope, {
          candidacyId: input.candidacyId ?? null,
          profileId: input.profileId,
          profileRevision: input.profileRevision,
          matrix: candidate.candidateProfile,
          cast,
          signal,
        }),
        privateKeys: candidate.privateKeys,
        templateId: input.templateId,
        templateRevision: input.templateRevision,
        candidateProfileRevisionId: `${input.profileId}:${input.profileRevision}`,
        fields: template.fields,
        instructions: template.revision.instructions,
        candidateProfile: candidate.candidateProfile,
        candidacyValues: candidate.candidacyValues,
        interviewValues: candidate.interviewValues,
        profileValues: facts,
        missingProfileKeys: candidate.missingProfileKeys,
        generation: deps.config.generation,
        ...(completedBatches ? { completedBatches } : {}),
        signal,
      },
      {
        ...(hooks?.onPlan ? { onPlan: hooks.onPlan } : {}),
        onBatch: async (update) => {
          if (requestIdentity && !update.replayed)
            await repo.saveGenerationBatch(
              scopeKey(scope),
              requestIdentity,
              update,
            );
          await hooks?.onBatch?.(update);
        },
      },
    );
    return { ...generated, cast };
  };
  return {
    kind: "writing",
    release,
    async write(hooks) {
      const generated = await generate(hooks).catch(() => {
        throw signal.aborted ? new RequestCancelled() : new GenerationFailed();
      });
      if (signal.aborted) throw new RequestCancelled();
      // What the model wrote is checked against the matrix before it is
      // saved; a field that fails is recorded on the revision.
      const state = standing(
        { fields: template.fields, template: template.template },
        candidate,
        generated.values,
        {},
        { cast: generated.cast },
      );
      return repo
        .createDocument(scopeKey(scope), {
          ...input,
          signal,
          values: generated.values,
          provenance: {
            kind: "generated",
            targetId: input.aiTargetId,
            sourceDigest,
            modelOwnedKeys: state.modelOwnedKeys,
            claimState: "unverified",
            ...state.kept,
          },
          aiUsage: generated.usage,
          unsupported: state.unsupported,
          ...(requestIdentity ? { requestIdentity } : {}),
        })
        .catch(orExisting);
    },
  };
}
