"use client";

import type {
  DocumentField,
  DocumentFieldError,
  DocumentFormat,
  DocumentTemplateKind,
} from "@omnitech/interview-contracts";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { StudioActions } from "../config/commands";
import {
  type DocumentContext,
  type DocumentDetail,
  type DocumentExport,
  type DocumentListItem,
  DocumentsApiError,
  documentJson,
  downloadExport,
  postJson,
  type TemplateDetail,
  type TemplateListItem,
  uploadTemplate,
} from "./documents-client";

const ROOT = "/api/interview/documents";
const PREVIEW_POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`;
const KIND_LABEL: Record<DocumentTemplateKind, string> = {
  resume: "Resume",
  cover_letter: "Cover letter",
  interview_prep: "Interview prep",
  custom: "Custom",
};

function message(error: unknown): string {
  if (error instanceof DocumentsApiError) {
    if (error.code === "revision-conflict")
      return "A newer revision exists. Reload this document before editing.";
    if (error.code === "invalid-fields")
      return "The document contains invalid field values. Review the flagged fields.";
    if (error.code === "generation-unavailable")
      return "The selected model is unavailable. Choose another model.";
    if (error.code === "server-error")
      return "The Documents service returned an error. Check the server and database migrations.";
    if (error.code === "body-too-large")
      return "The template file is too large.";
    if (error.code === "invalid-field-or-template")
      return "The template or fields could not be accepted.";
  }
  return "This action could not be completed. Try again.";
}

async function catalog(signal?: AbortSignal): Promise<{
  context: DocumentContext;
  templates: TemplateListItem[];
  documents: DocumentListItem[];
}> {
  const [context, templates, documents] = await Promise.all([
    documentJson<DocumentContext>("/context", signal ? { signal } : {}),
    documentJson<{ templates: TemplateListItem[] }>(
      "/templates",
      signal ? { signal } : {},
    ),
    documentJson<{ documents: DocumentListItem[] }>(
      "",
      signal ? { signal } : {},
    ),
  ]);
  return {
    context,
    templates: templates.templates,
    documents: documents.documents,
  };
}

type Tab = "documents" | "templates";

export function DocumentsView({
  rest,
  actions,
  onDirtyChange,
}: {
  rest: readonly string[];
  actions: StudioActions;
  onDirtyChange(dirty: boolean): void;
}) {
  const selectedId =
    rest[0] && rest[0] !== "new" && rest[0] !== "templates" ? rest[0] : null;
  const [tab, setTab] = useState<Tab>(
    rest[0] === "templates" ? "templates" : "documents",
  );
  const [data, setData] = useState<Awaited<ReturnType<typeof catalog>> | null>(
    null,
  );
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const refreshCatalog = useCallback(
    () => setRefresh((value) => value + 1),
    [],
  );

  useEffect(
    () => setTab(rest[0] === "templates" ? "templates" : "documents"),
    [rest[0]],
  );

  useEffect(() => {
    const controller = new AbortController();
    catalog(controller.signal).then(
      (loaded) => {
        if (!controller.signal.aborted) {
          setData(loaded);
          setError("");
        }
      },
      (cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      },
    );
    return () => controller.abort();
  }, [refresh]);

  return (
    <section className="documents-view" aria-label="Documents">
      <aside className="documents-sidebar" aria-label="Document library">
        <div className="documents-sidebar-head">
          <h2>Documents</h2>
          <button
            type="button"
            onClick={() => {
              setTab("documents");
              actions.go("documents", ["new"]);
            }}
          >
            New
          </button>
        </div>
        <div
          className="documents-tabs"
          role="tablist"
          aria-label="Documents sections"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "documents"}
            onClick={() => {
              setTab("documents");
              actions.go("documents");
            }}
          >
            My documents
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "templates"}
            onClick={() => {
              setTab("templates");
              actions.go("documents", ["templates"]);
            }}
          >
            Templates
          </button>
        </div>
        {tab === "documents" ? (
          <div className="documents-list">
            {data?.documents.length === 0 && (
              <p className="documents-muted">No documents yet.</p>
            )}
            {data?.documents.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={selectedId === item.id ? "page" : undefined}
                onClick={() => {
                  setTab("documents");
                  actions.go("documents", [item.id]);
                }}
              >
                <strong>{item.title}</strong>
                <span>
                  {item.status === "invalid"
                    ? "Needs attention"
                    : `Revision ${item.currentRevision}`}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="documents-list">
            {data?.templates.length === 0 && (
              <p className="documents-muted">No templates yet.</p>
            )}
            {data?.templates.map(({ template, latestRevision }) => (
              <button
                key={template.id}
                type="button"
                onClick={() =>
                  actions.go("documents", ["templates", template.id])
                }
              >
                <strong>{template.name}</strong>
                <span>
                  {KIND_LABEL[template.kind]} · {template.format.toUpperCase()}{" "}
                  · v{latestRevision}
                  {template.ownerUserId ? "" : " · Built-in"}
                </span>
              </button>
            ))}
          </div>
        )}
        {error && data && (
          <p role="alert" className="documents-error">
            {error}
          </p>
        )}
      </aside>
      <main className="documents-main">
        {!data && error ? (
          <div className="documents-page" role="alert">
            <h1>Documents could not load</h1>
            <p>{error}</p>
            <button type="button" onClick={refreshCatalog}>
              Retry
            </button>
          </div>
        ) : !data ? (
          <p className="documents-loading">Loading documents…</p>
        ) : tab === "templates" || rest[0] === "templates" ? (
          <TemplateManager
            key={rest[1] ?? "new"}
            templates={data.templates}
            selectedId={rest[1] ?? null}
            onChanged={refreshCatalog}
          />
        ) : selectedId ? (
          <DocumentEditor
            key={selectedId}
            id={selectedId}
            context={data.context}
            onDirtyChange={onDirtyChange}
            onChanged={refreshCatalog}
          />
        ) : (
          <NewDocument
            context={data.context}
            templates={data.templates}
            actions={actions}
            onCreated={refreshCatalog}
          />
        )}
      </main>
    </section>
  );
}

function NewDocument({
  context,
  templates,
  actions,
  onCreated,
}: {
  context: DocumentContext;
  templates: TemplateListItem[];
  actions: StudioActions;
  onCreated(): void;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.template.id ?? "");
  const [profileId, setProfileId] = useState(context.profiles[0]?.id ?? "");
  const [candidacyId, setCandidacyId] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [interviewId, setInterviewId] = useState("");
  const [targetId, setTargetId] = useState(context.targets[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [existingId, setExistingId] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const selected = templates.find((item) => item.template.id === templateId);
  const profile = context.profiles.find((item) => item.id === profileId);
  const candidacy = context.candidacies.find((item) => item.id === candidacyId);
  const interviews = context.interviews.filter(
    (item) => item.candidacy_id === candidacyId,
  );
  const needsStage = selected?.template.kind === "interview_prep";
  const canGenerate =
    !!selected &&
    !!profile &&
    !!targetId &&
    (!needsStage || (!!candidacyId && !!interviewId));
  useEffect(() => () => pending.current?.abort(), []);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!selected || !profile || !targetId || !canGenerate) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setExistingId(null);
    try {
      if (candidacy && jobDescription !== (candidacy.job_description ?? "")) {
        await documentJson(
          `/candidacies/${encodeURIComponent(candidacy.id)}/job-description`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jobDescription }),
            signal: controller.signal,
          },
        );
      }
      const result = await postJson<{ document: { id: string } }>(
        "",
        {
          title:
            title.trim() ||
            `${selected.template.name}${candidacy ? ` for ${candidacy.company_name}` : ""}`,
          templateId,
          templateRevision: selected.latestRevision,
          profileId,
          profileRevision: profile.revision,
          candidacyId: candidacyId || null,
          interviewId: interviewId || null,
          aiTargetId: targetId,
        },
        controller.signal,
      );
      onCreated();
      actions.go("documents", [result.document.id]);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (
        cause instanceof DocumentsApiError &&
        cause.code === "request-failed"
      ) {
        const id = (cause.payload as { existingDocumentId?: string })
          .existingDocumentId;
        if (id) {
          setExistingId(id);
          return;
        }
      }
      setError(message(cause));
    } finally {
      if (pending.current === controller) pending.current = null;
      setBusy(false);
    }
  }

  return (
    <div className="documents-page">
      <header>
        <span className="documents-eyebrow">New document</span>
        <h1>Create from your experience</h1>
        <p>
          Choose a template and a saved profile revision. A candidacy adds the
          company, role, and interview stage.
        </p>
      </header>
      <form className="documents-form" onSubmit={create}>
        {templates.length === 0 && (
          <p className="documents-notice" role="status">
            No templates are available. Open Templates to add one.
          </p>
        )}
        {context.profiles.length === 0 && (
          <p className="documents-notice" role="status">
            Save an experience matrix before generating a document.
          </p>
        )}
        {context.targets.length === 0 && (
          <p className="documents-notice" role="status">
            No model is available for document generation.
          </p>
        )}
        <label>
          Template
          <select
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
            required
          >
            {templates.map(({ template }) => (
              <option key={template.id} value={template.id}>
                {template.name} · {template.format.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label>
          Candidate profile
          <select
            value={profileId}
            onChange={(event) => setProfileId(event.target.value)}
            required
          >
            {context.profiles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · revision {item.revision}
              </option>
            ))}
          </select>
        </label>
        <label>
          Candidacy
          <select
            value={candidacyId}
            onChange={(event) => {
              setCandidacyId(event.target.value);
              setInterviewId("");
              setJobDescription(
                context.candidacies.find(
                  (item) => item.id === event.target.value,
                )?.job_description ?? "",
              );
            }}
          >
            <option value="" disabled={needsStage}>
              General document
            </option>
            {context.candidacies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.company_name} · {item.title}
              </option>
            ))}
          </select>
        </label>
        {candidacy && (
          <>
            <p className="documents-context-note">
              {candidacy.company_name} · {candidacy.title}
            </p>
            <label htmlFor="new-document-job-description">
              Job description
              <textarea
                id="new-document-job-description"
                value={jobDescription}
                onChange={(event) => setJobDescription(event.target.value)}
                maxLength={20_000}
                rows={6}
                placeholder="Paste the role's job description"
              />
            </label>
            <span className="documents-field-hint">
              Saved to this candidacy when you generate.
            </span>
          </>
        )}
        {candidacyId && (
          <label>
            Interview stage
            <select
              value={interviewId}
              onChange={(event) => setInterviewId(event.target.value)}
            >
              <option value="" disabled={needsStage}>
                No specific stage
              </option>
              {interviews.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Model
          <select
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            required
          >
            {context.targets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={
              selected
                ? `${selected.template.name}${candidacy ? ` for ${candidacy.company_name}` : ""}`
                : "Document title"
            }
            maxLength={200}
          />
        </label>
        {error && (
          <p role="alert" className="documents-error">
            {error}
          </p>
        )}
        {existingId && (
          <p role="status">
            A matching document already exists.{" "}
            <button
              type="button"
              onClick={() => actions.go("documents", [existingId])}
            >
              Open it
            </button>
          </p>
        )}
        {needsStage && (!candidacyId || !interviewId) && (
          <p className="documents-context-note">
            Interview prep needs a candidacy and interview stage.
          </p>
        )}
        <div className="documents-actions">
          <button type="submit" disabled={busy || !canGenerate}>
            {busy ? "Generating…" : "Generate document"}
          </button>
          {busy && (
            <button type="button" onClick={() => pending.current?.abort()}>
              Cancel generation
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function TemplateManager({
  templates,
  selectedId,
  onChanged,
}: {
  templates: TemplateListItem[];
  selectedId: string | null;
  onChanged(): void;
}) {
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DocumentTemplateKind>("custom");
  const [format, setFormat] = useState<DocumentFormat>("docx");
  const [instructions, setInstructions] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [intake, setIntake] = useState<{
    file: File;
    format: DocumentFormat;
    fields: DocumentField[];
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = templates.find((item) => item.template.id === selectedId);
  const templateFormat = selected?.template.format ?? format;
  const inspected =
    !!file && intake?.file === file && intake.format === templateFormat;
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    documentJson<TemplateDetail>(
      `/templates/${encodeURIComponent(selectedId)}`,
      { signal: controller.signal },
    ).then(
      (item) => {
        if (!controller.signal.aborted) {
          setDetail(item);
          setInstructions(item.revision.instructions);
        }
      },
      (cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      },
    );
    return () => controller.abort();
  }, [selectedId]);

  useEffect(() => {
    if (!file) return;
    const controller = new AbortController();
    const form = new FormData();
    form.set("file", file);
    form.set("format", templateFormat);
    documentJson<{ fields: DocumentField[] }>("/templates/intake", {
      method: "POST",
      body: form,
      signal: controller.signal,
    }).then(
      (result) => {
        if (!controller.signal.aborted)
          setIntake({ file, format: templateFormat, fields: result.fields });
      },
      (cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      },
    );
    return () => controller.abort();
  }, [file, templateFormat]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !file ||
      !inspected ||
      (selectedId &&
        (!selected || !detail || detail.template.id !== selectedId))
    )
      return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("instructions", instructions);
      form.set("fields", JSON.stringify(intake.fields));
      if (selected && detail) {
        form.set("expectedRevision", String(detail.revision.revision));
        await uploadTemplate(
          `/templates/${encodeURIComponent(selected.template.id)}/revisions`,
          form,
        );
      } else {
        form.set("name", name);
        form.set("kind", kind);
        form.set("format", format);
        await uploadTemplate("/templates", form);
      }
      setFile(null);
      setIntake(null);
      if (fileInput.current) fileInput.current.value = "";
      onChanged();
      if (selectedId)
        setDetail(
          await documentJson<TemplateDetail>(
            `/templates/${encodeURIComponent(selectedId)}`,
          ),
        );
      else {
        setName("");
        setInstructions("");
      }
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function duplicate() {
    if (!selected) return;
    const copyName = window.prompt(
      "Name for your copy",
      `${selected.template.name} copy`,
    );
    if (!copyName?.trim()) return;
    setBusy(true);
    setError("");
    try {
      await postJson(
        `/templates/${encodeURIComponent(selected.template.id)}/duplicate`,
        { name: copyName.trim() },
      );
      onChanged();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="documents-page">
      <header>
        <span className="documents-eyebrow">Templates</span>
        <h1>{selected?.template.name ?? "Your templates"}</h1>
        <p>
          {selected
            ? `${KIND_LABEL[selected.template.kind]} · ${selected.template.format.toUpperCase()} · version ${selected.latestRevision}`
            : "Upload DOCX or Markdown. Fields are detected from placeholders in the file."}
        </p>
      </header>
      {selected && detail && (
        <section
          className="documents-template-detail"
          aria-label="Template details"
        >
          <p>
            {selected.template.ownerUserId
              ? "Your template"
              : "Built-in template · read-only"}
          </p>
          <p>
            {detail.fields.length} fields:{" "}
            {detail.fields.map((field) => field.label).join(", ")}
          </p>
          <button type="button" onClick={duplicate} disabled={busy}>
            Duplicate template
          </button>
        </section>
      )}
      {(!selected || selected.template.ownerUserId) && (
        <form className="documents-form" onSubmit={submit}>
          <h2>
            {selected ? "Upload a new template version" : "Upload a template"}
          </h2>
          {!selected && (
            <>
              <label>
                Name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={200}
                />
              </label>
              <label>
                Kind
                <select
                  value={kind}
                  onChange={(event) =>
                    setKind(event.target.value as DocumentTemplateKind)
                  }
                >
                  {Object.entries(KIND_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Format
                <select
                  value={format}
                  onChange={(event) => {
                    setFormat(event.target.value as DocumentFormat);
                    setFile(null);
                    setIntake(null);
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                >
                  <option value="docx">DOCX</option>
                  <option value="md">Markdown</option>
                </select>
              </label>
            </>
          )}
          <label>
            Source file
            <input
              ref={fileInput}
              type="file"
              accept={
                selected
                  ? selected.template.format === "docx"
                    ? ".docx"
                    : ".md"
                  : format === "docx"
                    ? ".docx"
                    : ".md"
              }
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setIntake(null);
                setError("");
              }}
              required
            />
          </label>
          {file && !inspected && !error && (
            <p role="status">Inspecting placeholders…</p>
          )}
          {inspected && (
            <fieldset className="documents-template-fields">
              <legend>Detected fields</legend>
              <p>Review each field before saving this template version.</p>
              {intake.fields.map((field, index) => (
                <div key={field.key} className="documents-template-field">
                  <strong>{field.label}</strong>
                  <small>
                    {field.key} · {field.source}
                  </small>
                  <label>
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) =>
                        setIntake((current) =>
                          current && current.file === file
                            ? {
                                ...current,
                                fields: current.fields.map((item, position) =>
                                  position === index
                                    ? {
                                        ...item,
                                        required: event.target.checked,
                                      }
                                    : item,
                                ),
                              }
                            : current,
                        )
                      }
                    />
                    Required
                  </label>
                  <label>
                    Maximum length
                    <input
                      type="number"
                      min={1}
                      max={20000}
                      value={field.maxLength ?? ""}
                      placeholder="No limit"
                      onChange={(event) =>
                        setIntake((current) =>
                          current && current.file === file
                            ? {
                                ...current,
                                fields: current.fields.map((item, position) =>
                                  position === index
                                    ? {
                                        ...item,
                                        maxLength: event.target.value
                                          ? Number(event.target.value)
                                          : null,
                                      }
                                    : item,
                                ),
                              }
                            : current,
                        )
                      }
                    />
                  </label>
                </div>
              ))}
            </fieldset>
          )}
          <label>
            Generation instructions
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={5}
              maxLength={16000}
            />
          </label>
          <button
            type="submit"
            disabled={
              busy ||
              !inspected ||
              (selectedId !== null &&
                (!detail || detail.template.id !== selectedId)) ||
              (intake?.fields.some(
                (field) =>
                  field.maxLength !== null &&
                  (!Number.isInteger(field.maxLength) ||
                    field.maxLength < 1 ||
                    field.maxLength > 20000),
              ) ??
                false)
            }
          >
            {busy
              ? "Uploading…"
              : selected
                ? "Save new version"
                : "Add template"}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="documents-error">
          {error}
        </p>
      )}
    </div>
  );
}

function DocumentEditor({
  id,
  context,
  onDirtyChange,
  onChanged,
}: {
  id: string;
  context: DocumentContext;
  onDirtyChange(dirty: boolean): void;
  onChanged(): void;
}) {
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState("");
  const [draftValidation, setDraftValidation] = useState<
    DocumentFieldError[] | null
  >(null);
  const [exports, setExports] = useState<DocumentExport[]>([]);
  const [targetId, setTargetId] = useState(context.targets[0]?.id ?? "");
  const [exportFormat, setExportFormat] = useState<DocumentFormat>("docx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = detail?.document.currentRevision ?? 0;
  const older = !!detail && detail.revision.revision !== current;
  const dirty =
    !!detail &&
    !older &&
    JSON.stringify(values) !== JSON.stringify(detail.revision.values);
  const validation = draftValidation ?? detail?.revision.validation ?? [];

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const controller = new AbortController();
    const query = selectedRevision ? `?revision=${selectedRevision}` : "";
    Promise.all([
      documentJson<DocumentDetail>(`/${encodeURIComponent(id)}${query}`, {
        signal: controller.signal,
      }),
      documentJson<{ html: string }>(
        `/${encodeURIComponent(id)}/preview${query}`,
        { signal: controller.signal },
      ),
      documentJson<{ exports: DocumentExport[] }>(
        `/${encodeURIComponent(id)}/exports`,
        { signal: controller.signal },
      ),
    ]).then(
      ([loaded, rendered, history]) => {
        if (controller.signal.aborted) return;
        setDetail(loaded);
        setExportFormat(loaded.template.format);
        setValues(loaded.revision.values);
        setPreview(rendered.html);
        setExports(history.exports);
        setDraftValidation(null);
        setError("");
      },
      (cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      },
    );
    return () => controller.abort();
  }, [id, selectedRevision, refresh]);

  // Preview drafts without writing a revision. Old revisions use their saved preview.
  useEffect(() => {
    if (!detail || !dirty || older) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      postJson<{ html: string; validation: DocumentFieldError[] }>(
        `/${encodeURIComponent(id)}/preview`,
        { baseRevision: current, values },
        controller.signal,
      ).then(
        (result) => {
          if (!controller.signal.aborted) {
            setPreview(result.html);
            setDraftValidation(result.validation);
          }
        },
        (cause) => {
          if (!controller.signal.aborted) setError(message(cause));
        },
      );
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [id, current, detail, dirty, older, values]);

  async function mutate(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await postJson(path, body);
      setSelectedRevision(null);
      setRefresh((value) => value + 1);
      onChanged();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function makeExport() {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      const record = await postJson<DocumentExport>(
        `/${encodeURIComponent(id)}/exports`,
        {
          revision: detail.revision.revision,
          format: exportFormat,
        },
      );
      setExports((list) => [record, ...list]);
      await downloadExport(id, record, detail.document.title);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!detail)
    return (
      <div className="documents-page">
        {error ? (
          <div role="alert" className="documents-error">
            <h1>Document could not load</h1>
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setRefresh((value) => value + 1)}
            >
              Retry
            </button>
          </div>
        ) : (
          "Loading document…"
        )}
      </div>
    );
  const profile = context.profiles.find(
    (item) => item.id === detail.document.profileId,
  );
  const candidacy = context.candidacies.find(
    (item) => item.id === detail.document.candidacyId,
  );
  const fieldError = (key: string) =>
    validation.find((item) => item.key === key)?.code;

  return (
    <div className="documents-editor">
      <header className="documents-editor-head">
        <div>
          <span className="documents-eyebrow">
            {KIND_LABEL[detail.template.kind]} ·{" "}
            {detail.template.format.toUpperCase()}
          </span>
          <h1>{detail.document.title}</h1>
          <p>
            Template v{detail.document.templateRevision} · Profile revision{" "}
            {detail.document.profileRevision}
            {candidacy ? ` · ${candidacy.company_name}` : " · General"}
          </p>
        </div>
        <div className="documents-actions">
          <label>
            Export format
            <select
              value={exportFormat}
              onChange={(event) =>
                setExportFormat(event.target.value as DocumentFormat)
              }
            >
              {detail.template.format === "docx" && (
                <option value="docx">DOCX</option>
              )}
              <option value="md">Markdown</option>
            </select>
          </label>
          <button type="button" disabled={busy || dirty} onClick={makeExport}>
            Export {exportFormat === "docx" ? "DOCX" : "Markdown"}
          </button>
        </div>
      </header>
      {validation.length > 0 && (
        <p className="documents-notice" role="status">
          {validation.length}{" "}
          {validation.length === 1 ? "field needs" : "fields need"} attention.
          Missing fields export blank; long fields may overflow the layout.
        </p>
      )}
      {profile && profile.revision > detail.document.profileRevision && (
        <p className="documents-notice" role="status">
          Your experience matrix has a newer revision. This document keeps its
          original profile revision.
        </p>
      )}
      <div className="documents-toolbar">
        <label>
          Revision
          <select
            value={detail.revision.revision}
            disabled={busy}
            onChange={(event) => {
              const revision = Number(event.target.value);
              if (revision === detail.revision.revision) return;
              if (
                dirty &&
                !window.confirm(
                  "Discard unsaved edits and open another revision?",
                )
              )
                return;
              setSelectedRevision(revision);
            }}
          >
            {Array.from({ length: current }, (_, index) => current - index).map(
              (revision) => (
                <option key={revision} value={revision}>
                  Revision {revision}
                  {revision === current ? " · latest" : ""}
                </option>
              ),
            )}
          </select>
        </label>
        {!older && context.targets.length > 0 && (
          <label>
            Model
            <select
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              {context.targets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {!older && targetId && (
          <>
            <button
              type="button"
              disabled={busy || dirty}
              onClick={() =>
                mutate(`/${encodeURIComponent(id)}/regenerate`, {
                  baseRevision: current,
                  mode: "all",
                  aiTargetId: targetId,
                })
              }
            >
              Regenerate all fields
            </button>
            {validation.some((issue) =>
              detail.fields.some(
                (field) =>
                  field.key === issue.key &&
                  field.source === "candidate-profile",
              ),
            ) && (
              <button
                type="button"
                disabled={busy || dirty}
                onClick={() =>
                  mutate(`/${encodeURIComponent(id)}/regenerate`, {
                    baseRevision: current,
                    mode: "fix",
                    aiTargetId: targetId,
                  })
                }
              >
                Fix issues
              </button>
            )}
          </>
        )}
        {older && (
          <>
            <span role="status">Older revision · read-only</span>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                mutate(`/${encodeURIComponent(id)}/restore`, {
                  baseRevision: current,
                  sourceRevision: detail.revision.revision,
                })
              }
            >
              Restore as new revision
            </button>
          </>
        )}
        {!older && dirty && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              mutate(`/${encodeURIComponent(id)}/revisions`, {
                baseRevision: current,
                values,
              })
            }
          >
            Save new revision
          </button>
        )}
        {!older && dirty && (
          <button
            type="button"
            onClick={() => {
              setValues(detail.revision.values);
              setDraftValidation(null);
              setRefresh((value) => value + 1);
            }}
          >
            Discard edits
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="documents-error">
          {error}
        </p>
      )}
      <div className="documents-workspace">
        <section className="documents-fields" aria-label="Document fields">
          <p className="documents-muted">
            {detail.revision.provenance.kind ?? "Saved"} · revision{" "}
            {detail.revision.revision}.{" "}
            {detail.document.candidacyId
              ? "Candidacy fields come from the saved application."
              : "Enter role and company details for a general document."}
          </p>
          {detail.fields.map((field) => {
            const issue = fieldError(field.key);
            const locked =
              older ||
              (field.source === "candidacy" && !!detail.document.candidacyId) ||
              (field.source === "interview" && !!detail.document.interviewId);
            return (
              <div className="documents-field" key={field.key}>
                <label htmlFor={`document-field-${field.key}`}>
                  {field.label}
                </label>
                <small>
                  {field.source.replace("-", " ")}
                  {field.maxLength
                    ? ` · ${values[field.key]?.length ?? 0}/${field.maxLength}`
                    : ""}
                </small>
                <textarea
                  id={`document-field-${field.key}`}
                  rows={Math.min(
                    6,
                    Math.max(
                      2,
                      Math.ceil((values[field.key]?.length ?? 0) / 72),
                    ),
                  )}
                  value={values[field.key] ?? ""}
                  readOnly={locked}
                  onChange={(event) =>
                    setValues((before) => ({
                      ...before,
                      [field.key]: event.target.value,
                    }))
                  }
                  aria-invalid={!!issue}
                  aria-describedby={
                    issue ? `document-error-${field.key}` : undefined
                  }
                />
                {issue && (
                  <p
                    className="documents-field-error"
                    id={`document-error-${field.key}`}
                  >
                    {issue === "missing"
                      ? field.source === "candidate-profile"
                        ? "No profile value found. Enter this field manually."
                        : "This field is required."
                      : issue === "too-long"
                        ? "This field is too long."
                        : "Unexpected field."}
                  </p>
                )}
                {!locked &&
                  field.source === "candidate-profile" &&
                  targetId && (
                    <button
                      type="button"
                      className="documents-field-action"
                      disabled={busy || dirty}
                      onClick={() =>
                        mutate(`/${encodeURIComponent(id)}/regenerate`, {
                          baseRevision: current,
                          fieldKey: field.key,
                          aiTargetId: targetId,
                        })
                      }
                    >
                      Regenerate this field
                    </button>
                  )}
              </div>
            );
          })}
        </section>
        <section className="documents-preview" aria-label="Document preview">
          <h2>Preview</h2>
          <iframe
            title="Document preview"
            sandbox=""
            srcDoc={`${PREVIEW_POLICY}${preview}`}
          />
        </section>
      </div>
      <section className="documents-exports" aria-label="Previous exports">
        <h2>Exports</h2>
        {exports.length === 0 ? (
          <p className="documents-muted">No exports yet.</p>
        ) : (
          <ul>
            {exports.map((record) => (
              <li key={record.id}>
                <span>
                  Revision {record.revision} · {record.format.toUpperCase()}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    downloadExport(id, record, detail.document.title).catch(
                      (cause) => setError(message(cause)),
                    )
                  }
                >
                  Download
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
