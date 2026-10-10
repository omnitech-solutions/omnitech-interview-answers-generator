"use client";

import type {
  DocumentFieldError,
  DocumentFormat,
} from "@omnitech/interview-contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { documentTarget } from "./assistant-model";
import {
  type EditorCommands,
  type EditorState,
  editorFacts,
  type FieldFilter,
  fieldViews,
  hiddenFields,
  listedRevisions,
  type RevisionEntry,
  type Working,
} from "./document-editor-model";
import { focusDocumentField } from "./document-form";
import {
  documentFormSections,
  initiallyCollapsed,
  sectionIdOf,
} from "./document-form-config";
import type { PreviewPayload } from "./document-preview";
import {
  type DocumentContext,
  type DocumentDetail,
  type DocumentExport,
  documentJson,
  downloadExport,
  postJson,
} from "./documents-client";
import { type Provenance, revisionNote } from "./documents-model";
import { message } from "./documents-ui";

// The editor's one controller. Server state (the revision, its fields, the
// exports) is read from the server and never edited here; the draft (unsaved
// values, the field in hand) is the local copy; what is open or hidden is
// presentation. Every request the editor makes starts in this file.

export const PREVIEW_DELAY_MS = 250;

const payloadOf = (value: PreviewPayload): PreviewPayload =>
  value.kind === "docx"
    ? { kind: "docx", docx: value.docx }
    : { kind: "html", html: value.html };

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

export function useDocumentEditor({
  id,
  context,
  onChanged,
  onDirtyChange,
  notify,
}: {
  id: string;
  context: DocumentContext;
  onChanged(): void;
  onDirtyChange(dirty: boolean): void;
  notify(text: string): void;
}) {
  // Server state.
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [exports, setExports] = useState<DocumentExport[]>([]);
  const [revisions, setRevisions] = useState<Record<number, RevisionEntry>>({});
  // Draft state.
  const [values, setValues] = useState<Record<string, string>>({});
  const [draftValidation, setDraftValidation] = useState<
    DocumentFieldError[] | null
  >(null);
  const [focused, setFocused] = useState<string | null>(null);
  // Presentation state.
  const [filter, setFilter] = useState<FieldFilter>("all");
  const [collapsed, setCollapsed] = useState<string[] | null>(null);
  const [fieldsHidden, setFieldsHidden] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{
    key: string;
    reopened: boolean;
  } | null>(null);
  // Work in hand.
  const [working, setWorking] = useState<Working>(null);
  const [workingField, setWorkingField] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const previewRequest = useRef(0);
  const draft = useRef(values);
  draft.current = values;

  // Regeneration follows whichever model the assistant has chosen right now.
  const resolution = documentTarget(context.targets);
  const targetId = resolution.target?.id ?? "";

  const validation = draftValidation ?? detail?.revision.validation ?? [];
  const state: EditorState | null = detail
    ? { detail, values, validation, working, workingField, focused, targetId }
    : null;
  const facts = state ? editorFacts(state) : null;
  const dirty = facts?.dirty ?? false;
  const older = facts?.older ?? false;
  const current = facts?.current ?? 0;
  const shown = facts?.shown ?? 0;
  const base = `/${encodeURIComponent(id)}`;

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => pending.current?.abort(), []);

  // Load: the revision on show, its preview, and the exports made so far.
  useEffect(() => {
    const controller = new AbortController();
    const query = selectedRevision ? `?revision=${selectedRevision}` : "";
    const signal = controller.signal;
    Promise.all([
      documentJson<DocumentDetail>(`${base}${query}`, { signal }),
      documentJson<PreviewPayload>(`${base}/preview${query}`, { signal }),
      documentJson<{ exports: DocumentExport[] }>(`${base}/exports`, {
        signal,
      }),
    ]).then(
      ([loaded, rendered, history]) => {
        if (signal.aborted) return;
        // The form takes values afresh only when the server's differ from
        // the draft: a plain save changes nothing under the caret.
        if (!same(loaded.revision.values, draft.current))
          setEpoch((value) => value + 1);
        setDetail(loaded);
        setValues(loaded.revision.values);
        setPreview(payloadOf(rendered));
        setExports(history.exports);
        setDraftValidation(null);
        setError("");
        setCollapsed(
          (before) =>
            before ?? [
              ...initiallyCollapsed(loaded.fields, loaded.revision.validation),
            ],
        );
      },
      (cause) => {
        if (!signal.aborted) setError(message(cause));
      },
    );
    return () => controller.abort();
  }, [base, selectedRevision, refresh]);

  // [STRATEGY] A draft is drawn without writing a revision: 250 ms after the
  // last keystroke, one request. A newer draft aborts the request before it,
  // and an answer is used only if it is for the latest request, so an earlier
  // preview can never replace a newer one, whatever order they arrive in.
  useEffect(() => {
    if (!detail || !dirty || older) return;
    const controller = new AbortController();
    const request = ++previewRequest.current;
    const latest = () =>
      !controller.signal.aborted && request === previewRequest.current;
    const timer = window.setTimeout(() => {
      postJson<PreviewPayload & { validation: DocumentFieldError[] }>(
        `${base}/preview`,
        { baseRevision: current, values },
        controller.signal,
      ).then(
        (result) => {
          if (!latest()) return;
          setPreview(payloadOf(result));
          setDraftValidation(result.validation);
        },
        (cause) => {
          if (latest()) setError(message(cause));
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [base, current, detail, dirty, older, values]);

  // The revisions menu describes each revision, so read them when it opens.
  useEffect(() => {
    if (!revisionsOpen || !detail) return;
    const wanted = listedRevisions(current).filter(
      (revision) => !revisions[revision],
    );
    if (!wanted.length) return;
    const controller = new AbortController();
    Promise.all(
      wanted.map((revision) =>
        documentJson<DocumentDetail>(`${base}?revision=${revision}`, {
          signal: controller.signal,
        }).then((item): [number, RevisionEntry] => [
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
  }, [revisionsOpen, detail, current, base, revisions]);

  const sections = useMemo(
    () => (detail ? documentFormSections(detail.fields) : []),
    [detail],
  );

  // Preview-to-field focus, after the form has drawn the field. A section
  // the person closed by hand is opened by drawing the form afresh, once.
  useEffect(() => {
    if (!focusRequest) return;
    const frame = requestAnimationFrame(() => {
      if (focusDocumentField(sections, focusRequest.key)) return;
      if (focusRequest.reopened) return;
      setEpoch((value) => value + 1);
      setFocusRequest({ key: focusRequest.key, reopened: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, sections]);

  // One mutation at a time: it writes a revision, then the editor reads the
  // latest again. Aborting it leaves the revision the editor already has.
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
    setError("");
    try {
      await postJson(path, body, controller.signal);
      setSelectedRevision(null);
      setRefresh((value) => value + 1);
      onChanged();
      notify(saved);
    } catch (cause) {
      if (controller.signal.aborted) notify(`Cancelled — kept rev ${current}`);
      // A conflict keeps the draft: the person decides what to do with it.
      else setError(message(cause));
    } finally {
      if (pending.current === controller) pending.current = null;
      setWorking(null);
      setWorkingField(null);
    }
  }

  const next = `rev ${current + 1}`;
  const commands = {
    // Leaving a field saves it as a revision: every change is kept, and a
    // revision is never made per keystroke.
    commit() {
      if (!dirty || working) return;
      void mutate(
        "save",
        `${base}/revisions`,
        { baseRevision: current, values },
        `Saved as ${next}`,
      );
    },
    confirm: () =>
      void mutate(
        "confirm",
        `${base}/confirm`,
        { baseRevision: current },
        `Confirmed as ${next}`,
      ),
    refreshSources: () =>
      void mutate(
        "refresh",
        `${base}/refresh-sources`,
        { baseRevision: current },
        `Refreshed source facts as ${next}`,
      ),
    regenerate: (mode: "all" | "fix") =>
      void mutate(
        mode,
        `${base}/regenerate`,
        { baseRevision: current, mode, aiTargetId: targetId },
        `Saved as ${next}`,
      ),
    regenerateField: (key: string) =>
      void mutate(
        "field",
        `${base}/regenerate`,
        { baseRevision: current, fieldKey: key, aiTargetId: targetId },
        `Saved as ${next}`,
        key,
      ),
    // "Confirmed by me": the person vouches for the field as it is written.
    confirmField: (key: string) =>
      void mutate(
        "save",
        `${base}/revisions`,
        { baseRevision: current, values, confirm: [key] },
        `Confirmed as ${next}`,
      ),
    restore: () =>
      void mutate(
        "save",
        `${base}/restore`,
        { baseRevision: current, sourceRevision: shown },
        `Restored rev ${shown} as ${next}`,
      ),
    swap: (block: string, role: { id: string; company: string }) =>
      void mutate(
        "swap",
        `${base}/cast`,
        { baseRevision: current, block, roleId: role.id, aiTargetId: targetId },
        `${role.company} swapped in as ${next}`,
      ),
    cancel: () => pending.current?.abort(),
    selectRevision: (revision: number) =>
      setSelectedRevision(revision === current ? null : revision),
    latest: () => setSelectedRevision(null),
    retry: () => setRefresh((value) => value + 1),
    async exportAs(format: DocumentFormat) {
      if (!detail) return;
      setWorking("export");
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
    },
    download: (record: DocumentExport) => {
      if (detail)
        void downloadExport(id, record, detail.document.title).catch((cause) =>
          setError(message(cause)),
        );
    },
    // Clicking text in the preview opens its field: section, filter, focus.
    selectField(key: string) {
      const section = detail ? sectionIdOf(detail.fields, key) : null;
      if (!section) return;
      setFilter("all");
      setFieldsHidden(false);
      if (collapsed?.includes(section)) {
        setCollapsed(collapsed.filter((item) => item !== section));
        setEpoch((value) => value + 1);
      }
      setFocused(key);
      setFocusRequest({ key, reopened: false });
    },
  } satisfies EditorCommands & Record<string, unknown>;

  // The form's callbacks keep one identity; each calls the latest command.
  const latest = useRef(commands);
  latest.current = commands;
  const formActions = useMemo(
    () => ({
      focus: (key: string) => setFocused(key),
      leave: () => {
        setFocused(null);
        latest.current.commit();
      },
      regenerate: (key: string) => latest.current.regenerateField(key),
      confirm: (key: string) => latest.current.confirmField(key),
    }),
    [],
  );
  const edit = useCallback(
    (nextValues: Record<string, string>) => setValues(nextValues),
    [],
  );

  const views = useMemo(
    () => (state && facts ? fieldViews(state, facts) : {}),
    [detail, values, validation, working, workingField, focused, targetId],
  );
  const hiddenKey =
    detail && facts
      ? hiddenFields(detail, facts, validation, filter).join("\n")
      : "";
  const hidden = useMemo(
    () => (hiddenKey ? hiddenKey.split("\n") : []),
    [hiddenKey],
  );
  const collapsedSections = useMemo(() => collapsed ?? [], [collapsed]);

  return {
    // Server state.
    detail,
    preview,
    exports,
    revisions,
    // Draft state.
    values,
    validation,
    focused,
    edit,
    // What follows from both.
    state,
    facts,
    views,
    model: { label: resolution.target?.label, skipped: !!resolution.skipped },
    // Presentation.
    filter,
    setFilter,
    fieldsHidden,
    setFieldsHidden,
    setRevisionsOpen,
    hidden,
    collapsed: collapsedSections,
    epoch,
    // Work in hand.
    working,
    error,
    commands,
    formActions,
  };
}

export type DocumentEditorController = ReturnType<typeof useDocumentEditor>;
