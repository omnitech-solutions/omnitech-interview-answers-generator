export interface CodexConceptSession {
  command: string;
  name: string;
}

export interface CodexAnswerSession {
  command: string;
  name: string;
}

async function startCodexSession<T>(
  path: "/answer-sessions" | "/concept-sessions",
  body: Record<string, unknown>,
  options: {
    fetch?: typeof globalThis.fetch;
    token?: string;
    url?: string;
  },
): Promise<T> {
  const configuredGatewayUrl = process.env["TERMINAL_GATEWAY_HTTP_URL"];
  const gatewayBaseUrl = configuredGatewayUrl
    ? configuredGatewayUrl.replace(/\/(?:answer|concept)-sessions$/, "")
    : "http://127.0.0.1:3001";
  const response = await (options.fetch ?? globalThis.fetch)(
    options.url ?? `${gatewayBaseUrl}${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.token
          ? { authorization: `Bearer ${options.token}` }
          : process.env["TERMINAL_GATEWAY_TOKEN"]
            ? {
                authorization: `Bearer ${process.env["TERMINAL_GATEWAY_TOKEN"]}`,
              }
            : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    },
  );
  const responseBody = (await response.json().catch(() => undefined)) as
    | T
    | { error?: string }
    | undefined;
  if (!response.ok) {
    throw new Error(
      responseBody &&
        typeof responseBody === "object" &&
        "error" in responseBody &&
        responseBody.error
        ? responseBody.error
        : `Terminal gateway failed with HTTP ${response.status}.`,
    );
  }
  return responseBody as T;
}

export function startCodexAnswerSession(
  question: string,
  options: {
    currentAnswer?: Record<string, unknown>;
    fetch?: typeof globalThis.fetch;
    refinement?: string;
    token?: string;
    url?: string;
  } = {},
): Promise<CodexAnswerSession> {
  return startCodexSession(
    "/answer-sessions",
    {
      question,
      ...(options.refinement === undefined
        ? {}
        : { refinement: options.refinement }),
      ...(options.currentAnswer === undefined
        ? {}
        : { currentAnswer: options.currentAnswer }),
    },
    options,
  );
}

export async function startCodexConceptSession(
  topic: string,
  options: {
    fetch?: typeof globalThis.fetch;
    token?: string;
    url?: string;
  } = {},
): Promise<CodexConceptSession> {
  return startCodexSession("/concept-sessions", { topic }, options);
}
