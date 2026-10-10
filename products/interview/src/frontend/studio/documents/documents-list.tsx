"use client";

import {
  Button,
  Empty,
  Flex,
  List,
  ListItem,
  Panel,
  Tag,
  Typography,
} from "@oc-tech/omni-ui-components";
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
    <Flex vertical gap={16}>
      {groupDocuments(documents, context).map((group) => (
        <Panel
          key={group.id}
          title={group.title}
          subtitle={group.sub}
          meta={<Tag mono>{group.mono}</Tag>}
          actions={
            <Button
              type="button"
              variant="outline"
              buttonSize="sm"
              aria-label={`Add document to ${group.title}`}
              icon={<Icon name="add" size={17} />}
              onClick={() => onNew(group.candidacyId)}
            >
              Add
            </Button>
          }
        >
          {group.documents.length === 0 ? (
            <Empty
              size="compact"
              description={
                group.candidacyId
                  ? "No documents yet."
                  : "A general resume is useful for recruiters who reach out first."
              }
            />
          ) : (
            <List>
              {group.documents.map((item) => {
                const template = templateOf(item);
                const status = documentStatus(item);
                return (
                  <ListItem key={item.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onOpen(item.id)}
                    >
                      <Icon
                        name={template ? KIND_ICON[template.kind] : "draft"}
                        size={20}
                      />
                      <Flex vertical>
                        <Typography.Text>{item.title}</Typography.Text>
                        <Typography.Text type="secondary" size="compact">
                          {template?.name ?? "Template"} · rev{" "}
                          {item.currentRevision} · updated{" "}
                          {relativeTime(item.updatedAt)}
                        </Typography.Text>
                      </Flex>
                      <Tag
                        color={
                          status.tone === "ready"
                            ? "var(--oui-tone-success-fg)"
                            : "var(--oui-tone-warning-fg)"
                        }
                      >
                        {status.label}
                      </Tag>
                      <Icon name="chevron_right" />
                    </Button>
                  </ListItem>
                );
              })}
            </List>
          )}
        </Panel>
      ))}
    </Flex>
  );
}
