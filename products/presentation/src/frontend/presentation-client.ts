import type { ProfileSummary } from "@omnitech/ai-engine";
import type {
  CreatePresentationInput,
  GeneratedImage,
  PresentationDocument,
  PresentationRecording,
  PresentationShare,
  PresentationSummary,
  PresentationTheme,
  SavePresentationInput,
  Slide,
} from "../domain/index";

type Created = { id: string };
type Revised = { revision: number };
type OnError = (reason: unknown) => void;
type OnData<T> = (value: T) => void;

export interface OutlineInput {
  prompt: string;
  profileId: string;
  slideCount: number;
  language: string;
  layout: string;
  textContent: string;
  tone: string;
  audience: string;
  scenario: string;
}

export interface SlideGenerationInput {
  prompt: string;
  profileId: string;
  position: number;
}

export interface ThemeInput {
  name: string;
  description: string;
  definition: Readonly<Record<string, unknown>>;
}

export interface ThemeImportInput {
  name: string;
  fileBase64: string;
  sourceImportId: string;
}

export interface ImageGenerationInput {
  prompt: string;
  profileId: string;
  aspectRatio: string;
  modelId?: string;
}

export interface ImageUploadInput {
  assetReference: string;
  mimeType: string;
}

export interface RecordingInput {
  assetReference: string;
  metadata: Readonly<Record<string, unknown>>;
}

export interface AgentInput {
  productId: string;
  profileId: string;
  prompt: string;
}

export interface AgentEvent {
  sequence: number;
  event: {
    type: string;
    text?: string;
    result?: { output?: unknown };
    error?: { message?: string };
  };
}

async function json<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let body: (T & { error?: string }) | undefined;
  try {
    body = JSON.parse(raw) as T & { error?: string };
  } catch {
    throw new Error(
      response.ok
        ? "The server returned an invalid response."
        : `Request failed (${response.status}).`,
    );
  }
  if (!response.ok) throw new Error(body.error ?? "Request failed.");
  return body;
}

/**
 * Loads a resource for an effect and returns the effect's cleanup. A cleaned-up
 * effect aborts its request and drops its result, so React StrictMode's dev
 * re-run (or a changed dependency) never leaves two live requests or a stale
 * state update.
 */
function load<T>(
  url: string,
  onData: OnData<T>,
  onError: OnError = () => undefined,
): () => void {
  const controller = new AbortController();
  const current = () => !controller.signal.aborted;
  void fetch(url, { signal: controller.signal })
    .then(json<T>)
    .then((value) => {
      if (current()) onData(value);
    })
    .catch((reason: unknown) => {
      if (current()) onError(reason);
    });
  return () => controller.abort();
}

async function ok(response: Response): Promise<void> {
  if (response.ok) return;
  const raw = await response.text();
  try {
    const body = JSON.parse(raw) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status}).`);
  } catch (reason) {
    if (
      reason instanceof Error &&
      reason.message !== "Unexpected end of JSON input"
    ) {
      throw reason;
    }
    throw new Error(`Request failed (${response.status}).`);
  }
}

function request<T>(url: string, init?: RequestInit): Promise<T> {
  return fetch(url, init).then(json<T>);
}

function mutation(url: string, init: RequestInit): Promise<void> {
  return fetch(url, init).then(ok);
}

function body(method: string, input: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  };
}

/** The tenant stays attached to every private presentation and platform request. */
export function createPresentationClient(tenantSlug: string) {
  const tenant = encodeURIComponent(tenantSlug);
  const api = (path: string) => `/api/presentation/v1${path}?tenant=${tenant}`;
  const platform = (path: string) => `/api/platform/v1${path}?tenant=${tenant}`;
  return {
    loadDocuments: (onData: OnData<PresentationSummary[]>, onError?: OnError) =>
      load(api("/documents"), onData, onError),
    loadDocument: (
      id: string,
      onData: OnData<PresentationDocument>,
      onError?: OnError,
    ) => load(api(`/documents/${id}`), onData, onError),
    loadAiTargets: (onData: OnData<ProfileSummary[]>, onError?: OnError) =>
      load(platform("/ai-targets"), onData, onError),
    loadThemes: (onData: OnData<PresentationTheme[]>, onError?: OnError) =>
      load(api("/themes"), onData, onError),
    loadImages: (onData: OnData<GeneratedImage[]>, onError?: OnError) =>
      load(api("/images"), onData, onError),
    loadRecordings: (
      id: string,
      onData: OnData<PresentationRecording[]>,
      onError?: OnError,
    ) => load(api(`/documents/${id}/recordings`), onData, onError),
    getDocument: (id: string) =>
      request<PresentationDocument>(api(`/documents/${id}`)),
    listImages: () => request<GeneratedImage[]>(api("/images")),
    createDocument: (input: CreatePresentationInput) =>
      request<Created>(api("/documents"), body("POST", input)),
    saveDocument: (id: string, input: SavePresentationInput) =>
      request<Revised>(api(`/documents/${id}`), body("PATCH", input)),
    setDocumentFavorite: (id: string, enabled: boolean) =>
      mutation(api(`/documents/${id}/favorite`), body("PUT", { enabled })),
    duplicateDocument: (id: string) =>
      request<Created>(api(`/documents/${id}/duplicate`), { method: "POST" }),
    generateOutline: (input: OutlineInput) =>
      request<{ result: { title?: string; outline?: string[] } }>(
        api("/generate/outline"),
        body("POST", input),
      ),
    saveSlide: (id: string, slide: Slide) =>
      request<Created & Revised>(
        api(`/documents/${id}/slides`),
        body("PUT", slide),
      ),
    deleteSlide: (id: string, slideId: string) =>
      mutation(api(`/documents/${id}/slides/${slideId}`), { method: "DELETE" }),
    moveSlide: (id: string, slideId: string, position: number) =>
      mutation(
        api(`/documents/${id}/slides/${slideId}`),
        body("PATCH", { position }),
      ),
    generateSlide: (id: string, input: SlideGenerationInput) =>
      request<{ result: { sourceXml?: string }; position: number }>(
        api(`/documents/${id}/slides/generate`),
        body("POST", input),
      ),
    createShare: (id: string) =>
      request<PresentationShare>(api(`/documents/${id}/shares`), {
        method: "POST",
      }),
    revokeShare: (id: string) =>
      mutation(api(`/shares/${id}`), { method: "DELETE" }),
    exportDocument: (
      id: string,
      input: { format: "pptx" | "pdf"; idempotencyKey: string },
    ) =>
      request<{ assetReference: string }>(
        api(`/documents/${id}/exports`),
        body("POST", input),
      ),
    createTheme: (input: ThemeInput) =>
      request<Created>(api("/themes"), body("POST", input)),
    setThemeReaction: (
      id: string,
      reaction: "favorite" | "like",
      enabled: boolean,
    ) => mutation(api(`/themes/${id}/${reaction}`), body("PUT", { enabled })),
    importTheme: (input: ThemeImportInput) =>
      request<Created & { theme: PresentationTheme }>(
        api("/themes/import"),
        body("POST", input),
      ),
    generateImage: (input: ImageGenerationInput) =>
      request<unknown>(api("/images/generate"), body("POST", input)),
    uploadImage: (input: ImageUploadInput) =>
      request<Created>(api("/images"), body("POST", input)),
    saveRecording: (id: string, input: RecordingInput) =>
      request<Created>(api(`/documents/${id}/recordings`), body("POST", input)),
    startAgent: (input: AgentInput) =>
      request<Created & { status: string }>(
        platform("/agent-jobs"),
        body("POST", input),
      ),
    agentEvents: (id: string, sequence: number) =>
      request<AgentEvent[]>(
        `${platform(`/agent-jobs/${id}/events`)}&after=${sequence}`,
      ),
    getAgent: (id: string) =>
      request<{ result?: { output?: unknown } | unknown }>(
        platform(`/agent-jobs/${id}`),
      ),
    cancelAgent: (id: string) =>
      mutation(platform(`/agent-jobs/${id}`), { method: "DELETE" }),
    resumeAgent: (id: string, prompt: string) =>
      mutation(platform(`/agent-jobs/${id}/resume`), body("POST", { prompt })),
  };
}

/** Public shares are token-scoped and never attach the current tenant. */
export function loadSharedPresentation(
  token: string,
  onData: OnData<PresentationDocument>,
  onError?: OnError,
): () => void {
  return load(
    `/api/presentation/v1/shared/${encodeURIComponent(token)}`,
    onData,
    onError,
  );
}
