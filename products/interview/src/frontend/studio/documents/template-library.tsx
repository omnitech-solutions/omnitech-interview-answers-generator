"use client";

import type {
  DocumentField,
  DocumentFormat,
  DocumentTemplateKind,
} from "@omnitech/interview-contracts";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Icon } from "../icon";
import {
  type DocumentListItem,
  documentJson,
  postJson,
  type TemplateDetail,
  type TemplateListItem,
  uploadTemplate,
} from "./documents-client";
import {
  groupFields,
  KIND_ICON,
  KIND_LABEL,
  relativeTime,
  templateUsage,
} from "./documents-model";
import {
  IconButton,
  message,
  Modal,
  PageHeader,
  Segmented,
} from "./documents-ui";

const KINDS = (Object.keys(KIND_LABEL) as DocumentTemplateKind[]).map((id) => ({
  id,
  label: KIND_LABEL[id],
}));

export function TemplateLibrary({
  templates,
  documents,
  selectedId,
  tabs,
  onSelect,
  onChanged,
  notify,
}: {
  templates: readonly TemplateListItem[];
  documents: readonly DocumentListItem[];
  selectedId: string | null;
  tabs: ReactNode;
  onSelect(id: string | null): void;
  onChanged(): void;
  notify(text: string): void;
}) {
  const [uploading, setUploading] = useState(false);
  const selected = templates.find((item) => item.template.id === selectedId);
  return (
    <div className="dx-split">
      <div className="dx-scroll">
        <div className="dx-page">
          <PageHeader
            title="Documents"
            description="A template is a .docx or .md file with {placeholders}. The fields are read from it, so there’s no schema to maintain."
            tabs={tabs}
            action={
              <button
                type="button"
                className="dx-button dx-button-lg"
                onClick={() => setUploading(true)}
              >
                <Icon name="upload" />
                Upload template
              </button>
            }
          />
          <div className="dx-card" role="table" aria-label="Templates">
            <div className="dx-table-row dx-table-head" role="row">
              <span role="columnheader">TEMPLATE</span>
              <span role="columnheader">KIND</span>
              <span role="columnheader">FORMAT</span>
              <span role="columnheader">FIELDS</span>
              <span role="columnheader">USED BY</span>
            </div>
            {templates.length === 0 && (
              <div className="dx-empty-row">
                No templates yet. Upload a .docx or .md file to add one.
              </div>
            )}
            {templates.map((item) => {
              const used = templateUsage(documents, item);
              return (
                <button
                  key={item.template.id}
                  type="button"
                  role="row"
                  className="dx-table-row dx-table-body"
                  data-selected={item.template.id === selectedId}
                  onClick={() => onSelect(item.template.id)}
                >
                  <span className="dx-cell-name" role="cell">
                    <Icon name={KIND_ICON[item.template.kind]} size={20} />
                    <span className="dx-cell-text">
                      <span className="dx-row-title">{item.template.name}</span>
                      <span className="dx-sub">
                        {item.template.ownerUserId ? "You" : "Built-in"} · rev{" "}
                        {item.latestRevision}
                      </span>
                    </span>
                  </span>
                  <span className="dx-muted" role="cell">
                    {KIND_LABEL[item.template.kind]}
                  </span>
                  <span className="dx-mono dx-muted" role="cell">
                    {item.template.format.toUpperCase()}
                  </span>
                  <span className="dx-mono" role="cell">
                    {item.fieldCount}
                  </span>
                  <span className="dx-muted" role="cell">
                    {used ? `${used} doc${used > 1 ? "s" : ""}` : "—"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {selected && (
        <TemplateDrawer
          key={selected.template.id}
          item={selected}
          onClose={() => onSelect(null)}
          onChanged={onChanged}
          onSelect={onSelect}
          notify={notify}
        />
      )}
      {uploading && (
        <UploadDialog
          onClose={() => setUploading(false)}
          onSaved={(id, count) => {
            setUploading(false);
            onChanged();
            onSelect(id);
            notify(`Template saved · ${count} fields`);
          }}
        />
      )}
    </div>
  );
}

function TemplateDrawer({
  item,
  onClose,
  onChanged,
  onSelect,
  notify,
}: {
  item: TemplateListItem;
  onClose(): void;
  onChanged(): void;
  onSelect(id: string): void;
  notify(text: string): void;
}) {
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const mine = !!item.template.ownerUserId;
  const { template, latestRevision } = item;

  useEffect(() => {
    const controller = new AbortController();
    documentJson<TemplateDetail>(
      `/templates/${encodeURIComponent(template.id)}`,
      { signal: controller.signal },
    ).then(
      (loaded) => {
        if (controller.signal.aborted) return;
        setDetail(loaded);
        setError("");
      },
      (cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      },
    );
    return () => controller.abort();
  }, [template.id, latestRevision]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  const saved = detail?.revision.instructions ?? "";
  const draft = instructions ?? saved;
  const dirty = !!detail && mine && draft !== saved;
  const current = detail?.revision.revision ?? latestRevision;

  return (
    <aside className="dx-drawer" aria-label={`${template.name} details`}>
      <div className="dx-drawer-head">
        <span className="dx-grow dx-ellipsis">{template.name}</span>
        <IconButton icon="close" label="Close details" onClick={onClose} />
      </div>
      <div className="dx-drawer-body">
        <div className="dx-stack">
          <div className="dx-eyebrow">SOURCE FILE</div>
          <div className="dx-file">
            <Icon name={KIND_ICON[template.kind]} />
            <div className="dx-grow">
              <div className="dx-mono dx-ellipsis">
                {template.format.toUpperCase()} source
              </div>
              <div className="dx-sub">
                Rev {latestRevision}
                {item.revisions[0]
                  ? ` · ${relativeTime(item.revisions[0].createdAt)}`
                  : ""}{" "}
                · stored as an artifact
              </div>
            </div>
          </div>
          {mine ? (
            <>
              <button
                type="button"
                className="dx-button dx-button-sm dx-self-start"
                disabled={busy || !detail}
                onClick={() => picker.current?.click()}
              >
                <Icon name="upload" size={16} />
                Upload new version
              </button>
              <input
                ref={picker}
                type="file"
                hidden
                aria-label="New template version file"
                accept={template.format === "docx" ? ".docx" : ".md"}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file || !detail) return;
                  void run(async () => {
                    const probe = new FormData();
                    probe.set("file", file);
                    probe.set("format", template.format);
                    const found = await uploadTemplate<{
                      fields: DocumentField[];
                    }>("/templates/intake", probe);
                    const form = new FormData();
                    form.set("file", file);
                    form.set("instructions", draft);
                    form.set("expectedRevision", String(current));
                    await uploadTemplate(
                      `/templates/${encodeURIComponent(template.id)}/revisions`,
                      form,
                    );
                    setInstructions(null);
                    onChanged();
                    notify(
                      `Rev ${current + 1} · ${found.fields.length} fields found`,
                    );
                  });
                }}
              />
            </>
          ) : (
            <div className="dx-inline-note">
              <span className="dx-grow">Built-in templates are read-only.</span>
              <button
                type="button"
                className="dx-button dx-button-sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const copy = await postJson<{ template: { id: string } }>(
                      `/templates/${encodeURIComponent(template.id)}/duplicate`,
                      { name: `${template.name} (copy)` },
                    );
                    onChanged();
                    onSelect(copy.template.id);
                    notify("Duplicated — you can edit this one");
                  })
                }
              >
                Duplicate to customize
              </button>
            </div>
          )}
        </div>

        <div className="dx-stack">
          <div className="dx-eyebrow-row">
            <span className="dx-eyebrow dx-grow">
              FIELDS READ FROM THE FILE
            </span>
            <span className="dx-mono dx-muted">
              {detail?.fields.length ?? item.fieldCount} fields
            </span>
          </div>
          {groupFields(detail?.fields ?? []).map((group) => (
            <div key={group.id} className="dx-field-group">
              <div className="dx-field-group-head">
                <span className="dx-grow">{group.title}</span>
                <span className="dx-mono dx-muted">{group.fields.length}</span>
              </div>
              <div className="dx-chips">
                {group.fields.map((field) => (
                  <span key={field.key} className="dx-chip">
                    {`{${field.key}}`}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="dx-stack">
          <label className="dx-eyebrow" htmlFor="template-instructions">
            GENERATION INSTRUCTIONS
          </label>
          <textarea
            id="template-instructions"
            className="dx-textarea"
            rows={9}
            maxLength={16_000}
            value={draft}
            readOnly={!mine}
            data-readonly={!mine}
            onChange={(event) => setInstructions(event.target.value)}
          />
          <div className="dx-eyebrow-row">
            <span className="dx-grow dx-sub">
              {mine
                ? "Changes create a new template revision. Existing documents keep the revision they were built from."
                : "Sent with the field list to the model, a few calls at a time."}
            </span>
            {dirty && (
              <button
                type="button"
                className="dx-button dx-button-primary dx-button-sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await postJson(
                      `/templates/${encodeURIComponent(template.id)}/instructions`,
                      { expectedRevision: current, instructions: draft },
                    );
                    setInstructions(null);
                    onChanged();
                    notify(`${template.name} saved as rev ${current + 1}`);
                  })
                }
              >
                Save as rev {current + 1}
              </button>
            )}
          </div>
        </div>

        <div className="dx-stack">
          <div className="dx-eyebrow">REVISIONS</div>
          {item.revisions.map((entry) => (
            <div key={entry.revision} className="dx-revision-line">
              <span className="dx-mono dx-muted">rev {entry.revision}</span>
              <span className="dx-grow">
                {entry.revision === latestRevision ? "Current" : "Earlier"}
              </span>
              <span className="dx-faint">{relativeTime(entry.createdAt)}</span>
            </div>
          ))}
        </div>
        {error && (
          <p role="alert" className="dx-error">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}

function formatOf(file: File): DocumentFormat | null {
  const name = file.name.toLowerCase();
  return name.endsWith(".docx") ? "docx" : name.endsWith(".md") ? "md" : null;
}

function UploadDialog({
  onClose,
  onSaved,
}: {
  onClose(): void;
  onSaved(templateId: string, fieldCount: number): void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [found, setFound] = useState<DocumentField[] | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DocumentTemplateKind>("custom");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const format = file ? formatOf(file) : null;

  async function choose(next: File | undefined) {
    setFound(null);
    setError("");
    if (!next) return;
    const nextFormat = formatOf(next);
    if (!nextFormat) {
      setFile(null);
      setError("Choose a .docx or .md file.");
      return;
    }
    setFile(next);
    setName((current) => current || next.name.replace(/\.[^.]+$/, ""));
    const probe = new FormData();
    probe.set("file", next);
    probe.set("format", nextFormat);
    try {
      const result = await uploadTemplate<{ fields: DocumentField[] }>(
        "/templates/intake",
        probe,
      );
      setFound(result.fields);
    } catch (cause) {
      setFile(null);
      setError(message(cause));
    }
  }

  async function save() {
    if (!file || !format || !found) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("name", name.trim() || "Untitled template");
      form.set("kind", kind);
      form.set("format", format);
      form.set("instructions", instructions);
      const created = await uploadTemplate<{ template: { id: string } }>(
        "/templates",
        form,
      );
      onSaved(created.template.id, found.length);
    } catch (cause) {
      setError(message(cause));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Upload a template"
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="dx-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="dx-button dx-button-primary"
            disabled={busy || !found}
            onClick={() => void save()}
          >
            Save template
          </button>
        </>
      }
    >
      <input
        ref={picker}
        type="file"
        hidden
        aria-label="Template file"
        accept=".docx,.md"
        onChange={(event) => {
          const next = event.target.files?.[0];
          event.target.value = "";
          void choose(next);
        }}
      />
      {!file && (
        <button
          type="button"
          className="dx-dropzone"
          onClick={() => picker.current?.click()}
        >
          <Icon name="upload_file" size={26} />
          <span className="dx-row-title">Choose a .docx or .md file</span>
          <span className="dx-sub">
            Write placeholders like {"{company_name}"} or {"{opening_summary}"}
          </span>
        </button>
      )}
      {file && (
        <>
          <div className="dx-file">
            <Icon name="article" />
            <span className="dx-grow dx-mono">{file.name}</span>
            {found ? (
              <span className="dx-ok">
                <Icon name="check" size={15} />
                {found.length} fields found
              </span>
            ) : (
              <span className="dx-sub" role="status">
                Reading placeholders…
              </span>
            )}
          </div>
          {found && (
            <>
              <div className="dx-chips">
                {found.map((field) => {
                  const auto =
                    field.source === "candidacy" ||
                    field.source === "interview";
                  return (
                    <span
                      key={field.key}
                      className="dx-chip dx-chip-lg"
                      data-auto={auto}
                    >
                      {`{${field.key}}`}
                      {auto && (
                        <span className="dx-chip-note">· from candidacy</span>
                      )}
                    </span>
                  );
                })}
              </div>
              <p className="dx-sub">
                Fields named like candidacy details (company, role, stage) are
                filled in for you. The model only writes the rest.
              </p>
              <label className="dx-label">
                Name
                <input
                  className="dx-input"
                  value={name}
                  maxLength={200}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <div className="dx-label">
                Kind
                <Segmented<DocumentTemplateKind>
                  label="Template kind"
                  variant="filter"
                  options={KINDS}
                  value={kind}
                  onChange={setKind}
                />
              </div>
              <label className="dx-label">
                Generation instructions
                <textarea
                  className="dx-textarea"
                  rows={4}
                  maxLength={16_000}
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                />
              </label>
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="dx-error">
          {error}
        </p>
      )}
    </Modal>
  );
}
