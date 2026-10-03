"use client";

import { Icon } from "../icon";
import type {
  DocumentContext,
  DocumentListItem,
  TemplateListItem,
} from "./documents-client";
import {
  documentStatus,
  groupDocuments,
  KIND_ICON,
  relativeTime,
} from "./documents-model";

export function DocumentsList({
  documents,
  templates,
  context,
  onOpen,
  onNew,
}: {
  documents: readonly DocumentListItem[];
  templates: readonly TemplateListItem[];
  context: DocumentContext;
  onOpen(id: string): void;
  onNew(candidacyId: string | null): void;
}) {
  const templateOf = (item: DocumentListItem) =>
    templates.find((entry) => entry.template.id === item.templateId)?.template;
  return (
    <>
      {groupDocuments(documents, context).map((group) => (
        <section key={group.id} className="dx-card" aria-label={group.title}>
          <div className="dx-group-head">
            <span
              className="dx-mono-tile"
              data-tone={group.candidacyId ? "accent" : "plain"}
            >
              {group.mono}
            </span>
            <div className="dx-grow">
              <div className="dx-group-title">{group.title}</div>
              <div className="dx-sub">{group.sub}</div>
            </div>
            <button
              type="button"
              className="dx-button dx-button-sm"
              aria-label={`Add document to ${group.title}`}
              onClick={() => onNew(group.candidacyId)}
            >
              <Icon name="add" size={17} />
              Add
            </button>
          </div>
          {group.documents.map((item) => {
            const template = templateOf(item);
            const status = documentStatus(item);
            return (
              <button
                key={item.id}
                type="button"
                className="dx-doc-row"
                onClick={() => onOpen(item.id)}
              >
                <Icon
                  name={template ? KIND_ICON[template.kind] : "draft"}
                  size={20}
                />
                <span className="dx-grow">
                  <span className="dx-row-title">{item.title}</span>
                  <span className="dx-sub">
                    {template?.name ?? "Template"} · rev {item.currentRevision}{" "}
                    · updated {relativeTime(item.updatedAt)}
                  </span>
                </span>
                <span className="dx-pill" data-tone={status.tone}>
                  {status.label}
                </span>
                <Icon name="chevron_right" />
              </button>
            );
          })}
          {group.documents.length === 0 && (
            <div className="dx-empty-row">
              {group.candidacyId
                ? "No documents yet."
                : "A general resume is useful for recruiters who reach out first."}
            </div>
          )}
        </section>
      ))}
    </>
  );
}
