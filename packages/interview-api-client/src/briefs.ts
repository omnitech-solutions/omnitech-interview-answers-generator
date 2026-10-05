import {
  type Brief,
  type BriefRequest,
  type BriefSummary,
  briefListResponseSchema,
  briefSchema,
} from "@omnitech/interview-contracts";

import { InterviewApiError } from "./index";

export interface BriefsClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

// Spoken briefs on technical topics: build one, list them, read or delete.
export interface BriefsClient {
  list(): Promise<BriefSummary[]>;
  get(id: string): Promise<Brief>;
  build(input: BriefRequest): Promise<Brief>;
  remove(id: string): Promise<void>;
}

export function createBriefsClient(options: BriefsClientOptions): BriefsClient {
  const base = `${options.baseUrl.replace(/\/$/, "")}/api/interview/briefs`;
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
        code || `Brief request failed with HTTP ${response.status}.`,
        json,
      );
    }
    return json;
  }
  return {
    list: async () => briefListResponseSchema.parse(await request("")).briefs,
    get: async (id) =>
      briefSchema.parse(await request(`/${encodeURIComponent(id)}`)),
    build: async (input) => briefSchema.parse(await request("", "POST", input)),
    remove: async (id) => {
      await request(`/${encodeURIComponent(id)}`, "DELETE");
    },
  };
}
