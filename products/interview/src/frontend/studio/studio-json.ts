import { studioFetch } from "./studio-fetch";

export class StudioRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly payload: unknown,
  ) {
    super(code);
    this.name = "StudioRequestError";
  }
}

export async function studioJson<T>(
  path: string,
  request: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const response = await studioFetch(path, {
    ...(request.method === undefined ? {} : { method: request.method }),
    ...(request.body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request.body),
        }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  });
  // Read once; malformed successful JSON remains a failure, while an HTML
  // proxy error still carries its HTTP status through StudioRequestError.
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (request.signal?.aborted || (response.ok && response.status !== 204))
      throw error;
    payload = null;
  }
  if (!response.ok) {
    const error =
      payload !== null && typeof payload === "object" && "error" in payload
        ? payload.error
        : undefined;
    const nestedCode =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : undefined;
    const code =
      nestedCode ??
      (payload !== null &&
      typeof payload === "object" &&
      "code" in payload &&
      typeof payload.code === "string"
        ? payload.code
        : response.status >= 500
          ? "server-error"
          : "request-failed");
    throw new StudioRequestError(response.status, code, payload);
  }
  // DELETE and other no-content operations have no JSON to decode.
  if (response.status === 204) return undefined as T;
  return payload as T;
}
