// The interview brief's calls (brief/routes.ts on the server): one
// application's stages, transcripts, employer-said entries and research.
// Every write answers with the brief as it now is, so the form never guesses.
import type {
  EmployerSaidInput,
  InterviewBrief,
  ResearchDocumentDetail,
  StageRecording,
  StageTranscript,
  StageTranscriptDetail,
  StageUpdate,
  TranscriptPolicy,
} from "@omnitech/interview-contracts";
import { documentJson, postJson } from "../documents/documents-client";

const of = (candidacyId: string) =>
  `/candidacies/${encodeURIComponent(candidacyId)}`;
const send = <T>(method: string, path: string, body?: unknown) =>
  documentJson<T>(path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
const fileForm = (file: File, fields: Record<string, string | undefined>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields))
    if (value) form.set(key, value);
  form.set("file", file);
  return form;
};

export const interviewBriefClient = {
  read: (candidacyId: string) =>
    documentJson<InterviewBrief>(`${of(candidacyId)}/interview-brief`),

  addStage: (candidacyId: string, input: { kind: string; label: string }) =>
    postJson<InterviewBrief>(`${of(candidacyId)}/stages`, input),
  updateStage: (candidacyId: string, stageId: string, input: StageUpdate) =>
    send<InterviewBrief>(
      "PATCH",
      `${of(candidacyId)}/stages/${stageId}`,
      input,
    ),
  removeStage: (candidacyId: string, stageId: string) =>
    send<InterviewBrief>("DELETE", `${of(candidacyId)}/stages/${stageId}`),
  orderStages: (candidacyId: string, order: readonly string[]) =>
    send<InterviewBrief>("PUT", `${of(candidacyId)}/stages/order`, { order }),
  moveNotes: (candidacyId: string) =>
    postJson<InterviewBrief>(`${of(candidacyId)}/notes/move`, {}),

  pasteTranscript: (
    candidacyId: string,
    stageId: string,
    input: { title?: string; text: string; capturePolicy: TranscriptPolicy },
  ) =>
    postJson<{ transcript: StageTranscript }>(
      `${of(candidacyId)}/stages/${stageId}/transcripts`,
      input,
    ),
  uploadTranscript: (
    candidacyId: string,
    stageId: string,
    file: File,
    capturePolicy: TranscriptPolicy,
  ) =>
    documentJson<{ transcript: StageTranscript }>(
      `${of(candidacyId)}/stages/${stageId}/transcripts/upload`,
      { method: "POST", body: fileForm(file, { capturePolicy }) },
    ),
  recordings: (candidacyId: string) =>
    documentJson<{ recordings: StageRecording[] }>(
      `${of(candidacyId)}/recordings`,
    ),
  attachRecording: (candidacyId: string, stageId: string, file: string) =>
    postJson<{ transcript: StageTranscript }>(
      `${of(candidacyId)}/stages/${stageId}/transcripts/recordings`,
      { file },
    ),
  readTranscript: (candidacyId: string, stageId: string, id: string) =>
    documentJson<{ transcript: StageTranscriptDetail }>(
      `${of(candidacyId)}/stages/${stageId}/transcripts/${id}`,
    ),
  setTranscriptPolicy: (
    candidacyId: string,
    stageId: string,
    id: string,
    capturePolicy: TranscriptPolicy,
  ) =>
    send<{ transcript: StageTranscript }>(
      "PATCH",
      `${of(candidacyId)}/stages/${stageId}/transcripts/${id}`,
      { capturePolicy },
    ),
  removeTranscript: (candidacyId: string, stageId: string, id: string) =>
    send<InterviewBrief>(
      "DELETE",
      `${of(candidacyId)}/stages/${stageId}/transcripts/${id}`,
    ),

  addEmployerSaid: (candidacyId: string, input: EmployerSaidInput) =>
    postJson<InterviewBrief>(`${of(candidacyId)}/employer-said`, input),
  removeEmployerSaid: (candidacyId: string, id: string) =>
    send<InterviewBrief>("DELETE", `${of(candidacyId)}/employer-said/${id}`),

  addResearch: (
    candidacyId: string,
    input: { title: string; text: string; originRef?: string },
  ) => postJson<InterviewBrief>(`${of(candidacyId)}/research`, input),
  uploadResearch: (candidacyId: string, file: File) =>
    documentJson<InterviewBrief>(`${of(candidacyId)}/research/upload`, {
      method: "POST",
      body: fileForm(file, {}),
    }),
  readResearch: (candidacyId: string, id: string) =>
    documentJson<{ document: ResearchDocumentDetail }>(
      `${of(candidacyId)}/research/${encodeURIComponent(id)}`,
    ),
  keepCarriedResearch: (candidacyId: string) =>
    postJson<InterviewBrief>(`${of(candidacyId)}/research/keep-carried`, {}),
  removeResearch: (candidacyId: string, id: string) =>
    send<InterviewBrief>("DELETE", `${of(candidacyId)}/research/${id}`),
};
export type InterviewBriefClient = typeof interviewBriefClient;
