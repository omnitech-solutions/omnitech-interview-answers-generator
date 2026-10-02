import {
  type InterviewPlanInput,
  type PlanItemInput,
  type PlanItemPatch,
  type PlanResponse,
  planResponseSchema,
} from "@omnitech/interview-contracts";

import { InterviewApiError } from "./index.js";

export interface PlanClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

// The interview being prepared for and its plan. Every call returns the whole
// plan as it now stands, so callers never reconcile partial updates.
export interface PlanClient {
  get(): Promise<PlanResponse>;
  saveInterview(
    input: InterviewPlanInput & { id?: string | null },
  ): Promise<PlanResponse>;
  addItem(input: PlanItemInput): Promise<PlanResponse>;
  updateItem(id: string, patch: PlanItemPatch): Promise<PlanResponse>;
  removeItem(id: string): Promise<PlanResponse>;
}

export function createPlanClient(options: PlanClientOptions): PlanClient {
  const base = `${options.baseUrl.replace(/\/$/, "")}/api/interview/plan`;
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  async function request(suffix: string, method = "GET", body?: unknown) {
    const response = await fetchImplementation(base + suffix, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await response.json().catch(() => undefined)) as unknown;
    if (!response.ok) {
      const code =
        typeof json === "object" && json !== null && "error" in json
          ? String((json.error as { code?: unknown }).code ?? "")
          : "";
      throw new InterviewApiError(
        response.status,
        code || `Plan request failed with HTTP ${response.status}.`,
        json,
      );
    }
    return planResponseSchema.parse(json);
  }
  return {
    get: () => request(""),
    saveInterview: (input) => request("/interview", "PUT", input),
    addItem: (input) => request("/items", "POST", input),
    updateItem: (id, patch) =>
      request(`/items/${encodeURIComponent(id)}`, "PATCH", patch),
    removeItem: (id) => request(`/items/${encodeURIComponent(id)}`, "DELETE"),
  };
}
