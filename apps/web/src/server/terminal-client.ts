export interface CodexConceptSession {
  command: string;
  name: string;
}

export async function startCodexConceptSession(
  topic: string,
  options: {
    fetch?: typeof globalThis.fetch;
    token?: string;
    url?: string;
  } = {},
): Promise<CodexConceptSession> {
  const response = await (options.fetch ?? globalThis.fetch)(
    options.url ??
      process.env["TERMINAL_GATEWAY_HTTP_URL"] ??
      "http://127.0.0.1:3001/concept-sessions",
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
      body: JSON.stringify({ topic }),
      signal: AbortSignal.timeout(5_000),
    },
  );
  const body = (await response.json().catch(() => undefined)) as
    | CodexConceptSession
    | { error?: string }
    | undefined;
  if (!response.ok) {
    throw new Error(
      body && "error" in body && body.error
        ? body.error
        : `Terminal gateway failed with HTTP ${response.status}.`,
    );
  }
  return body as CodexConceptSession;
}
