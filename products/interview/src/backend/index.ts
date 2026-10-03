export {
  createApi as createInterviewApi,
  type InterviewApiOptions,
} from "./api.js";
export {
  createInterviewAdapter,
  type InterviewAdapterOptions,
  interviewPatchJsonSchema,
  interviewProposalPatchSchema,
} from "./assistant/adapter.js";
export {
  interviewAdapterVersion,
  interviewPrompt,
  interviewRunVersions,
} from "./assistant/prompt.js";
export {
  type AnswerRevisionRecord,
  type InterviewDraft,
  type InterviewEvidence,
  InterviewWorkspaceRepository,
  interviewDraftPatchSchema,
  interviewDraftSchema,
  type WorkspaceDraftRecord,
  WorkspaceError,
  type WorkspaceOrigin,
  type WorkspaceScope,
} from "./assistant/workspace.js";

export { briefingScope } from "./briefing-access.js";
export { createBriefingApi } from "./briefing/api.js";
export { createBriefsApi } from "./briefs/api.js";
export { createPlanApi } from "./plan/api.js";
export { createRehearsalApi, rehearsalStatus } from "./rehearsal/api.js";

export { loadLocalDefaultProfile } from "./local-default-profile.js";
export {
  INTERVIEW_ANSWER_PROFILE,
  INTERVIEW_ASSISTANT_PROFILE,
  INTERVIEW_PRODUCT_ID,
} from "../assistant-profile.js";
export {
  createInterviewBackend,
  type InterviewBackendServices,
} from "./interview-backend.js";
export {
  createInterviewStudio,
  type InterviewStudioOptions,
} from "./studio/host.js";
