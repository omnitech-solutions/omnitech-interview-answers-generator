import type {
  DocumentField,
  DocumentFieldError,
  DocumentFormat,
  DocumentTemplateKind,
} from "@omnitech/interview-contracts";
import { studioFetch } from "../studio-fetch";

const ROOT = "/api/interview/documents";

export type Template = {
  id: string;
  name: string;
  kind: DocumentTemplateKind;
  format: DocumentFormat;
  ownerUserId: string | null;
};
export type TemplateListItem = { template: Template; latestRevision: number };
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
  updatedAt: string;
};
export type DocumentDetail = {
  document: DocumentListItem & { templateId: string; templateRevision: number };
  revision: {
    revision: number;
    values: Record<string, string>;
    validation: DocumentFieldError[];
    provenance: { kind?: string; fieldKey?: string };
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
  targets: Array<{ id: string; label: string }>;
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
