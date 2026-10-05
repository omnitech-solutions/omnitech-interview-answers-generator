import type {
  ExplanationRequest,
  GeneratedAnswer,
  GeneratedExplanation,
  GenerateRequest,
  RouteRequest,
  RouteResult,
  RunRequest,
  RunResult,
  SaveAnswerRequest,
  SavedAnswer,
  SavedExplanation,
  SaveExplanationRequest,
} from "@omnitech/interview-contracts";

export type {
  BriefingArtifact,
  BriefingArtifactSummary,
  BriefingClient,
  BriefingClientOptions,
  BriefingProfileRevision,
  BriefingProfileSummary,
  SavedBriefingRevision,
} from "./briefing";
export { createBriefingClient } from "./briefing";
export {
  type BriefsClient,
  type BriefsClientOptions,
  createBriefsClient,
} from "./briefs";
export {
  createPlanClient,
  type PlanClient,
  type PlanClientOptions,
} from "./plan";
export {
  createRehearsalClient,
  type RehearsalClient,
} from "./rehearsal";

export interface InterviewApiClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  token?: string;
  // The tenant slug generation runs for; the server resolves the signed-in
  // member of that tenant.
  tenant?: string;
}

export class InterviewApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "InterviewApiError";
  }
}

export interface InterviewApiClient {
  deleteAnswer(id: string): Promise<void>;
  generate(input: GenerateRequest): Promise<GeneratedAnswer>;
  explain(input: ExplanationRequest): Promise<GeneratedExplanation>;
  getAnswer(id: string): Promise<SavedAnswer>;
  health(): Promise<{ ok: boolean; aiConfigured: boolean }>;
  listAnswers(): Promise<SavedAnswer[]>;
  listExplanations(): Promise<SavedExplanation[]>;
  route(input: RouteRequest): Promise<RouteResult>;
  run(input: RunRequest): Promise<RunResult>;
  saveAnswer(input: SaveAnswerRequest): Promise<SavedAnswer>;
  saveExplanation(input: SaveExplanationRequest): Promise<SavedExplanation>;
  deleteExplanation(id: string): Promise<void>;
}

export function createInterviewApiClient(
  options: InterviewApiClientOptions,
): InterviewApiClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImplementation(`${baseUrl}/api/v1${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.tenant ? { "x-omnitech-tenant": options.tenant } : {}),
        ...init.headers,
      },
    });
    const body = (await response.json().catch(() => undefined)) as unknown;

    if (!response.ok) {
      const message =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "object" &&
        body.error !== null &&
        "message" in body.error
          ? String(body.error.message)
          : `API request failed with HTTP ${response.status}.`;
      throw new InterviewApiError(response.status, message, body);
    }

    return body as T;
  }

  const post = <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) });

  return {
    health: () => request("/health"),
    route: (input) => post("/route", input),
    generate: (input) => post("/generate", input),
    explain: (input) => post("/explain", input),
    listAnswers: () => request("/answers"),
    listExplanations: () => request("/explanations"),
    getAnswer: (id) => request(`/answers/${encodeURIComponent(id)}`),
    saveAnswer: (input) => post("/answers", input),
    saveExplanation: (input) => post("/explanations", input),
    run: (input) => post("/run", input),
    async deleteAnswer(id) {
      await request(`/answers/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async deleteExplanation(id) {
      await request(`/explanations/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
  };
}

export type {
  ExplanationRequest,
  GeneratedAnswer,
  GeneratedExplanation,
  GenerateRequest,
  RouteRequest,
  RouteResult,
  RunRequest,
  RunResult,
  SaveAnswerRequest,
  SavedAnswer,
  SavedExplanation,
  SaveExplanationRequest,
} from "@omnitech/interview-contracts";
