import {
  type BriefingApply,
  type BriefingArtifactListResponse,
  type BriefingArtifactResponse,
  type BriefingAsk,
  type BriefingPrepare,
  type BriefingProfileImport,
  type BriefingProfileImportResponse,
  type BriefingProfileListResponse,
  type BriefingProfileRevisionResponse,
  type BriefingProposalRequest,
  type BriefingProposalResponse,
  type BriefingPut,
  type BriefingSave,
  type BriefingSavedResponse,
  briefingApplySchema,
  briefingArtifactListResponseSchema,
  briefingArtifactResponseSchema,
  briefingAskSchema,
  briefingPrepareSchema,
  briefingProfileImportResponseSchema,
  briefingProfileImportSchema,
  briefingProfileListResponseSchema,
  briefingProfileRevisionResponseSchema,
  briefingProposalRequestSchema,
  briefingProposalResponseSchema,
  briefingPutSchema,
  briefingSavedResponseSchema,
  briefingSaveSchema,
  type BriefingArtifactSummary as ContractArtifactSummary,
  type BriefingProfileSummary as ContractProfileSummary,
} from "@omnitech/interview-contracts";

import { InterviewApiError } from "./index";

export interface BriefingClientOptions {
  baseUrl: string;
  tenant?: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
}

export type BriefingProfileSummary = ContractProfileSummary;
export type BriefingProfileRevision = BriefingProfileRevisionResponse;
export type BriefingArtifactSummary = ContractArtifactSummary;
export type BriefingArtifact = BriefingArtifactResponse;
export type SavedBriefingRevision = BriefingSavedResponse;

export interface BriefingClient {
  listProfiles(): Promise<BriefingProfileListResponse>;
  importProfile(
    input: BriefingProfileImport,
  ): Promise<BriefingProfileImportResponse>;
  getProfile(id: string, revision: number): Promise<BriefingProfileRevision>;
  listArtifacts(): Promise<BriefingArtifactListResponse>;
  getArtifact(id: string): Promise<BriefingArtifact>;
  editArtifact(id: string, input: BriefingPut): Promise<BriefingArtifact>;
  propose(
    id: string,
    input: BriefingProposalRequest,
  ): Promise<BriefingProposalResponse>;
  apply(id: string, input: BriefingApply): Promise<BriefingArtifact>;
  // Answer one question from the pack's matrix and material, adding it.
  ask(id: string, input: BriefingAsk): Promise<BriefingArtifact>;
  // Prepare or refresh the pack's full briefing sections.
  prepare(id: string, input: BriefingPrepare): Promise<BriefingArtifact>;
  save(id: string, input: BriefingSave): Promise<SavedBriefingRevision>;
}

export function createBriefingClient(
  options: BriefingClientOptions,
): BriefingClient {
  const base = options.baseUrl.replace(/\/$/, "");
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const path = (suffix: string) =>
    `${base}/api/interview/briefing${suffix}${options.tenant === undefined ? "" : `?tenant=${encodeURIComponent(options.tenant)}`}`;
  const artifactPath = (id: string) => `/artifacts/${encodeURIComponent(id)}`;

  async function request<T>(
    suffix: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await fetchImplementation(path(suffix), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...init.headers,
      },
    });
    const body = (await response.json().catch(() => undefined)) as unknown;
    if (!response.ok) {
      const error =
        typeof body === "object" && body !== null && "error" in body
          ? body.error
          : undefined;
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String(error.message)
          : `API request failed with HTTP ${response.status}.`;
      throw new InterviewApiError(response.status, message, body);
    }
    return body as T;
  }
  const write = <T>(suffix: string, method: "POST" | "PUT", body: unknown) =>
    request<T>(suffix, { method, body: JSON.stringify(body) });

  return {
    listProfiles: async () =>
      briefingProfileListResponseSchema.parse(await request("/profiles")),
    importProfile: async (input) =>
      briefingProfileImportResponseSchema.parse(
        await write(
          "/profiles",
          "POST",
          briefingProfileImportSchema.parse(input),
        ),
      ),
    getProfile: (id, revision) => {
      if (!Number.isSafeInteger(revision) || revision < 0) {
        throw new Error("Revision must be a non-negative integer.");
      }
      return request(
        `/profiles/${encodeURIComponent(id)}/revisions/${revision}`,
      ).then((body) => briefingProfileRevisionResponseSchema.parse(body));
    },
    listArtifacts: async () =>
      briefingArtifactListResponseSchema.parse(await request("/artifacts")),
    getArtifact: async (id) =>
      briefingArtifactResponseSchema.parse(await request(artifactPath(id))),
    editArtifact: async (id, input) =>
      briefingArtifactResponseSchema.parse(
        await write(artifactPath(id), "PUT", briefingPutSchema.parse(input)),
      ),
    propose: async (id, input) =>
      briefingProposalResponseSchema.parse(
        await write(
          artifactPath(id) + "/proposals",
          "POST",
          briefingProposalRequestSchema.parse(input),
        ),
      ),
    ask: async (id, input) =>
      briefingArtifactResponseSchema.parse(
        await write(
          artifactPath(id) + "/ask",
          "POST",
          briefingAskSchema.parse(input),
        ),
      ),
    prepare: async (id, input) =>
      briefingArtifactResponseSchema.parse(
        await write(
          artifactPath(id) + "/prepare",
          "POST",
          briefingPrepareSchema.parse(input),
        ),
      ),
    apply: async (id, input) =>
      briefingArtifactResponseSchema.parse(
        await write(
          artifactPath(id) + "/apply",
          "POST",
          briefingApplySchema.parse(input),
        ),
      ),
    save: async (id, input) =>
      briefingSavedResponseSchema.parse(
        await write(
          artifactPath(id) + "/save",
          "POST",
          briefingSaveSchema.parse(input),
        ),
      ),
  };
}
