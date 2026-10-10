"use client";

import {
  Alert,
  Button,
  Empty,
  FileUpload,
  Flex,
  IconButton,
  Input,
  Panel,
  SegmentedPrimitive,
  Table,
  Tag,
  Textarea,
  Typography,
} from "@oc-tech/omni-ui-components";
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
import { Actions, Modal, message, PageHeader } from "./documents-ui";

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
    <Flex style={{ height: "100%", minHeight: 0 }}>
      <Flex
        vertical
        gap={16}
        style={{ flex: "1 1 0", minWidth: 0, padding: 16, overflow: "auto" }}
      >
        <PageHeader
          title="Documents"
          description="A template is a .docx or .md file with {placeholders}. The fields are read from it, so there’s no schema to maintain."
          tabs={tabs}
          action={
            <Button
              type="button"
              variant="outline"
              buttonSize="lg"
              icon={<Icon name="upload" />}
              onClick={() => setUploading(true)}
            >
              Upload template
            </Button>
          }
        />
        {templates.length === 0 ? (
          <Empty description="No templates yet. Upload a .docx or .md file to add one." />
        ) : (
          <Table<TemplateListItem>
            aria-label="Templates"
            pagination={false}
            rowKey={(item) => item.template.id}
            dataSource={[...templates]}
            columns={[
              {
                key: "template",
                title: "TEMPLATE",
                render: (_, item) => (
                  <Flex align="center" gap={8}>
                    <Icon name={KIND_ICON[item.template.kind]} size={20} />
                    <Flex vertical>
                      <Typography.Text>{item.template.name}</Typography.Text>
                      <Typography.Text type="secondary" size="compact">
                        {item.template.ownerUserId ? "You" : "Built-in"} · rev{" "}
                        {item.latestRevision}
                      </Typography.Text>
                    </Flex>
                  </Flex>
                ),
              },
              {
                key: "kind",
                title: "KIND",
                render: (_, item) => (
                  <Typography.Text type="secondary">
                    {KIND_LABEL[item.template.kind]}
                  </Typography.Text>
                ),
              },
              {
                key: "format",
                title: "FORMAT",
                render: (_, item) => (
                  <Typography.Text type="secondary">
                    {item.template.format.toUpperCase()}
                  </Typography.Text>
                ),
              },
              {
                key: "fields",
                title: "FIELDS",
                render: (_, item) => (
                  <Typography.Text>{item.fieldCount}</Typography.Text>
                ),
              },
              {
                key: "used",
                title: "USED BY",
                render: (_, item) => {
                  const used = templateUsage(documents, item);
                  return (
                    <Typography.Text type="secondary">
                      {used ? `${used} doc${used > 1 ? "s" : ""}` : "—"}
                    </Typography.Text>
                  );
                },
              },
            ]}
            onRow={(item) => ({
              onClick: () => onSelect(item.template.id),
              "aria-selected": item.template.id === selectedId,
            })}
          />
        )}
      </Flex>
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
    </Flex>
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
    <Panel
      as="aside"
      title={template.name}
      aria-label={`${template.name} details`}
      width={420}
      bodyPadding="md"
      actions={
        <IconButton
          variant="ghost"
          icon={<Icon name="close" />}
          label="Close details"
          onClick={onClose}
        />
      }
    >
      <Flex vertical gap={20}>
        <Flex vertical gap={8} align="start">
          <Typography.Text type="secondary" size="compact">
            SOURCE FILE
          </Typography.Text>
          <Flex align="center" gap={8}>
            <Icon name={KIND_ICON[template.kind]} />
            <Flex vertical>
              <Typography.Text>
                {template.format.toUpperCase()} source
              </Typography.Text>
              <Typography.Text type="secondary" size="compact">
                Rev {latestRevision}
                {item.revisions[0]
                  ? ` · ${relativeTime(item.revisions[0].createdAt)}`
                  : ""}{" "}
                · stored as an artifact
              </Typography.Text>
            </Flex>
          </Flex>
          {mine ? (
            <>
              <Button
                type="button"
                variant="outline"
                buttonSize="sm"
                icon={<Icon name="upload" size={16} />}
                disabled={busy || !detail}
                onClick={() => picker.current?.click()}
              >
                Upload new version
              </Button>
              {/* The library has no compact file-picker button: the hidden input stays. */}
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
            <Alert variant="info" size="sm">
              <Flex align="center" gap={8} wrap="wrap">
                <Typography.Text size="compact">
                  Built-in templates are read-only.
                </Typography.Text>
                <Actions
                  actions={[
                    {
                      id: "duplicate",
                      label: "Duplicate to customize",
                      size: "sm",
                      disabled: busy,
                      onClick: () =>
                        void run(async () => {
                          const copy = await postJson<{
                            template: { id: string };
                          }>(
                            `/templates/${encodeURIComponent(template.id)}/duplicate`,
                            { name: `${template.name} (copy)` },
                          );
                          onChanged();
                          onSelect(copy.template.id);
                          notify("Duplicated — you can edit this one");
                        }),
                    },
                  ]}
                />
              </Flex>
            </Alert>
          )}
        </Flex>

        <Flex vertical gap={8}>
          <Flex justify="space-between">
            <Typography.Text type="secondary" size="compact">
              FIELDS READ FROM THE FILE
            </Typography.Text>
            <Typography.Text type="secondary" size="compact">
              {detail?.fields.length ?? item.fieldCount} fields
            </Typography.Text>
          </Flex>
          {groupFields(detail?.fields ?? []).map((group) => (
            <Flex key={group.id} vertical gap={4}>
              <Flex justify="space-between">
                <Typography.Text>{group.title}</Typography.Text>
                <Typography.Text type="secondary" size="compact">
                  {group.fields.length}
                </Typography.Text>
              </Flex>
              <Flex wrap="wrap" gap={4}>
                {group.fields.map((field) => (
                  <Tag key={field.key} mono>
                    {`{${field.key}}`}
                  </Tag>
                ))}
              </Flex>
            </Flex>
          ))}
        </Flex>

        <Flex vertical gap={8}>
          <Textarea
            label="GENERATION INSTRUCTIONS"
            rows={9}
            maxLength={16_000}
            value={draft}
            readOnly={!mine}
            onChange={setInstructions}
          />
          <Flex align="center" gap={8} justify="space-between">
            <Typography.Text type="secondary" size="compact">
              {mine
                ? "Changes create a new template revision. Existing documents keep the revision they were built from."
                : "Sent with the field list to the model, a few calls at a time."}
            </Typography.Text>
            {dirty && (
              <Actions
                actions={[
                  {
                    id: "save",
                    label: `Save as rev ${current + 1}`,
                    variant: "default",
                    size: "sm",
                    disabled: busy,
                    onClick: () =>
                      void run(async () => {
                        await postJson(
                          `/templates/${encodeURIComponent(template.id)}/instructions`,
                          { expectedRevision: current, instructions: draft },
                        );
                        setInstructions(null);
                        onChanged();
                        notify(`${template.name} saved as rev ${current + 1}`);
                      }),
                  },
                ]}
              />
            )}
          </Flex>
        </Flex>

        <Flex vertical gap={8}>
          <Typography.Text type="secondary" size="compact">
            REVISIONS
          </Typography.Text>
          {item.revisions.map((entry) => (
            <Flex key={entry.revision} align="center" gap={8}>
              <Typography.Text type="secondary" size="compact">
                rev {entry.revision}
              </Typography.Text>
              <Typography.Text style={{ flex: 1 }}>
                {entry.revision === latestRevision ? "Current" : "Earlier"}
              </Typography.Text>
              <Typography.Text type="secondary" size="compact">
                {relativeTime(entry.createdAt)}
              </Typography.Text>
            </Flex>
          ))}
        </Flex>
        {error && (
          <Alert variant="error" size="sm" role="alert">
            {error}
          </Alert>
        )}
      </Flex>
    </Panel>
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
    // No file means the picker refused one and has already said why
    // (`onError`): that message stays.
    if (!next) return;
    setError("");
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
        <Actions
          actions={[
            { id: "cancel", label: "Cancel", onClick: onClose },
            {
              id: "save",
              label: "Save template",
              variant: "default",
              disabled: busy || !found,
              onClick: () => void save(),
            },
          ]}
        />
      }
    >
      {!file && (
        <FileUpload
          aria-label="Template file"
          accept=".docx,.md"
          value={null}
          onChange={(files) => void choose(files[0])}
          onError={() => setError("Choose a .docx or .md file.")}
        />
      )}
      {file && (
        <>
          <Flex align="center" gap={8}>
            <Icon name="article" />
            <Typography.Text style={{ flex: 1 }}>{file.name}</Typography.Text>
            {found ? (
              <Typography.Text type="success" size="compact">
                <Icon name="check" size={15} />
                {found.length} fields found
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary" size="compact" role="status">
                Reading placeholders…
              </Typography.Text>
            )}
          </Flex>
          {found && (
            <>
              <Flex wrap="wrap" gap={4}>
                {found.map((field) => {
                  const auto =
                    field.source === "candidacy" ||
                    field.source === "interview";
                  return (
                    <Tag key={field.key} mono>
                      {`{${field.key}}`}
                      {auto ? " · from candidacy" : ""}
                    </Tag>
                  );
                })}
              </Flex>
              <Typography.Paragraph type="secondary" size="compact">
                Fields named like candidacy details (company, role, stage) are
                filled in for you. The model only writes the rest.
              </Typography.Paragraph>
              <Input
                label="Name"
                value={name}
                maxLength={200}
                onChange={setName}
              />
              <SegmentedPrimitive
                aria-label="Template kind"
                options={KINDS.map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                }))}
                value={kind}
                onChange={(next) => setKind(next as DocumentTemplateKind)}
              />
              <Textarea
                label="Generation instructions"
                rows={4}
                maxLength={16_000}
                value={instructions}
                onChange={setInstructions}
              />
            </>
          )}
        </>
      )}
      {error && (
        <Alert variant="error" size="sm" role="alert">
          {error}
        </Alert>
      )}
    </Modal>
  );
}
