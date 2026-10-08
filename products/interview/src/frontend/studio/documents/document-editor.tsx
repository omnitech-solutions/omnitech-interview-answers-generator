"use client";

import type {
  DocumentFieldError,
  DocumentFormat,
} from "@omnitech/interview-contracts";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../icon";
import { documentTarget } from "./assistant-model";
import { DocumentPreview, type PreviewPayload } from "./document-preview";
import {
  type DocumentContext,
  type DocumentDetail,
  type DocumentExport,
  documentJson,
  downloadExport,
  postJson,
} from "./documents-client";
import {
  groupFields,
  groupIdOf,
  issueFor,
  type Provenance,
  relativeTime,
  revisionNote,
} from "./documents-model";
import { IconButton, message, Segmented, Spinner } from "./documents-ui";

const MAX_LISTED_REVISIONS = 20;

const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5];
const zoomBy = (zoom: "fit" | number, step: 1 | -1) =>
  zoom === "fit"
    ? step > 0
      ? 1
      : 0.67
    : (ZOOMS[
        Math.min(
          ZOOMS.length - 1,
          Math.max(0, ZOOMS.findIndex((item) => item >= zoom - 0.001) + step),
        )
      ] ?? 1);

const payloadOf = (value: PreviewPayload): PreviewPayload =>
  value.kind === "docx"
    ? { kind: "docx", docx: value.docx }
    : { kind: "html", html: value.html };

type Menu = "revs" | "regen" | "export" | null;
type Working =
  | "save"
  | "all"
  | "fix"
  | "field"
  | "export"
  | "confirm"
  | "refresh"
  | null;
type Filter = "all" | "attention";
type RevisionEntry = { note: string; createdAt: string };

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
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [draftValidation, setDraftValidation] = useState<
    DocumentFieldError[] | null
  >(null);
  const [exports, setExports] = useState<DocumentExport[]>([]);
  const [revisions, setRevisions] = useState<Record<number, RevisionEntry>>({});
  const [menu, setMenu] = useState<Menu>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [focused, setFocused] = useState<string | null>(null);
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [focus, setFocus] = useState(false);
  const [working, setWorking] = useState<Working>(null);
  const [workingField, setWorkingField] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  // Regeneration follows whichever model the assistant has chosen right now.
  const resolution = documentTarget(context.targets);
  const targetId = resolution.target?.id ?? "";

  const current = detail?.document.currentRevision ?? 0;
  const shown = detail?.revision.revision ?? 0;
  const older = !!detail && shown !== current;
  const dirty =
    !!detail &&
    !older &&
    JSON.stringify(values) !== JSON.stringify(detail.revision.values);
  const validation = draftValidation ?? detail?.revision.validation ?? [];
  const claimState =
    detail?.revision.provenance.claimState === "confirmed"
      ? "confirmed"
      : "unverified";

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => pending.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    const query = selectedRevision ? `?revision=${selectedRevision}` : "";
    Promise.all([
      documentJson<DocumentDetail>(`/${encodeURIComponent(id)}${query}`, {
        signal: controller.signal,
      }),
      documentJson<PreviewPayload>(
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
        setValues(loaded.revision.values);
        setPreview(payloadOf(rendered));
        setExports(history.exports);
        setDraftValidation(null);
        setError("");
        // A long template opens on what needs doing: sections with a problem,
        // and the first.
        setCollapsed((before) => {
          if (Object.keys(before).length || loaded.fields.length <= 24)
            return before;
          const open = new Set(
            loaded.revision.validation
              .map(
                (issue) =>
                  loaded.fields.find((field) => field.key === issue.key) ??
                  null,
              )
              .filter((field) => field !== null)
              .map(groupIdOf),
          );
          const groups = groupFields(loaded.fields);
          return Object.fromEntries(
            groups.map((group, index) => [
              group.id,
              index !== 0 && !open.has(group.id),
            ]),
          );
        });
      },
      (cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      },
    );
    return () => controller.abort();
  }, [id, selectedRevision, refresh]);

  // Preview drafts without writing a revision; saved revisions use their own preview.
  useEffect(() => {
    if (!detail || !dirty || older) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      postJson<PreviewPayload & { validation: DocumentFieldError[] }>(
        `/${encodeURIComponent(id)}/preview`,
        { baseRevision: current, values },
        controller.signal,
      ).then(
        (result) => {
          if (controller.signal.aborted) return;
          setPreview(payloadOf(result));
          setDraftValidation(result.validation);
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

  // The revisions menu describes each revision, so read them when it opens.
  useEffect(() => {
    if (menu !== "revs" || !detail) return;
    const wanted = Array.from(
      { length: Math.min(current, MAX_LISTED_REVISIONS) },
      (_, index) => current - index,
    ).filter((revision) => !revisions[revision]);
    if (!wanted.length) return;
    const controller = new AbortController();
    Promise.all(
      wanted.map((revision) =>
        documentJson<DocumentDetail>(
          `/${encodeURIComponent(id)}?revision=${revision}`,
          { signal: controller.signal },
        ).then((item): [number, RevisionEntry] => [
          revision,
          {
            note: revisionNote(
              item.revision.provenance as Provenance,
              detail.fields,
            ),
            createdAt: item.revision.createdAt,
          },
        ]),
      ),
    ).then(
      (entries) => {
        if (controller.signal.aborted) return;
        setRevisions((before) => ({
          ...before,
          ...Object.fromEntries(entries),
        }));
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [menu, detail, current, id, revisions]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => {
      if (!bar.current?.contains(event.target as Node)) setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  async function mutate(
    kind: Exclude<Working, null>,
    path: string,
    body: unknown,
    saved: string,
    field?: string,
  ) {
    const controller = new AbortController();
    pending.current = controller;
    setWorking(kind);
    setWorkingField(field ?? null);
    setMenu(null);
    setError("");
    try {
      await postJson(path, body, controller.signal);
      setSelectedRevision(null);
      setRefresh((value) => value + 1);
      onChanged();
      notify(saved);
    } catch (cause) {
      if (controller.signal.aborted) {
        notify(`Cancelled — kept rev ${current}`);
      } else setError(message(cause));
    } finally {
      if (pending.current === controller) pending.current = null;
      setWorking(null);
      setWorkingField(null);
    }
  }

  const base = `/${encodeURIComponent(id)}`;
  // Leaving a field saves it as a revision: every change is kept.
  function commit() {
    if (!dirty || working) return;
    void mutate(
      "save",
      `${base}/revisions`,
      { baseRevision: current, values },
      `Saved as rev ${current + 1}`,
    );
  }

  // Clicking text in the preview opens its field: group, filter and focus.
  function selectField(key: string) {
    const field = detail?.fields.find((item) => item.key === key);
    if (!field) return;
    setFilter("all");
    setFocus(false);
    setCollapsed((before) => ({ ...before, [groupIdOf(field)]: false }));
    setFocused(key);
    requestAnimationFrame(() => {
      const input = document.getElementById(`document-field-${key}`);
      input?.scrollIntoView({ block: "center", behavior: "smooth" });
      input?.focus({ preventScroll: true });
    });
  }

  async function makeExport(format: DocumentFormat) {
    if (!detail) return;
    setWorking("export");
    setMenu(null);
    setError("");
    try {
      const record = await postJson<DocumentExport>(`${base}/exports`, {
        revision: shown,
        format,
      });
      setExports((list) => [record, ...list]);
      await downloadExport(id, record, detail.document.title);
      notify(`Exported rev ${shown} as ${format.toUpperCase()}`);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setWorking(null);
    }
  }

  if (!detail)
    return (
      <div className="dx-scroll">
        <div className="dx-page">
          {error ? (
            <div role="alert" className="dx-error">
              <h1>Document could not load</h1>
              <p>{error}</p>
              <button
                type="button"
                className="dx-button"
                onClick={() => setRefresh((value) => value + 1)}
              >
                Retry
              </button>
            </div>
          ) : (
            <p className="dx-muted">Loading document…</p>
          )}
        </div>
      </div>
    );

  const profile = context.profiles.find(
    (item) => item.id === detail.document.profileId,
  );
  const candidacy = context.candidacies.find(
    (item) => item.id === detail.document.candidacyId,
  );
  const interview = context.interviews.find(
    (item) => item.id === detail.document.interviewId,
  );
  const attention = detail.fields.filter((field) =>
    issueFor(validation, field.key),
  );
  const modelOwnedKeys = new Set(
    detail.revision.provenance.modelOwnedKeys ?? [],
  );
  const fixable = attention.filter((field) => modelOwnedKeys.has(field.key));
  const generating = working === "all" || working === "fix";
  const busy = working !== null;
  const canRegenerate = !older && !!targetId && modelOwnedKeys.size > 0;
  const exportFormats: Array<{
    format: DocumentFormat;
    label: string;
    sub: string;
    icon: IconName;
  }> = [
    ...(detail.template.format === "docx"
      ? [
          {
            format: "docx" as const,
            label: "Word document",
            sub: "Uses the template’s layout and fonts",
            icon: "description" as const,
          },
        ]
      : []),
    {
      format: "md",
      label: "Markdown",
      sub:
        detail.template.format === "md"
          ? "The template’s own format"
          : "Plain text with headings",
      icon: "code",
    },
  ];
  const saveState = working
    ? {
        icon: "refresh" as const,
        text:
          working === "save"
            ? "Saving…"
            : working === "export"
              ? "Exporting…"
              : "Regenerating…",
        live: true,
      }
    : dirty
      ? { icon: "edit" as const, text: "Editing…", live: true }
      : older
        ? {
            icon: "history" as const,
            text: `Viewing rev ${shown}`,
            live: false,
          }
        : {
            icon: "cloud_done" as const,
            text: `Saved · rev ${current}`,
            live: false,
          };
  const staleProfile =
    !!profile && profile.revision > detail.document.profileRevision;

  return (
    <div className="dx-editor">
      <div className="dx-topbar" ref={bar}>
        <IconButton icon="arrow_back" label="All documents" onClick={onBack} />
        <div className="dx-grow dx-topbar-title">
          <div className="dx-ellipsis dx-row-title">
            {detail.document.title}
          </div>
          <div className="dx-ellipsis dx-sub">
            {candidacy
              ? `${candidacy.company_name} · ${candidacy.title}`
              : "General — no application"}
            {interview ? ` · ${interview.label}` : ""}
          </div>
        </div>
        <span className="dx-save" data-live={saveState.live} role="status">
          <Icon name={saveState.icon} size={16} />
          {saveState.text}
        </span>
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the label names this part for assistive technology; the role it would need changes the accessibility tree, so it waits for an accessibility pass */}
        <span className="dx-save" aria-label="Candidate review status">
          {claimState === "confirmed" && !dirty
            ? "Candidate confirmed"
            : "Draft — review model prose"}
        </span>
        {!older && !dirty && claimState !== "confirmed" && (
          <button
            type="button"
            className="dx-button"
            disabled={busy}
            onClick={() =>
              void mutate(
                "confirm",
                `${base}/confirm`,
                { baseRevision: current },
                `Confirmed as rev ${current + 1}`,
              )
            }
          >
            Confirm reviewed
          </button>
        )}
        {!older && !dirty && (
          <button
            type="button"
            className="dx-button"
            disabled={busy}
            onClick={() =>
              void mutate(
                "refresh",
                `${base}/refresh-sources`,
                { baseRevision: current },
                `Refreshed source facts as rev ${current + 1}`,
              )
            }
          >
            Refresh source facts
          </button>
        )}
        <button
          type="button"
          className="dx-button"
          aria-haspopup="menu"
          aria-expanded={menu === "revs"}
          data-active={older}
          onClick={() => setMenu(menu === "revs" ? null : "revs")}
        >
          <Icon name="history" size={17} />
          Rev {shown}
          <Icon name="expand_more" size={16} />
        </button>
        <button
          type="button"
          className="dx-button"
          aria-haspopup="menu"
          aria-expanded={menu === "regen"}
          disabled={busy || !canRegenerate}
          onClick={() => setMenu(menu === "regen" ? null : "regen")}
        >
          <Icon name="auto_awesome" size={17} />
          Regenerate
        </button>
        <button
          type="button"
          className="dx-button dx-button-primary"
          aria-haspopup="menu"
          aria-expanded={menu === "export"}
          disabled={busy}
          onClick={() => setMenu(menu === "export" ? null : "export")}
        >
          <Icon name="download" size={17} />
          Export
        </button>

        {menu === "revs" && (
          <div className="dx-menu dx-menu-revs" role="menu">
            <div className="dx-eyebrow dx-menu-title">
              REVISIONS · EVERY CHANGE IS KEPT
            </div>
            {Array.from(
              { length: Math.min(current, MAX_LISTED_REVISIONS) },
              (_, index) => current - index,
            ).map((revision) => {
              const entry = revisions[revision];
              const exported = exports.filter(
                (record) => record.revision === revision,
              );
              return (
                <button
                  key={revision}
                  type="button"
                  role="menuitem"
                  className="dx-menu-item"
                  aria-current={revision === shown ? "true" : undefined}
                  onClick={() => {
                    setMenu(null);
                    setSelectedRevision(revision === current ? null : revision);
                  }}
                >
                  <Icon
                    name={
                      entry?.note.startsWith("Regenerated")
                        ? "auto_awesome"
                        : entry?.note.startsWith("Edited")
                          ? "edit"
                          : "neurology"
                    }
                    size={17}
                  />
                  <span className="dx-grow">
                    <span className="dx-menu-line">
                      <span className="dx-strong">Rev {revision}</span>
                      <span className="dx-grow">{entry?.note ?? "…"}</span>
                      <span className="dx-faint">
                        {entry ? relativeTime(entry.createdAt) : ""}
                      </span>
                    </span>
                    {exported.length > 0 && (
                      <span className="dx-ok-line">
                        Exported as{" "}
                        {exported
                          .map((record) => record.format.toUpperCase())
                          .join(", ")}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {menu === "regen" && (
          <div className="dx-menu dx-menu-regen" role="menu">
            <button
              type="button"
              role="menuitem"
              className="dx-menu-item"
              disabled={!fixable.length}
              onClick={() =>
                void mutate(
                  "fix",
                  `${base}/regenerate`,
                  { baseRevision: current, mode: "fix", aiTargetId: targetId },
                  `Saved as rev ${current + 1}`,
                )
              }
            >
              <Icon name="build" size={18} />
              <span className="dx-grow">
                <span className="dx-row-title">
                  Fix fields that need attention
                </span>
                <span className="dx-sub">
                  {fixable.length
                    ? `${fixable.length} field${fixable.length > 1 ? "s" : ""}: ${fixable
                        .map((field) => field.label)
                        .join(", ")}`
                    : "Nothing to fix"}
                </span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="dx-menu-item"
              onClick={() =>
                void mutate(
                  "all",
                  `${base}/regenerate`,
                  { baseRevision: current, mode: "all", aiTargetId: targetId },
                  `Saved as rev ${current + 1}`,
                )
              }
            >
              <Icon name="refresh" size={18} />
              <span className="dx-grow">
                <span className="dx-row-title">Regenerate every field</span>
                <span className="dx-sub">
                  Rewrites the fields written from your experience. Earlier
                  revisions are kept.
                </span>
              </span>
            </button>
            <div className="dx-menu-model">
              <Icon name="neurology" size={17} />
              <span className="dx-grow">
                <span className="dx-sub">
                  {resolution.target?.label ?? "No model"} ·{" "}
                  {resolution.skipped
                    ? "your assistant's model can't write documents"
                    : "follows the assistant"}
                </span>
              </span>
            </div>
          </div>
        )}

        {menu === "export" && (
          <div className="dx-menu dx-menu-export" role="menu">
            {(claimState !== "confirmed" || validation.length > 0) && (
              <div className="dx-warn">
                <Icon name="warning" size={16} />
                <span>This export will carry a visible DRAFT label.</span>
              </div>
            )}
            {validation.length > 0 && (
              <div className="dx-warn">
                <Icon name="warning" size={16} />
                <span>
                  {validation.length}{" "}
                  {validation.length === 1 ? "field needs" : "fields need"}{" "}
                  attention.{" "}
                  {validation.some((item) => item.code === "missing")
                    ? "Missing fields export blank."
                    : "Long fields may overflow the layout."}
                </span>
              </div>
            )}
            <div className="dx-eyebrow dx-menu-title">EXPORT REV {shown}</div>
            {exportFormats.map((item) => (
              <button
                key={item.format}
                type="button"
                role="menuitem"
                className="dx-menu-item dx-center"
                onClick={() => void makeExport(item.format)}
              >
                <Icon name={item.icon} size={18} />
                <span className="dx-grow">
                  <span className="dx-row-title">{item.label}</span>
                  <span className="dx-sub">{item.sub}</span>
                </span>
              </button>
            ))}
            {exports.length > 0 && (
              <>
                <div className="dx-rule" />
                <div className="dx-eyebrow dx-menu-title">PREVIOUS EXPORTS</div>
                {exports.slice(0, 4).map((record) => (
                  <div key={record.id} className="dx-export-line">
                    <span className="dx-chip">
                      {record.format.toUpperCase()}
                    </span>
                    <span className="dx-grow">
                      Rev {record.revision} · {relativeTime(record.createdAt)}
                    </span>
                    <IconButton
                      icon="download"
                      label={`Download rev ${record.revision} as ${record.format.toUpperCase()}`}
                      onClick={() =>
                        void downloadExport(
                          id,
                          record,
                          detail.document.title,
                        ).catch((cause) => setError(message(cause)))
                      }
                    />
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="dx-error dx-error-bar">
          {error}
        </p>
      )}

      <div className="dx-editor-body" data-focus={focus}>
        <section className="dx-fields" aria-label="Document fields">
          <div className="dx-sources">
            <div className="dx-source">
              <Icon name="description" size={16} />
              <span className="dx-source-key">Template</span>
              <span className="dx-grow dx-ellipsis dx-strong">
                {detail.template.name} · rev {detail.document.templateRevision}
              </span>
            </div>
            <div className="dx-source">
              <Icon name="badge" size={16} />
              <span className="dx-source-key">Experience</span>
              <span className="dx-grow dx-ellipsis dx-strong">
                {profile?.name ?? "Experience matrix"} · rev{" "}
                {detail.document.profileRevision}
              </span>
            </div>
            <div className="dx-source">
              <Icon name="work" size={16} />
              <span className="dx-source-key">Application</span>
              <span className="dx-grow dx-ellipsis dx-strong">
                {candidacy
                  ? `${candidacy.company_name} · ${candidacy.title}${
                      interview ? ` · ${interview.label}` : ""
                    }`
                  : "None — general"}
              </span>
            </div>
            {staleProfile && profile && (
              <div className="dx-banner" role="status">
                <Icon name="update" size={16} />
                <span className="dx-grow">
                  Your experience matrix has a newer revision (rev{" "}
                  {profile.revision}). This document keeps rev{" "}
                  {detail.document.profileRevision}.
                </span>
                <button
                  type="button"
                  className="dx-button dx-button-primary dx-button-xs"
                  onClick={() =>
                    onStartNew({
                      candidacyId: detail.document.candidacyId,
                      templateId: detail.document.templateId,
                    })
                  }
                >
                  New with rev {profile.revision}
                </button>
              </div>
            )}
          </div>

          {generating ? (
            <div className="dx-generating" role="status">
              <div className="dx-generating-title">
                <Spinner />
                <span>
                  {working === "all"
                    ? "Regenerating every field"
                    : "Fixing fields that need attention"}
                </span>
              </div>
              <p className="dx-sub">
                A few parallel calls fill the fields written from your
                experience. You can edit anything once it’s done, and each
                change is saved as a new revision.
              </p>
              <button
                type="button"
                className="dx-button dx-button-sm dx-self-start"
                onClick={() => pending.current?.abort()}
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              {older && (
                <div className="dx-viewing" role="status">
                  <Icon name="history" size={16} />
                  <span className="dx-grow">
                    Viewing rev {shown} of {current}. Read-only.
                  </span>
                  <button
                    type="button"
                    className="dx-button dx-button-xs"
                    onClick={() => setSelectedRevision(null)}
                  >
                    Latest
                  </button>
                  <button
                    type="button"
                    className="dx-button dx-button-ink dx-button-xs"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        "save",
                        `${base}/restore`,
                        { baseRevision: current, sourceRevision: shown },
                        `Restored rev ${shown} as rev ${current + 1}`,
                      )
                    }
                  >
                    Restore as rev {current + 1}
                  </button>
                </div>
              )}
              <div className="dx-filter-row">
                <Segmented<Filter>
                  label="Show fields"
                  variant="filter"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { id: "all", label: "All fields" },
                    {
                      id: "attention",
                      label: "Needs attention",
                      count: attention.length,
                    },
                  ]}
                />
                <span
                  className="dx-valid"
                  data-tone={attention.length ? "attention" : "ready"}
                >
                  <Icon
                    name={attention.length ? "error" : "check_circle"}
                    size={15}
                  />
                  {attention.length
                    ? `${attention.length} / ${detail.fields.length} need attention`
                    : `All ${detail.fields.length} valid`}
                </span>
              </div>
              <div className="dx-sections">
                {groupFields(detail.fields).map((group) => {
                  const fields = group.fields.filter(
                    (field) =>
                      filter === "all" || !!issueFor(validation, field.key),
                  );
                  if (!fields.length) return null;
                  const open = !collapsed[group.id];
                  const warn = group.fields.some((field) =>
                    issueFor(validation, field.key),
                  );
                  return (
                    <div key={group.id} className="dx-section">
                      <button
                        type="button"
                        className="dx-section-head"
                        aria-expanded={open}
                        onClick={() =>
                          setCollapsed((before) => ({
                            ...before,
                            [group.id]: open,
                          }))
                        }
                      >
                        <Icon
                          name={open ? "expand_more" : "chevron_right"}
                          size={17}
                        />
                        <span className="dx-grow dx-ellipsis">
                          {group.title}
                        </span>
                        {warn && <span className="dx-dot" aria-hidden="true" />}
                        <span className="dx-mono dx-faint">
                          {group.fields.length}
                        </span>
                      </button>
                      {open &&
                        fields.map((field) => {
                          const issue = issueFor(validation, field.key);
                          const text = values[field.key] ?? "";
                          const locked =
                            older ||
                            (field.source === "candidacy" &&
                              !!detail.document.candidacyId) ||
                            (field.source === "interview" &&
                              !!detail.document.interviewId);
                          const isFocused = focused === field.key;
                          const regenerating =
                            working === "field" && workingField === field.key;
                          return (
                            <div
                              key={field.key}
                              className="dx-field"
                              data-state={
                                isFocused
                                  ? "focus"
                                  : issue === "too-long"
                                    ? "invalid"
                                    : issue
                                      ? "missing"
                                      : "ok"
                              }
                            >
                              <div className="dx-field-head">
                                <label
                                  htmlFor={`document-field-${field.key}`}
                                  className="dx-field-label"
                                >
                                  {field.label}
                                </label>
                                {!field.required && (
                                  <span className="dx-faint dx-small">
                                    optional
                                  </span>
                                )}
                                <span className="dx-field-key">
                                  {field.key}
                                </span>
                                {regenerating ? (
                                  <Spinner />
                                ) : (
                                  !locked &&
                                  modelOwnedKeys.has(field.key) &&
                                  canRegenerate && (
                                    <IconButton
                                      icon="auto_awesome"
                                      label={`Regenerate ${field.label}`}
                                      disabled={busy}
                                      onClick={() =>
                                        void mutate(
                                          "field",
                                          `${base}/regenerate`,
                                          {
                                            baseRevision: current,
                                            fieldKey: field.key,
                                            aiTargetId: targetId,
                                          },
                                          `Saved as rev ${current + 1}`,
                                          field.key,
                                        )
                                      }
                                    />
                                  )
                                )}
                              </div>
                              <textarea
                                id={`document-field-${field.key}`}
                                className="dx-field-input"
                                rows={Math.min(
                                  8,
                                  Math.max(1, Math.ceil(text.length / 56)),
                                )}
                                value={text}
                                readOnly={locked || regenerating}
                                placeholder={
                                  field.required
                                    ? ""
                                    : "Optional — leave empty to omit"
                                }
                                aria-invalid={!!issue}
                                aria-describedby={
                                  issue
                                    ? `document-error-${field.key}`
                                    : undefined
                                }
                                onFocus={() => setFocused(field.key)}
                                onChange={(event) =>
                                  setValues((before) => ({
                                    ...before,
                                    [field.key]: event.target.value,
                                  }))
                                }
                                onBlur={() => {
                                  setFocused(null);
                                  commit();
                                }}
                              />
                              {(issue ||
                                (isFocused && field.maxLength) ||
                                locked) && (
                                <div
                                  className="dx-field-note"
                                  data-tone={
                                    issue === "too-long"
                                      ? "invalid"
                                      : issue
                                        ? "missing"
                                        : "info"
                                  }
                                  id={`document-error-${field.key}`}
                                >
                                  <span className="dx-grow">
                                    {issue === "missing"
                                      ? field.source === "candidate-profile"
                                        ? "Not in your experience matrix. Type it here, or add it to the matrix so every document gets it."
                                        : "Required by the template."
                                      : issue === "too-long"
                                        ? "Too long for the template."
                                        : issue
                                          ? "Unexpected field."
                                          : locked && !older
                                            ? "Filled from the application."
                                            : ""}
                                  </span>
                                  {field.maxLength && (
                                    <span className="dx-mono">
                                      {text.length} / {field.maxLength}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  );
                })}
                {filter === "attention" && attention.length === 0 && (
                  <div className="dx-all-clear">
                    <Icon name="task_alt" size={26} />
                    <div className="dx-row-title">Nothing needs attention</div>
                    <div className="dx-sub">
                      Every required field is filled and within its length.
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        <section className="dx-preview" aria-label="Document preview">
          <div className="dx-preview-head">
            <Icon name="visibility" size={15} />
            <span className="dx-grow dx-ellipsis">
              Live preview · click any text to edit it
            </span>
            <span className="dx-mono dx-ellipsis">
              {detail.template.name}.{detail.template.format}
            </span>
            <div className="dx-toolbar" role="toolbar" aria-label="Preview">
              <IconButton
                icon="zoom_out"
                label="Zoom out"
                onClick={() => setZoom(zoomBy(zoom, -1))}
              />
              <span className="dx-zoom-label">
                {zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}
              </span>
              <IconButton
                icon="zoom_in"
                label="Zoom in"
                onClick={() => setZoom(zoomBy(zoom, 1))}
              />
              <IconButton
                icon="fit_screen"
                label="Fit to width"
                onClick={() => setZoom("fit")}
              />
              <button
                type="button"
                className="dx-icon-button"
                aria-pressed={focus}
                aria-label={focus ? "Show fields" : "Focus on the document"}
                title={focus ? "Show fields" : "Focus on the document"}
                onClick={() => setFocus((value) => !value)}
              >
                <Icon name={focus ? "left_panel_open" : "left_panel_close"} />
              </button>
            </div>
          </div>
          <DocumentPreview
            preview={preview}
            fields={detail.fields}
            selected={focused}
            onSelect={selectField}
            zoom={zoom}
          />
        </section>
      </div>
    </div>
  );
}
