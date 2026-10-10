// The context pack's calls (context-pack/routes.ts on the server): the review
// of one application's pack, its preparation by a model, and what the person
// corrects in it. Every answer is checked against the contract before the
// form sees it, so a review the form shows is one the contract describes.
import {
  type PackCorrection,
  type PackPrepareInput,
  type PackProgress,
  type PackReview,
  packProgressSchema,
  packReviewSchema,
} from "@omnitech/interview-contracts";
import {
  DocumentsApiError,
  documentJson,
  postJson,
  postStream,
} from "../documents/documents-client";

const of = (candidacyId: string) =>
  `/candidacies/${encodeURIComponent(candidacyId)}/context-pack`;

export type PackPrepareProgress = Extract<PackProgress, { t: "progress" }>;

export const packReviewClient = {
  read: async (candidacyId: string): Promise<PackReview> =>
    packReviewSchema.parse(await documentJson<unknown>(of(candidacyId))),

  // [DOMAIN] Preparing answers a line at a time: how far it is, then the
  // review or why it stopped. It is read with the documents client's own
  // stream reader, which also turns a refusal sent before the stream starts
  // (`{error:{code}}`) into a DocumentsApiError.
  prepare: async (
    candidacyId: string,
    input: PackPrepareInput,
    {
      signal,
      onProgress,
    }: {
      signal: AbortSignal;
      onProgress?: (progress: PackPrepareProgress) => void;
    },
  ): Promise<PackReview> => {
    const outcome: { review?: PackReview; refused?: string } = {};
    try {
      await postStream(`${of(candidacyId)}/prepare`, input, signal, (line) => {
        const event = packProgressSchema.parse(line);
        if (event.t === "progress") onProgress?.(event);
        else if (event.t === "done") outcome.review = event.review;
        else outcome.refused = event.code;
      });
    } catch (failure) {
      // [GUARD] The person stopping it ends the request here before the
      // server can say so; it is the same outcome as its `cancelled` line.
      if (signal.aborted) throw new DocumentsApiError("cancelled", null);
      throw failure;
    }
    if (outcome.refused !== undefined)
      throw new DocumentsApiError(outcome.refused, null);
    // [GUARD] A stream that ends with neither line was cut short.
    if (!outcome.review) throw new DocumentsApiError("server-error", null);
    return outcome.review;
  },

  correct: async (
    candidacyId: string,
    corrections: readonly PackCorrection[],
  ): Promise<PackReview> =>
    packReviewSchema.parse(
      await postJson<unknown>(`${of(candidacyId)}/corrections`, {
        corrections,
      }),
    ),
};
export type PackReviewClient = typeof packReviewClient;
