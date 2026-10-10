"use client";

import {
  ActionMenu,
  Alert,
  Button,
  Collapse,
  Descriptions,
  Empty,
  Flex,
  IconButton,
  List,
  ListItem,
  Panel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedPrimitive,
  Splitter,
  SplitterPanel,
  Tag,
  Toolbar,
  Typography,
} from "@oc-tech/omni-ui-components";
import { useState } from "react";
import { Icon } from "../icon";
import {
  documentBinding,
  exportMenu,
  type FieldFilter,
  type MenuSection,
  regenerateMenu,
  revisionsMenu,
  saveState,
  toolbarActions,
  type Zoom,
  zoomBy,
  zoomLabel,
} from "./document-editor-model";
import { DocumentForm } from "./document-form";
import { DocumentPreview } from "./document-preview";
import type { DocumentContext } from "./documents-client";
import { FIELD_STATE_TEXT } from "./documents-model";
import { useDocumentEditor } from "./use-document-editor";

// The editor: a composition of library parts around one controller
// (use-document-editor.ts). The fields are drawn by the form from the
// template (document-form.tsx); the toolbar and its menus from typed
// descriptors (document-editor-model.ts). Nothing here makes a request.

// Sizing only: the editor fills the room it is given.
const FILL = { flex: "1 1 0", minHeight: 0, minWidth: 0 } as const;
const COLUMN = { ...FILL, height: "100%" } as const;

// Menu rows as the library's ActionMenu reads them: the icon name is drawn.
const menuSections = (sections: readonly MenuSection[]) =>
  sections.map((section) => ({
    id: section.id,
    ...(section.label ? { label: section.label } : {}),
    items: section.items.map(({ icon, ...item }) => ({
      ...item,
      ...(icon ? { icon: <Icon name={icon} size={17} /> } : {}),
    })),
  }));

export function DocumentEditor({
  id,
  context,
  onBack,
  onChanged,
  onDirtyChange,
  onStartNew,
  notify,
}: {
  id: string;
  context: DocumentContext;
  onBack(): void;
  onChanged(): void;
  onDirtyChange(dirty: boolean): void;
  onStartNew(initial: { candidacyId: string | null; templateId: string }): void;
  notify(text: string): void;
}) {
  const editor = useDocumentEditor({
    id,
    context,
    onChanged,
    onDirtyChange,
    notify,
  });
  // Presentation only: how large the page is drawn, and the blocked popover.
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [blockedOpen, setBlockedOpen] = useState(false);
  const { detail, state, facts, commands, error } = editor;

  if (!detail || !state || !facts)
    return error ? (
      <Flex vertical gap={12} align="flex-start" role="alert">
        <Typography.Title size="compact">
          Document could not load
        </Typography.Title>
        <Typography.Paragraph>{error}</Typography.Paragraph>
        <Button variant="outline" onClick={commands.retry}>
          Retry
        </Button>
      </Flex>
    ) : (
      <Typography.Paragraph type="secondary">
        Loading document…
      </Typography.Paragraph>
    );

  const { document, template } = detail;
  const profile = context.profiles.find(
    (item) => item.id === document.profileId,
  );
  const candidacy = context.candidacies.find(
    (item) => item.id === document.candidacyId,
  );
  const interview = context.interviews.find(
    (item) => item.id === document.interviewId,
  );
  const application = candidacy
    ? `${candidacy.company_name} · ${candidacy.title}${
        interview ? ` · ${interview.label}` : ""
      }`
    : null;
  const { current, shown, older, dirty, busy, attention, blockers } = facts;
  const saved = saveState(state, facts);
  const cast = detail.review?.cast ?? null;
  const exporting = exportMenu(state, facts, editor.exports, commands);
  const staleProfile = !!profile && profile.revision > document.profileRevision;
  const filters: Array<{ value: FieldFilter; label: string }> = [
    { value: "all", label: "All fields" },
    {
      value: "attention",
      label: attention.length
        ? `Needs attention · ${attention.length}`
        : "Needs attention",
    },
  ];

  return (
    <Flex vertical style={COLUMN}>
      <Toolbar
        label="Document"
        variant="bar"
        leading={
          <Flex align="center" gap={8} style={FILL}>
            <IconButton
              variant="ghost"
              icon={<Icon name="arrow_back" />}
              label="All documents"
              onClick={onBack}
            />
            <Flex vertical style={FILL}>
              <Typography.Text>{document.title}</Typography.Text>
              <Typography.Text type="secondary" size="compact">
                {application ?? "General — no application"}
              </Typography.Text>
            </Flex>
          </Flex>
        }
        trailing={
          <Flex align="center" gap={8} wrap="wrap">
            <Tag role="status" aria-live={saved.live ? "polite" : "off"}>
              {saved.text}
            </Tag>
            <Tag aria-label="Candidate review status">
              {facts.claimState === "confirmed" && !dirty
                ? "Candidate confirmed"
                : "Draft — review model prose"}
            </Tag>
            {toolbarActions(facts, commands)
              .filter((action) => action.available)
              .map((action) => (
                <Button
                  key={action.id}
                  variant="outline"
                  disabled={action.disabled}
                  onClick={action.run}
                >
                  {action.label}
                </Button>
              ))}
            <ActionMenu
              label="Revisions"
              width={360}
              align="end"
              onOpenChange={editor.setRevisionsOpen}
              sections={menuSections(
                revisionsMenu(
                  facts,
                  editor.revisions,
                  editor.exports,
                  commands,
                ),
              )}
              trigger={
                <Button
                  variant="outline"
                  icon={<Icon name="history" size={17} />}
                  iconAfter={<Icon name="expand_more" size={16} />}
                >
                  Rev {shown}
                </Button>
              }
            />
            <ActionMenu
              label="Regenerate"
              width={360}
              align="end"
              sections={menuSections(
                regenerateMenu(facts, editor.model, commands),
              )}
              trigger={
                <Button
                  variant="outline"
                  disabled={busy || !facts.canRegenerate}
                  icon={<Icon name="auto_awesome" size={17} />}
                >
                  Regenerate
                </Button>
              }
            />
            {blockers.length > 0 ? (
              // Blocked: Export is disabled, and the popover on it says why,
              // with each field it names a link to that field. The library
              // disables a button by taking pointer events from it, so a
              // wrapper is what the popover opens from (a library need:
              // a disabled Button that can still open a Popover).
              <Popover open={blockedOpen} onOpenChange={setBlockedOpen}>
                <PopoverTrigger asChild>
                  {/* biome-ignore lint/a11y/useSemanticElements: it wraps the disabled Export button, and a button cannot hold a button */}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="Export is blocked: see why"
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setBlockedOpen(true);
                    }}
                  >
                    <Button
                      variant="default"
                      disabled
                      icon={<Icon name="download" size={17} />}
                    >
                      Export
                    </Button>
                  </span>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  aria-label="Why export is blocked"
                  // A link in here moves focus to its field: closing must
                  // not take focus back to the Export control.
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  <Typography.Paragraph>
                    Export is blocked: {blockers.length}{" "}
                    {blockers.length === 1 ? "field says" : "fields say"}{" "}
                    something your experience matrix does not. Regenerate or
                    edit each one, or confirm it yourself.
                  </Typography.Paragraph>
                  <List>
                    {blockers.map((blocker) => (
                      <ListItem key={blocker.key}>
                        <Button
                          variant="link"
                          onClick={() => {
                            setBlockedOpen(false);
                            commands.selectField(blocker.key);
                          }}
                        >
                          {blocker.label}
                        </Button>
                        {/* The first few reasons; the field lists them all. */}
                        {blocker.reasons.slice(0, 3).map((reason) => (
                          <Typography.Paragraph
                            key={reason}
                            type="secondary"
                            size="compact"
                          >
                            {reason}
                          </Typography.Paragraph>
                        ))}
                        {blocker.reasons.length > 3 && (
                          <Typography.Paragraph type="secondary" size="compact">
                            and {blocker.reasons.length - 3} more, listed on the
                            field.
                          </Typography.Paragraph>
                        )}
                        {editor.views[blocker.key]?.regenerable && (
                          <Button
                            variant="outline"
                            buttonSize="sm"
                            disabled={busy}
                            onClick={() => {
                              setBlockedOpen(false);
                              commands.regenerateField(blocker.key);
                            }}
                          >
                            Regenerate {blocker.label}
                          </Button>
                        )}
                      </ListItem>
                    ))}
                  </List>
                </PopoverContent>
              </Popover>
            ) : (
              <ActionMenu
                label="Export"
                width={360}
                align="end"
                {...(exporting.warning
                  ? {
                      notice: { tone: "warning", ...exporting.warning },
                    }
                  : {})}
                sections={menuSections(exporting.sections)}
                trigger={
                  <Button
                    variant="default"
                    disabled={busy}
                    icon={<Icon name="download" size={17} />}
                  >
                    Export
                  </Button>
                }
              />
            )}
          </Flex>
        }
      />

      {error && (
        <Alert variant="error" size="sm" role="alert">
          {error}
        </Alert>
      )}

      <Splitter resizable style={FILL}>
        {!editor.fieldsHidden && (
          <SplitterPanel
            id="fields"
            label="the fields"
            defaultSize={520}
            minSize={320}
          >
            <Panel
              title="Document fields"
              bodyPadding="sm"
              scroll={{ thinScrollbar: true }}
            >
              <Flex vertical gap={12}>
                <Descriptions
                  bordered={false}
                  size="small"
                  columns={1}
                  items={[
                    {
                      label: "Template",
                      children: `${template.name} · rev ${document.templateRevision}`,
                    },
                    {
                      label: "Experience",
                      children: `${profile?.name ?? "Experience matrix"} · rev ${document.profileRevision}`,
                    },
                    {
                      label: "Application",
                      children: application ?? "None — general",
                    },
                  ]}
                />
                {staleProfile && profile && (
                  <Alert variant="info" size="sm" role="status">
                    <Flex align="center" gap={8} wrap="wrap">
                      <Typography.Text size="compact">
                        Your experience matrix has a newer revision (rev{" "}
                        {profile.revision}). This document keeps rev{" "}
                        {document.profileRevision}.
                      </Typography.Text>
                      <Button
                        buttonSize="sm"
                        onClick={() =>
                          onStartNew({
                            candidacyId: document.candidacyId,
                            templateId: document.templateId,
                          })
                        }
                      >
                        New with rev {profile.revision}
                      </Button>
                    </Flex>
                  </Alert>
                )}

                {facts.generating ? (
                  <Alert
                    variant="loading"
                    role="status"
                    title={
                      editor.working === "all"
                        ? "Regenerating every field"
                        : "Fixing fields that need attention"
                    }
                  >
                    <Flex vertical gap={8} align="flex-start">
                      <Typography.Text size="compact">
                        A few parallel calls fill the fields written from your
                        experience. You can edit anything once it’s done, and
                        each change is saved as a new revision.
                      </Typography.Text>
                      <Button
                        variant="outline"
                        buttonSize="sm"
                        onClick={commands.cancel}
                      >
                        Cancel
                      </Button>
                    </Flex>
                  </Alert>
                ) : (
                  <>
                    {older && (
                      <Alert variant="info" size="sm" role="status">
                        <Flex align="center" gap={8} wrap="wrap">
                          <Typography.Text size="compact">
                            Viewing rev {shown} of {current}. Read-only.
                          </Typography.Text>
                          <Button
                            variant="outline"
                            buttonSize="sm"
                            onClick={commands.latest}
                          >
                            Latest
                          </Button>
                          <Button
                            buttonSize="sm"
                            disabled={busy}
                            onClick={commands.restore}
                          >
                            Restore as rev {current + 1}
                          </Button>
                        </Flex>
                      </Alert>
                    )}
                    <Flex align="center" justify="space-between" gap={8}>
                      <SegmentedPrimitive
                        aria-label="Show fields"
                        appearance="control"
                        value={editor.filter}
                        onChange={(next) => {
                          // Pressing the chosen filter again keeps it.
                          if (next) editor.setFilter(next as FieldFilter);
                        }}
                        options={filters}
                      />
                      <Typography.Text
                        size="compact"
                        type={attention.length ? "warning" : "success"}
                      >
                        {attention.length
                          ? `${attention.length} / ${facts.applies.length} need attention`
                          : `All ${facts.applies.length} valid`}
                      </Typography.Text>
                    </Flex>
                    {cast && cast.leftOut.length > 0 && !older && (
                      <Alert
                        variant="info"
                        size="sm"
                        title={`Left out: ${cast.leftOut
                          .map((role) => role.company)
                          .join(", ")}`}
                      >
                        <Typography.Paragraph size="compact">
                          {cast.consultancy ?? "Your consultancy"} has{" "}
                          {cast.contracts.length + cast.leftOut.length} clients
                          and this template has {cast.contracts.length} contract
                          blocks.{" "}
                          {cast.ranking === "model"
                            ? "The most relevant to the posting were chosen."
                            : "The most recent were chosen."}{" "}
                          A client left out is not written anywhere in the
                          document. Swapping one in rewrites that block from its
                          own record.
                        </Typography.Paragraph>
                        {facts.canRegenerate &&
                          !dirty &&
                          cast.leftOut.flatMap((out) =>
                            cast.contracts.map((held) => (
                              <Button
                                key={`${out.id}:${held.block}`}
                                variant="outline"
                                buttonSize="sm"
                                disabled={busy}
                                onClick={() => commands.swap(held.block, out)}
                              >
                                Swap {out.company} in for {held.company}
                              </Button>
                            )),
                          )}
                      </Alert>
                    )}
                    <DocumentForm
                      fields={detail.fields}
                      values={editor.values}
                      binding={documentBinding(detail)}
                      readOnly={older}
                      hidden={editor.hidden}
                      collapsed={editor.collapsed}
                      epoch={editor.epoch}
                      views={editor.views}
                      busy={busy}
                      onChange={editor.edit}
                      actions={editor.formActions}
                    />
                    {editor.filter === "all" &&
                      facts.notApplying.length > 0 && (
                        <Collapse
                          size="small"
                          items={[
                            {
                              key: "does-not-apply",
                              label: `${FIELD_STATE_TEXT["does-not-apply"].title} · ${facts.notApplying.length} ${
                                facts.notApplying.length === 1
                                  ? "field"
                                  : "fields"
                              }`,
                              description:
                                FIELD_STATE_TEXT["does-not-apply"].body,
                              children: (
                                <List>
                                  {facts.notApplying.map((field) => (
                                    <ListItem key={field.key}>
                                      {field.label}
                                    </ListItem>
                                  ))}
                                </List>
                              ),
                            },
                          ]}
                        />
                      )}
                    {editor.filter === "attention" &&
                      attention.length === 0 && (
                        <Empty
                          variant="tile"
                          icon={<Icon name="task_alt" />}
                          title="Nothing needs attention"
                          description="Every required field is filled and within its length."
                        />
                      )}
                  </>
                )}
              </Flex>
            </Panel>
          </SplitterPanel>
        )}
        <SplitterPanel id="preview" minSize={320}>
          <Panel
            title="Live preview · click any text to edit it"
            meta={
              <Tag mono>
                {template.name}.{template.format}
              </Tag>
            }
            actions={
              <Flex align="center" gap={4} role="toolbar" aria-label="Preview">
                <IconButton
                  variant="ghost"
                  iconSize="sm"
                  icon={<Icon name="zoom_out" />}
                  label="Zoom out"
                  onClick={() => setZoom(zoomBy(zoom, -1))}
                />
                <Typography.Text size="compact">
                  {zoomLabel(zoom)}
                </Typography.Text>
                <IconButton
                  variant="ghost"
                  iconSize="sm"
                  icon={<Icon name="zoom_in" />}
                  label="Zoom in"
                  onClick={() => setZoom(zoomBy(zoom, 1))}
                />
                <IconButton
                  variant="ghost"
                  iconSize="sm"
                  icon={<Icon name="fit_screen" />}
                  label="Fit to width"
                  onClick={() => setZoom("fit")}
                />
                <IconButton
                  variant="ghost"
                  iconSize="sm"
                  pressed={editor.fieldsHidden}
                  icon={
                    <Icon
                      name={
                        editor.fieldsHidden
                          ? "left_panel_open"
                          : "left_panel_close"
                      }
                    />
                  }
                  label={
                    editor.fieldsHidden
                      ? "Show fields"
                      : "Focus on the document"
                  }
                  onClick={() => editor.setFieldsHidden(!editor.fieldsHidden)}
                />
              </Flex>
            }
          >
            <DocumentPreview
              preview={editor.preview}
              fields={detail.fields}
              selected={editor.focused}
              onSelect={commands.selectField}
              zoom={zoom}
            />
          </Panel>
        </SplitterPanel>
      </Splitter>
    </Flex>
  );
}
