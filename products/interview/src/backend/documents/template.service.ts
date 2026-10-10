import { readFile } from "node:fs/promises";
import {
  type DocumentField,
  type DocumentFormat,
  type DocumentTemplateKind,
  type DocumentValues,
  documentFieldsSchema,
  withFieldGroups,
} from "@omnitech/interview-contracts";
import type { DocumentArtifactRepository } from "@omnitech/platform-storage";
import { builtInAssetUrl } from "./built-in-assets";
import { type BuiltInKey, builtInTemplates } from "./built-in-templates";
import type { DocumentsConfig } from "./config";
import {
  type DocumentScope,
  InvalidField,
  previewOf,
  templateSource,
} from "./document.service";
import {
  DocumentNotFound,
  DocumentRevisionConflict,
  type InterviewDocumentRepository,
} from "./repository";
import { inspectTemplate } from "./template-intake";

// The template use cases: what a template file's fields are, the built-in
// catalogue, and a member's own templates and their revisions. No HTTP and
// no SQL here.

export type TemplateDeps = {
  repo: InterviewDocumentRepository;
  artifacts: DocumentArtifactRepository;
  config: DocumentsConfig;
  // Local development: the author's own template files, for the local member.
  localTemplates?:
    | ((
        scope: DocumentScope,
      ) => Promise<Partial<Record<BuiltInKey, Buffer>> | null>)
    | undefined;
  // Tenants whose built-in catalogue is in place, or being put in place.
  builtInReady: Map<string, Promise<void>>;
};

const scopeKey = (scope: DocumentScope) => ({
  tenantId: scope.tenantId,
  actorId: scope.actorId,
});

const candidacyKeys = new Set([
  "company_name",
  "role_title",
  "target_role",
  "job_description",
]);
const interviewKeys = new Set(["interview_stage", "interview_kind"]);

// [DOMAIN] Who states a field, from its key: the application, the interview,
// or the person's experience.
function fieldSource(key: string): DocumentField["source"] {
  return candidacyKeys.has(key)
    ? "candidacy"
    : interviewKeys.has(key)
      ? "interview"
      : "candidate-profile";
}
// "experience_1_bullet_2" reads as "Experience 1 bullet 2".
const humanize = (key: string) => {
  const words = key.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
// The third and later of a numbered series (bullet 3, contract 4) are extras
// a candidate may not have, so a blank one is not a problem.
const laterItem = (key: string) => Number(/_(\d+)$/.exec(key)?.[1] ?? 0) >= 3;

/**
 * A template file's field contract: the placeholders found in the file, as
 * the member reviewed them (`reviewed`, JSON) or with defaults. The reviewed
 * list must name exactly the file's placeholders, in order, and may not move
 * a field to another source (a profile field may be marked typed by hand).
 */
export function fieldsFor(
  keys: readonly string[],
  reviewed: FormDataEntryValue | null,
  sections: Record<string, string> = {},
): DocumentField[] {
  const defaults = keys.map((key) => ({
    key,
    label: humanize(key),
    source: fieldSource(key),
    required: true,
    maxLength: null,
    ...(sections[key] ? { section: sections[key] } : {}),
  }));
  // A field's block is made explicit here, from its key, so a template
  // revision states which fields are one employer's.
  const fields = withFieldGroups(
    documentFieldsSchema.parse(
      typeof reviewed === "string" ? JSON.parse(reviewed) : defaults,
    ),
  );
  if (
    fields.length !== keys.length ||
    fields.some(
      (field, i) =>
        field.key !== keys[i] ||
        (field.source !== fieldSource(field.key) &&
          !(
            fieldSource(field.key) === "candidate-profile" &&
            field.source === "manual"
          )),
    )
  )
    throw new InvalidField();
  return fields;
}

/** The fields a template file would have, before it is saved. */
export async function inspectedFields(
  format: DocumentFormat,
  bytes: Buffer,
  reviewed: FormDataEntryValue | null = null,
): Promise<DocumentField[]> {
  const inspection = await inspectTemplate({ format, bytes });
  return fieldsFor(inspection.fields, reviewed, inspection.sections);
}

/** The tenant's built-in templates, provisioned once per process. */
export async function provisionBuiltIns(
  deps: TemplateDeps,
  scope: DocumentScope,
): Promise<void> {
  let pending = deps.builtInReady.get(scope.tenantId);
  if (!pending) {
    pending = (async () => {
      const local = (await deps.localTemplates?.(scope)) ?? {};
      for (const template of builtInTemplates(deps.config.brevity)) {
        const bytes =
          local[template.key] ??
          (await readFile(builtInAssetUrl(template.key)));
        await deps.repo.provisionBuiltInTemplate(scopeKey(scope), {
          key: template.key,
          name: template.name,
          kind: template.kind,
          format: template.format,
          sourceBytes: bytes,
          fields: (await inspectedFields(template.format, bytes)).map(
            (field) => ({ ...field, required: !laterItem(field.key) }),
          ),
          instructions: template.instructions,
        });
      }
    })().catch((error: unknown) => {
      deps.builtInReady.delete(scope.tenantId);
      throw error;
    });
    deps.builtInReady.set(scope.tenantId, pending);
  }
  await pending;
}

export async function listTemplates(deps: TemplateDeps, scope: DocumentScope) {
  await provisionBuiltIns(deps, scope);
  return deps.repo.listTemplates(scopeKey(scope));
}

/** A template revision any member of the tenant may read. */
export async function readTemplate(
  deps: TemplateDeps,
  scope: DocumentScope,
  templateId: string,
  revision?: number,
) {
  const item = await deps.repo.getTemplateRevision(
    scopeKey(scope),
    templateId,
    revision,
  );
  if (!item) throw new DocumentNotFound();
  return item;
}

/** The latest revision of a template the member owns: only they revise it. */
export async function readOwnTemplate(
  deps: TemplateDeps,
  scope: DocumentScope,
  templateId: string,
) {
  const existing = await deps.repo.getTemplateRevision(
    scopeKey(scope),
    templateId,
  );
  if (!existing || existing.template.ownerUserId !== scope.actorId)
    throw new DocumentNotFound();
  return existing;
}
type OwnTemplate = Awaited<ReturnType<typeof readOwnTemplate>>;

export async function createTemplate(
  deps: TemplateDeps,
  scope: DocumentScope,
  input: {
    name: string;
    kind: DocumentTemplateKind;
    format: DocumentFormat;
    instructions: string;
    bytes: Buffer;
    reviewed: FormDataEntryValue | null;
  },
) {
  const { bytes, reviewed, ...metadata } = input;
  return deps.repo.createTemplate(scopeKey(scope), {
    ...metadata,
    fields: await inspectedFields(metadata.format, bytes, reviewed),
    sourceBytes: bytes,
  });
}

/** A new file for a template: its next revision, on the one it was read at. */
export async function reviseTemplate(
  deps: TemplateDeps,
  scope: DocumentScope,
  existing: OwnTemplate,
  input: {
    expectedRevision: number;
    instructions: string;
    bytes: Buffer;
    reviewed: FormDataEntryValue | null;
  },
) {
  if (input.expectedRevision !== existing.revision.revision)
    throw new DocumentRevisionConflict();
  return deps.repo.addTemplateRevision(scopeKey(scope), {
    templateId: existing.template.id,
    expectedRevision: input.expectedRevision,
    instructions: input.instructions,
    fields: await inspectedFields(
      existing.template.format as DocumentFormat,
      input.bytes,
      input.reviewed,
    ),
    sourceBytes: input.bytes,
  });
}

// Instructions are part of a template revision, so editing them mints a new
// revision over the same source file and field contract.
export async function reviseInstructions(
  deps: TemplateDeps,
  scope: DocumentScope,
  existing: OwnTemplate,
  input: { expectedRevision: number; instructions: string },
) {
  if (input.expectedRevision !== existing.revision.revision)
    throw new DocumentRevisionConflict();
  return deps.repo.addTemplateRevision(scopeKey(scope), {
    templateId: existing.template.id,
    expectedRevision: input.expectedRevision,
    instructions: input.instructions,
    fields: existing.fields,
    sourceBytes: await templateSource(deps, scope, existing),
  });
}

export async function duplicateTemplate(
  deps: TemplateDeps,
  scope: DocumentScope,
  original: Awaited<ReturnType<typeof readTemplate>>,
  name: string,
) {
  return deps.repo.duplicateTemplate(scopeKey(scope), {
    sourceTemplateId: original.template.id,
    name,
    sourceBytes: await templateSource(deps, scope, original),
  });
}

// What a template looks like with some values in it: a document being
// written is drawn before it is saved.
export async function previewTemplate(
  deps: TemplateDeps,
  scope: DocumentScope,
  templateId: string,
  input: { revision: number; values: DocumentValues },
) {
  const item = await readTemplate(deps, scope, templateId, input.revision);
  return previewOf(
    item.template.format,
    await templateSource(deps, scope, item),
    input.values,
  );
}
