import type {
  DocumentField,
  DocumentFieldError,
  DocumentFormat,
  DocumentTemplateKind,
} from "@omnitech/interview-contracts";
import { studioFetch } from "../studio-fetch";
import { readNdjson } from "../work-guards";

const ROOT = "/api/interview/documents";

export type Template = {
  id: string;
  name: string;
  kind: DocumentTemplateKind;
  format: DocumentFormat;
  ownerUserId: string | null;
};
export type TemplateListItem = {
  template: Template;
  latestRevision: number;
  fieldCount: number;
  revisions: Array<{ revision: number; createdAt: string }>;
};
export type TemplateDetail = {
  template: Template;
  revision: { revision: number; instructions: string };
  fields: DocumentField[];
};
export type DocumentListItem = {
  id: string;
  title: string;
  status: string;
  currentRevision: number;
  profileRevision: number;
  profileId: string;
  candidacyId: string | null;
  interviewId: string | null;
  templateId: string;
  templateRevision: number;
  updatedAt: string;
};
export type DocumentDetail = {
  document: DocumentListItem;
  revision: {
    revision: number;
    values: Record<string, string>;
    validation: DocumentFieldError[];
    provenance: {
      kind?: string;
      fieldKeys?: string[];
      restoredFromRevision?: number;
      sourceDigest?: string | null;
      modelOwnedKeys?: string[];
      claimState?: "unverified" | "confirmed";
    };
    createdAt: string;
  };
  template: Template;
  fields: DocumentField[];
};
export type DocumentContext = {
  profiles: Array<{ id: string; name: string; revision: number }>;
  candidacies: Array<{
    id: string;
    title: string;
    company_name: string;
    job_description: string | null;
  }>;
  interviews: Array<{
    id: string;
    candidacy_id: string;
    label: string;
    kind: string;
  }>;
  targets: Array<{
    id: string;
    label: string;
    kind?: "model" | "agent" | "image";
  }>;
};
export type DocumentExport = {
  id: string;
  revision: number;
  format: DocumentFormat;
  createdAt: string;
};

export class DocumentsApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly payload: unknown,
  ) {
    super(code);
  }
}

async function checked<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      (payload as { error?: { code?: string } } | null)?.error?.code ??
      (response.status >= 500 ? "server-error" : "request-failed");
    throw new DocumentsApiError(code, payload);
  }
  return payload as T;
}

export async function documentJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await studioFetch(`${ROOT}${path}`, init);
  return checked<T>(response);
}

export function postJson<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return documentJson<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

// What a document being written reports, a line at a time.
export type GenerationEvent =
  | {
      t: "plan";
      batches: Array<{ id: string; title: string; count: number }>;
      fixed: Record<string, string>;
    }
  | { t: "batch"; id: string; title: string; values: Record<string, string> }
  | { t: "done"; document: { id: string }; errors: DocumentFieldError[] }
  | { t: "exists"; existingDocumentId: string }
  | { t: "error"; code: string };

/** POST that answers with newline-delimited events, handed over as they come. */
export async function postStream(
  path: string,
  body: unknown,
  signal: AbortSignal,
  onEvent: (event: GenerationEvent) => void,
): Promise<void> {
  const response = await studioFetch(`${ROOT}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/x-ndjson",
    },
    body: JSON.stringify(body),
    signal,
  });
  // Problems found before any writing starts are ordinary JSON answers.
  if (!response.headers.get("content-type")?.includes("x-ndjson"))
    return void (await checked(response));
  if (!response.body) throw new DocumentsApiError("server-error", null);
  await readNdjson<GenerationEvent>(response.body, onEvent);
}

export function uploadTemplate<T>(path: string, form: FormData): Promise<T> {
  return documentJson<T>(path, { method: "POST", body: form });
}

export async function downloadExport(
  documentId: string,
  record: DocumentExport,
  title: string,
): Promise<void> {
  const response = await studioFetch(
    `${ROOT}/${encodeURIComponent(documentId)}/exports/${encodeURIComponent(record.id)}/download`,
  );
  if (!response.ok) throw new DocumentsApiError("download-failed", null);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${
      title
        .replace(/[^a-zA-Z0-9._ -]/g, "_")
        .trim()
        .slice(0, 100) || "document"
    }.${record.format}`;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
