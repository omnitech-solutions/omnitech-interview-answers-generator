import {
  type RehearsalSession,
  type RehearsalSessionInput,
  rehearsalListResponseSchema,
  rehearsalSessionSchema,
} from "@omnitech/interview-contracts";

import { InterviewApiError } from "./index";

// Scored rehearsals: save a finished one, list the recent ones.
export interface RehearsalClient {
  list(): Promise<RehearsalSession[]>;
  save(input: RehearsalSessionInput): Promise<RehearsalSession>;
}

export function createRehearsalClient(options: {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}): RehearsalClient {
  const url = `${options.baseUrl.replace(/\/$/, "")}/api/interview/rehearsals`;
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  async function request(method: string, body?: unknown) {
    const response = await fetchImplementation(url, {
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
        code || `Rehearsal request failed with HTTP ${response.status}.`,
        json,
      );
    }
    return json;
  }
  return {
    list: async () =>
      rehearsalListResponseSchema.parse(await request("GET")).sessions,
    save: async (input) =>
      rehearsalSessionSchema.parse(await request("POST", input)),
  };
}
