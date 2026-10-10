"use client";

import { Alert, Button, Flex, Typography } from "@oc-tech/omni-ui-components";
import { useCallback, useEffect, useState } from "react";
import type { StudioActions } from "../config/commands";
import { Icon } from "../icon";
import { useRefreshOnReturn } from "../work-guards";
import { DocumentEditor } from "./document-editor";
import {
  type DocumentContext,
  type DocumentListItem,
  documentJson,
  type TemplateListItem,
} from "./documents-client";
import { DocumentsList } from "./documents-list";
import { message, PageHeader, SectionTabs, useToast } from "./documents-ui";
import { NewDocumentDialog } from "./new-document-dialog";
import { TemplateLibrary } from "./template-library";

type Catalog = {
  context: DocumentContext;
  templates: TemplateListItem[];
  documents: DocumentListItem[];
};
type Tab = "documents" | "templates";
type NewInitial = { candidacyId: string | null; templateId?: string };

async function catalog(signal: AbortSignal): Promise<Catalog> {
  const [context, templates, documents] = await Promise.all([
    documentJson<DocumentContext>("/context", { signal }),
    documentJson<{ templates: TemplateListItem[] }>("/templates", { signal }),
    documentJson<{ documents: DocumentListItem[] }>("", { signal }),
  ]);
  return {
    context,
    templates: templates.templates,
    documents: documents.documents,
  };
}

const RESERVED = new Set(["new", "templates"]);

export function DocumentsView({
  rest,
  actions,
  onDirtyChange,
}: {
  rest: readonly string[];
  actions: StudioActions;
  onDirtyChange(dirty: boolean): void;
}) {
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [newInitial, setNewInitial] = useState<NewInitial | null>(null);
  const toast = useToast();
  const refreshCatalog = useCallback(
    () => setRefresh((value) => value + 1),
    [],
  );

  // What another window finished while this one was in the background shows
  // up when the person comes back.
  useRefreshOnReturn(refreshCatalog);

  useEffect(() => {
    const controller = new AbortController();
    catalog(controller.signal).then(
      (loaded) => {
        if (controller.signal.aborted) return;
        setData(loaded);
        setError("");
      },
      (cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      },
    );
    return () => controller.abort();
  }, [refresh]);

  const first = rest[0];
  const editorId = first && !RESERVED.has(first) ? first : null;
  const tab: Tab = first === "templates" ? "templates" : "documents";
  const goDocuments = () => actions.go("documents");

  const tabs = (
    <SectionTabs
      label="Documents sections"
      value={tab}
      onChange={(next) =>
        next === "templates"
          ? actions.go("documents", ["templates"])
          : goDocuments()
      }
      options={[
        { id: "documents", label: "Documents" },
        { id: "templates", label: "Templates" },
      ]}
    />
  );

  function openNew(initial: NewInitial) {
    setNewInitial(initial);
    actions.go("documents", ["new"]);
  }

  // Sizing only: the view fills the room it is given and scrolls inside.
  const fill = { height: "100%", minHeight: 0, overflow: "auto" } as const;

  if (!data)
    return (
      <Flex vertical aria-label="Documents" role="region" style={fill}>
        {error ? (
          <Alert variant="error" role="alert">
            <Flex vertical gap={8} align="start">
              <Typography.Title>Documents could not load</Typography.Title>
              <Typography.Paragraph type="secondary">
                {error}
              </Typography.Paragraph>
              <Button type="button" variant="outline" onClick={refreshCatalog}>
                Retry
              </Button>
            </Flex>
          </Alert>
        ) : (
          <Typography.Paragraph type="secondary">
            Loading documents…
          </Typography.Paragraph>
        )}
      </Flex>
    );

  return (
    <Flex vertical aria-label="Documents" role="region" style={fill}>
      {error && (
        <Alert variant="error" size="sm" role="alert">
          {error}
        </Alert>
      )}
      {editorId ? (
        <DocumentEditor
          key={editorId}
          id={editorId}
          context={data.context}
          onBack={goDocuments}
          onChanged={refreshCatalog}
          onDirtyChange={onDirtyChange}
          onStartNew={openNew}
          notify={toast.show}
        />
      ) : tab === "templates" ? (
        <TemplateLibrary
          templates={data.templates}
          documents={data.documents}
          selectedId={rest[1] ?? null}
          tabs={tabs}
          onSelect={(id) =>
            actions.go("documents", id ? ["templates", id] : ["templates"])
          }
          onChanged={refreshCatalog}
          notify={toast.show}
        />
      ) : (
        <Flex vertical gap={16} style={{ padding: 16 }}>
          <PageHeader
            title="Documents"
            description="Resumes, cover letters and prep notes, built from your experience matrix and the candidacy they’re for."
            tabs={tabs}
            action={
              <Button
                type="button"
                buttonSize="lg"
                icon={<Icon name="add" />}
                onClick={() =>
                  openNew({
                    candidacyId: data.context.candidacies[0]?.id ?? null,
                  })
                }
              >
                New document
              </Button>
            }
          />
          <DocumentsList
            documents={data.documents}
            templates={data.templates}
            context={data.context}
            onOpen={(id) => actions.go("documents", [id])}
            onNew={(candidacyId) => openNew({ candidacyId })}
          />
        </Flex>
      )}
      {first === "new" && (
        <NewDocumentDialog
          context={data.context}
          templates={data.templates}
          documents={data.documents}
          initial={
            newInitial ?? {
              candidacyId: data.context.candidacies[0]?.id ?? null,
            }
          }
          onClose={() => {
            setNewInitial(null);
            goDocuments();
          }}
          onCreated={(id) => {
            setNewInitial(null);
            refreshCatalog();
            toast.show("Generated · rev 1");
            actions.go("documents", [id]);
          }}
          onOpenExisting={(id) => {
            setNewInitial(null);
            actions.go("documents", [id]);
          }}
        />
      )}
      {toast.node}
    </Flex>
  );
}
