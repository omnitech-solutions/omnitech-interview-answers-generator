// The rules of a stored document artifact, as pure functions: what may be
// stored, and the identity of a tenant's built-in template source. No I/O;
// the repository beside this file persists what these admit.
import { createHash } from "node:crypto";

export const MAX_DOCUMENT_ARTIFACT_BYTES = 10 * 1024 * 1024;

// The one product whose documents this repository stores.
export const DOCUMENT_PRODUCT_ID = "omnitech.interview";
export const BUILT_IN_TEMPLATE_TYPE = "interview.document-template-builtin";

// The types a member may create; the built-in type is provisioned, never
// created by a member.
const MEMBER_ARTIFACT_TYPES = [
  "interview.document-template-source",
  "interview.document-export",
] as const;

export type DocumentArtifactType = (typeof MEMBER_ARTIFACT_TYPES)[number];

export interface CreateDocumentArtifact {
  tenantId: string;
  actorId: string;
  artifactType: DocumentArtifactType;
  title: string;
  bytes: Uint8Array;
  metadata?: Record<string, unknown>;
}

export interface ReadDocumentArtifact {
  tenantId: string;
  actorId: string;
  artifactId: string;
  expectedType: DocumentArtifactType | typeof BUILT_IN_TEMPLATE_TYPE;
}

export interface ProvisionBuiltInTemplateSource {
  tenantId: string;
  key: string;
  title: string;
  bytes: Uint8Array;
  metadata?: Record<string, unknown>;
}

const BUILT_IN_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const sizeIsStorable = (bytes: Uint8Array) =>
  bytes.byteLength > 0 && bytes.byteLength <= MAX_DOCUMENT_ARTIFACT_BYTES;

// [GUARD] Refuses a member's artifact before any row is written. The type is
// checked at run time because the value arrives from a request.
export function assertCreatable(input: CreateDocumentArtifact): void {
  if (
    !(MEMBER_ARTIFACT_TYPES as readonly string[]).includes(input.artifactType)
  )
    throw new Error("Unsupported document artifact type.");
  if (input.bytes.byteLength > MAX_DOCUMENT_ARTIFACT_BYTES)
    throw new Error("Document artifact exceeds the 10 MiB size limit.");
  if (input.bytes.byteLength === 0)
    throw new Error("Document artifact cannot be empty.");
  if (!input.title.trim()) throw new Error("Document artifact needs a title.");
}

// [GUARD] The standalone provisioning path names which rule a source broke.
export function assertBuiltInProvisionable(
  input: ProvisionBuiltInTemplateSource,
): void {
  if (!BUILT_IN_KEY.test(input.key))
    throw new Error("Built-in template key is invalid.");
  if (!input.title.trim()) throw new Error("Built-in template needs a title.");
  if (!sizeIsStorable(input.bytes))
    throw new Error("Built-in template source size is invalid.");
}

// [GUARD] The same rules for the path that runs inside a caller's
// transaction, which has always answered with one message for all of them.
export function assertBuiltInProvisionableInTransaction(
  input: ProvisionBuiltInTemplateSource,
): void {
  if (
    !BUILT_IN_KEY.test(input.key) ||
    !input.title.trim() ||
    !sizeIsStorable(input.bytes)
  )
    throw new Error("Built-in template source is invalid.");
}

// A built-in source has one id per tenant and key, so provisioning it twice
// names the same row: the idempotency key of the catalog.
export function builtInId(tenantId: string, key: string): string {
  const digest = createHash("sha256")
    .update(`omnitech.interview/document-template-builtin/${tenantId}/${key}`)
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export const payloadReference = (artifactId: string) =>
  `platform.artifact_payloads/${artifactId}`;

export const builtInMetadata = (input: ProvisionBuiltInTemplateSource) => ({
  ...input.metadata,
  builtInKey: input.key,
});
