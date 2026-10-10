import {
  type DocumentField,
  type DocumentFieldError,
  type DocumentFormat,
  documentLayout,
} from "@omnitech/interview-contracts";
import type { IconName } from "../icon";
import { isSourceBound } from "./document-form-config";
import type { DocumentDetail, DocumentExport } from "./documents-client";
import {
  exportBlockers,
  type FieldState,
  fieldState,
  issueFor,
  relativeTime,
} from "./documents-model";

// The editor's state as data: what each field shows, and which actions the
// toolbar and its menus offer. Pure: the controller supplies the state, the
// composition root draws what comes back.

export type Working =
  | "save"
  | "swap"
  | "all"
  | "fix"
  | "field"
  | "export"
  | "confirm"
  | "refresh"
  | null;
export type FieldFilter = "all" | "attention";
export type RevisionEntry = { note: string; createdAt: string };

export const MAX_LISTED_REVISIONS = 20;

/** What the editor knows at one moment; everything below is derived from it. */
export type EditorState = {
  detail: DocumentDetail;
  values: Readonly<Record<string, string>>;
  validation: readonly DocumentFieldError[];
  working: Working;
  workingField: string | null;
  focused: string | null;
  // The model regeneration follows right now; "" when none can write.
  targetId: string;
};

export type EditorFacts = {
  current: number;
  shown: number;
  // A revision other than the latest is on show: it is read-only.
  older: boolean;
  dirty: boolean;
  busy: boolean;
  generating: boolean;
  claimState: "confirmed" | "unverified";
  modelOwned: ReadonlySet<string>;
  canRegenerate: boolean;
  // Fields of blocks this document does not use: not drawn, not counted.
  absent: ReadonlySet<string>;
  applies: DocumentField[];
  notApplying: DocumentField[];
  attention: DocumentField[];
  fixable: DocumentField[];
  blockers: ReturnType<typeof exportBlockers>;
};

export function editorFacts(state: EditorState): EditorFacts {
  const { detail, values, validation, working } = state;
  const current = detail.document.currentRevision;
  const shown = detail.revision.revision;
  const older = shown !== current;
  const modelOwned = new Set(detail.revision.provenance.modelOwnedKeys ?? []);
  const { absent } = documentLayout(detail.fields, values);
  const attention = detail.fields.filter((field) =>
    issueFor(validation, field.key),
  );
  return {
    current,
    shown,
    older,
    dirty:
      !older &&
      JSON.stringify(values) !== JSON.stringify(detail.revision.values),
    busy: working !== null,
    generating: working === "all" || working === "fix",
    claimState:
      detail.revision.provenance.claimState === "confirmed"
        ? "confirmed"
        : "unverified",
    modelOwned,
    canRegenerate: !older && !!state.targetId && modelOwned.size > 0,
    absent,
    applies: detail.fields.filter((field) => !absent.has(field.key)),
    notApplying: detail.fields.filter((field) => absent.has(field.key)),
    attention,
    fixable: attention.filter((field) => modelOwned.has(field.key)),
    // [SAFETY] Export is refused while a field says something the experience
    // matrix does not; the server refuses too. Each such field is named.
    blockers: exportBlockers(validation, detail.fields),
  };
}

/** What one field shows beside its control. */
export type FieldView = {
  state: FieldState;
  issue: DocumentFieldError["code"] | undefined;
  // The failed claims, when the field says something unsupported.
  unsupported: DocumentFieldError | undefined;
  confirmed: boolean;
  // A contact detail only the person can supply.
  contact: boolean;
  focused: boolean;
  regenerating: boolean;
  // The model may be asked to write this field again.
  regenerable: boolean;
};

export function fieldViews(
  state: EditorState,
  facts: EditorFacts,
): Record<string, FieldView> {
  const { detail, validation } = state;
  const confirmed = new Set(detail.review?.confirmedFields ?? []);
  const contact = new Set(detail.review?.contactKeys ?? []);
  const binding = documentBinding(detail);
  return Object.fromEntries(
    facts.applies.map((field) => {
      const issue = issueFor(validation, field.key);
      const view = fieldState(field, issue, {
        absent: facts.absent,
        modelOwned: facts.modelOwned,
      });
      return [
        field.key,
        {
          state: view,
          issue,
          unsupported:
            view === "unsupported"
              ? validation.find(
                  (item) =>
                    item.key === field.key && item.code === "unsupported",
                )
              : undefined,
          confirmed: confirmed.has(field.key) && !facts.dirty,
          contact: contact.has(field.key),
          focused: state.focused === field.key,
          regenerating:
            state.working === "field" && state.workingField === field.key,
          regenerable:
            !facts.older &&
            !isSourceBound(field, binding) &&
            facts.modelOwned.has(field.key) &&
            facts.canRegenerate,
        } satisfies FieldView,
      ];
    }),
  );
}

export const documentBinding = (detail: DocumentDetail) => ({
  candidacy: !!detail.document.candidacyId,
  interview: !!detail.document.interviewId,
});

/** The fields the form leaves out: absent blocks, and what the filter hides. */
export function hiddenFields(
  detail: DocumentDetail,
  facts: EditorFacts,
  validation: readonly DocumentFieldError[],
  filter: FieldFilter,
): string[] {
  return detail.fields
    .filter(
      (field) =>
        facts.absent.has(field.key) ||
        (filter === "attention" && !issueFor(validation, field.key)),
    )
    .map((field) => field.key);
}

export type SaveState = { icon: IconName; text: string; live: boolean };

export function saveState(state: EditorState, facts: EditorFacts): SaveState {
  if (state.working)
    return {
      icon: "refresh",
      text:
        state.working === "save"
          ? "Saving…"
          : state.working === "export"
            ? "Exporting…"
            : state.working === "swap"
              ? "Swapping…"
              : "Regenerating…",
      live: true,
    };
  if (facts.dirty) return { icon: "edit", text: "Editing…", live: true };
  if (facts.older)
    return { icon: "history", text: `Viewing rev ${facts.shown}`, live: false };
  return {
    icon: "cloud_done",
    text: `Saved · rev ${facts.current}`,
    live: false,
  };
}

/** What the editor can be asked to do; the controller implements each. */
export type EditorCommands = {
  confirm(): void;
  refreshSources(): void;
  regenerate(mode: "all" | "fix"): void;
  selectRevision(revision: number): void;
  exportAs(format: DocumentFormat): void;
  download(record: DocumentExport): void;
};

/**
 * [DOMAIN] A toolbar action as data: what it is called, whether this state
 * offers it at all (`available`), whether it can be used now (`disabled`),
 * and what it runs. What the command does is code, in the controller.
 */
export type EditorAction = {
  id: string;
  label: string;
  available: boolean;
  disabled: boolean;
  run(): void;
};

export function toolbarActions(
  facts: EditorFacts,
  commands: EditorCommands,
): EditorAction[] {
  const settled = !facts.older && !facts.dirty;
  return [
    {
      id: "confirm",
      label: "Confirm reviewed",
      // Only the current saved revision can be confirmed, and only once.
      available: settled && facts.claimState !== "confirmed",
      disabled: facts.busy,
      run: commands.confirm,
    },
    {
      id: "refresh-sources",
      label: "Refresh source facts",
      available: settled,
      disabled: facts.busy,
      run: commands.refreshSources,
    },
  ];
}

/** One row of a menu, as the library's ActionMenu reads it. */
export type MenuRow = {
  id: string;
  label: string;
  description?: string;
  icon?: IconName;
  checked?: boolean;
  disabled?: boolean;
  onSelect(): void;
};
export type MenuSection = { id: string; label?: string; items: MenuRow[] };

const revisionIcon = (note: string | undefined): IconName =>
  note?.startsWith("Regenerated")
    ? "auto_awesome"
    : note?.startsWith("Edited")
      ? "edit"
      : "neurology";

/** The numbers of the revisions the menu lists, newest first. */
export const listedRevisions = (current: number) =>
  Array.from(
    { length: Math.min(current, MAX_LISTED_REVISIONS) },
    (_, index) => current - index,
  );

export function revisionsMenu(
  facts: EditorFacts,
  entries: Readonly<Record<number, RevisionEntry>>,
  exports: readonly DocumentExport[],
  commands: EditorCommands,
  now = Date.now(),
): MenuSection[] {
  return [
    {
      id: "revisions",
      label: "REVISIONS · EVERY CHANGE IS KEPT",
      items: listedRevisions(facts.current).map((revision) => {
        const entry = entries[revision];
        const exported = exports
          .filter((record) => record.revision === revision)
          .map((record) => record.format.toUpperCase());
        const detail = [
          entry ? relativeTime(entry.createdAt, now) : "",
          exported.length ? `Exported as ${exported.join(", ")}` : "",
        ].filter(Boolean);
        return {
          id: String(revision),
          label: `Rev ${revision} · ${entry?.note ?? "…"}`,
          ...(detail.length ? { description: detail.join(" · ") } : {}),
          icon: revisionIcon(entry?.note),
          onSelect: () => commands.selectRevision(revision),
        };
      }),
    },
  ];
}

export function regenerateMenu(
  facts: EditorFacts,
  model: { label: string | undefined; skipped: boolean },
  commands: EditorCommands,
): MenuSection[] {
  const count = facts.fixable.length;
  return [
    {
      id: "regenerate",
      // Regeneration follows whichever model the assistant has chosen.
      label: `${model.label ?? "No model"} · ${
        model.skipped
          ? "your assistant's model can't write documents"
          : "follows the assistant"
      }`,
      items: [
        {
          id: "fix",
          label: "Fix fields that need attention",
          description: count
            ? `${count} field${count > 1 ? "s" : ""}: ${facts.fixable
                .map((field) => field.label)
                .join(", ")}`
            : "Nothing to fix",
          icon: "build",
          disabled: !count,
          onSelect: () => commands.regenerate("fix"),
        },
        {
          id: "all",
          label: "Regenerate every field",
          description:
            "Rewrites the fields written from your experience. Earlier revisions are kept.",
          icon: "refresh",
          onSelect: () => commands.regenerate("all"),
        },
      ],
    },
  ];
}

export type ExportMenu = {
  // Shown above the formats when the export will not be a clean one.
  warning: { title: string; detail?: string } | null;
  sections: MenuSection[];
};

export function exportMenu(
  state: EditorState,
  facts: EditorFacts,
  exports: readonly DocumentExport[],
  commands: EditorCommands,
  now = Date.now(),
): ExportMenu {
  const { detail, validation } = state;
  const docx = detail.template.format === "docx";
  const formats: MenuRow[] = [
    ...(docx
      ? [
          {
            id: "docx",
            label: "Word document",
            description: "Uses the template’s layout and fonts",
            icon: "description" as const,
            onSelect: () => commands.exportAs("docx"),
          },
        ]
      : []),
    {
      id: "md",
      label: "Markdown",
      description: docx
        ? "Plain text with headings"
        : "The template’s own format",
      icon: "code",
      onSelect: () => commands.exportAs("md"),
    },
  ];
  const draft = facts.claimState !== "confirmed" || validation.length > 0;
  return {
    warning: draft
      ? {
          title: "This export will carry a visible DRAFT label.",
          ...(validation.length
            ? {
                detail: `${validation.length} ${
                  validation.length === 1 ? "field needs" : "fields need"
                } attention. ${
                  validation.some((item) => item.code === "missing")
                    ? "Missing fields export blank."
                    : "Long fields may overflow the layout."
                }`,
              }
            : {}),
        }
      : null,
    sections: [
      { id: "formats", label: `EXPORT REV ${facts.shown}`, items: formats },
      ...(exports.length
        ? [
            {
              id: "previous",
              label: "PREVIOUS EXPORTS",
              items: exports.slice(0, 4).map((record) => ({
                id: record.id,
                label: `Download rev ${record.revision} as ${record.format.toUpperCase()}`,
                description: relativeTime(record.createdAt, now),
                icon: "download" as const,
                onSelect: () => commands.download(record),
              })),
            },
          ]
        : []),
    ],
  };
}

const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5];
export type Zoom = "fit" | number;
export const zoomBy = (zoom: Zoom, step: 1 | -1): number =>
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
export const zoomLabel = (zoom: Zoom) =>
  zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`;
