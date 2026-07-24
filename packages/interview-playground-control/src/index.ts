export type PlaygroundLanguage =
  | "auto"
  | "php"
  | "react"
  | "typescript"
  | "ruby";

export type PlaygroundAnswerLanguage = Exclude<PlaygroundLanguage, "auto">;
export type PlaygroundPanel = "terminal" | "notes" | "output" | "saved";

export interface PlaygroundAnswer {
  title: string;
  language: PlaygroundAnswerLanguage;
  answerMarkdown: string;
  code: string;
  usageCode: string;
  testCode: string;
}

export interface PlaygroundValue {
  question: string;
  language: PlaygroundLanguage;
  answer: PlaygroundAnswer | null;
  notes: string;
  panel: PlaygroundPanel;
}

export type PlaygroundPatch = Partial<PlaygroundValue>;

export interface PlaygroundSnapshot {
  revision: number;
  updatedAt: string;
  value: PlaygroundValue;
}

export interface PlaygroundControlClientOptions {
  apiPath?: string;
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
  timeoutMs?: number;
  token?: string;
}

export interface PlaygroundControlClient {
  get(): Promise<PlaygroundSnapshot>;
  reset(): Promise<PlaygroundSnapshot>;
  set(patch: PlaygroundPatch): Promise<PlaygroundSnapshot>;
}

export class PlaygroundControlError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "PlaygroundControlError";
  }
}

const languages = new Set<PlaygroundLanguage>([
  "auto",
  "php",
  "react",
  "typescript",
  "ruby",
]);
const answerLanguages = new Set<PlaygroundAnswerLanguage>([
  "php",
  "react",
  "typescript",
  "ruby",
]);
const panels = new Set<PlaygroundPanel>([
  "terminal",
  "notes",
  "output",
  "saved",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new TypeError(`Playground field "${key}" must be a string.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (value === undefined) return "";
  if (typeof value !== "string") {
    throw new TypeError(`Playground field "${key}" must be a string.`);
  }
  return value;
}

function parseAnswer(value: unknown): PlaygroundAnswer | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new TypeError('Playground field "answer" must be an object or null.');
  }

  const language = requireString(value, "language");
  if (!answerLanguages.has(language as PlaygroundAnswerLanguage)) {
    throw new TypeError(
      'Playground answer language must be "php", "react", "typescript", or "ruby".',
    );
  }

  return {
    title: requireString(value, "title"),
    language: language as PlaygroundAnswerLanguage,
    answerMarkdown: requireString(value, "answerMarkdown"),
    code: requireString(value, "code"),
    usageCode: optionalString(value, "usageCode"),
    testCode: requireString(value, "testCode"),
  };
}

/**
 * Validates untrusted CLI and HTTP input at the package boundary. Unknown
 * fields are rejected so misspelled control names cannot silently do nothing.
 */
export function parsePlaygroundPatch(input: unknown): PlaygroundPatch {
  if (!isRecord(input)) {
    throw new TypeError("Playground update must be a JSON object.");
  }

  const knownFields = new Set([
    "question",
    "language",
    "answer",
    "notes",
    "panel",
  ]);
  const unknownField = Object.keys(input).find((key) => !knownFields.has(key));
  if (unknownField) {
    throw new TypeError(`Unknown Playground field "${unknownField}".`);
  }

  const patch: PlaygroundPatch = {};
  if ("question" in input) patch.question = requireString(input, "question");
  if ("notes" in input) patch.notes = requireString(input, "notes");
  if ("answer" in input) patch.answer = parseAnswer(input["answer"]);

  if ("language" in input) {
    const language = requireString(input, "language");
    if (!languages.has(language as PlaygroundLanguage)) {
      throw new TypeError(`Unsupported Playground language "${language}".`);
    }
    patch.language = language as PlaygroundLanguage;
  }

  if ("panel" in input) {
    const panel = requireString(input, "panel");
    if (!panels.has(panel as PlaygroundPanel)) {
      throw new TypeError(`Unsupported Playground panel "${panel}".`);
    }
    patch.panel = panel as PlaygroundPanel;
  }

  return patch;
}

export function createPlaygroundControlClient(
  options: PlaygroundControlClientOptions,
): PlaygroundControlClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const apiPath = options.apiPath ?? "/api/v1/playground-control";
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function request(
    method: "GET" | "PATCH" | "DELETE",
    body?: unknown,
  ): Promise<PlaygroundSnapshot> {
    const response = await fetchImplementation(`${baseUrl}${apiPath}`, {
      method,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "content-type": "application/json",
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...options.headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const responseBody = (await response.json().catch(() => undefined)) as
      | PlaygroundSnapshot
      | { error?: { message?: string } }
      | undefined;

    if (!response.ok) {
      const message =
        responseBody && "error" in responseBody && responseBody.error?.message
          ? responseBody.error.message
          : `Playground control request failed with HTTP ${response.status}.`;
      throw new PlaygroundControlError(response.status, message, responseBody);
    }

    return responseBody as PlaygroundSnapshot;
  }

  return {
    get: () => request("GET"),
    set: (patch) => request("PATCH", parsePlaygroundPatch(patch)),
    reset: () => request("DELETE"),
  };
}
