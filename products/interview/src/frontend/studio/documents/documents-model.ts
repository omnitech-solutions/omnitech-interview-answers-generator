import type {
  DocumentField,
  DocumentFieldError,
  DocumentTemplateKind,
  UnsupportedClaim,
} from "@omnitech/interview-contracts";
import type { IconName } from "../icon";
import type {
  DocumentContext,
  DocumentListItem,
  TemplateListItem,
} from "./documents-client";

export const KIND_LABEL: Record<DocumentTemplateKind, string> = {
  resume: "Resume",
  cover_letter: "Cover letter",
  interview_prep: "Interview prep",
  custom: "Custom",
};
export const KIND_ICON: Record<DocumentTemplateKind, IconName> = {
  resume: "contact_page",
  cover_letter: "mail",
  interview_prep: "checklist",
  custom: "draft",
};

const FIELD_SOURCE_GROUPS: Array<{
  source: DocumentField["source"];
  title: string;
}> = [
  { source: "candidacy", title: "From the application" },
  { source: "interview", title: "From the interview" },
  { source: "candidate-profile", title: "Written from your experience" },
  { source: "manual", title: "Your input" },
];

export type FieldGroup = { id: string; title: string; fields: DocumentField[] };

// A group's id: the template's own heading when it has them, otherwise where
// the value comes from, which is also what decides who can change it.
export const groupIdOf = (field: DocumentField) =>
  field.section ? `section:${field.section}` : field.source;

export function groupFields(fields: readonly DocumentField[]): FieldGroup[] {
  if (fields.some((field) => field.section)) {
    const groups = new Map<string, FieldGroup>();
    for (const field of fields) {
      const id = groupIdOf(field);
      const group = groups.get(id) ?? {
        id,
        title: field.section ?? sourceTitle(field.source),
        fields: [],
      };
      group.fields.push(field);
      groups.set(id, group);
    }
    return [...groups.values()];
  }
  return FIELD_SOURCE_GROUPS.map(({ source, title }) => ({
    id: source,
    title,
    fields: fields.filter((field) => field.source === source),
  })).filter((group) => group.fields.length > 0);
}

const sourceTitle = (source: DocumentField["source"]) =>
  FIELD_SOURCE_GROUPS.find((group) => group.source === source)?.title ??
  "Fields";

export function issueFor(
  validation: readonly DocumentFieldError[],
  key: string,
): DocumentFieldError["code"] | undefined {
  return validation.find((item) => item.key === key)?.code;
}

// [DOMAIN] What an empty or failing field asks of the person. Three kinds of
// empty are told apart, because only two of them need anything done:
//   - "type-it": a fact only the person has (a contact detail, a date) with
//     no stored value;
//   - "does-not-apply": a field of a block this document does not use (no
//     consultancy, fewer employers); nothing to do, not counted;
//   - "no-evidence": the model left it empty because the experience matrix
//     has nothing to support it.
// "unsupported" is text that says something the matrix does not.
export type FieldState =
  | "ok"
  | "type-it"
  | "does-not-apply"
  | "no-evidence"
  | "unsupported"
  | "too-long"
  | "required"
  | "unexpected";

export function fieldState(
  field: DocumentField,
  issue: DocumentFieldError["code"] | undefined,
  context: { absent: ReadonlySet<string>; modelOwned: ReadonlySet<string> },
): FieldState {
  if (context.absent.has(field.key)) return "does-not-apply";
  if (issue === "unsupported") return "unsupported";
  if (issue === "too-long") return "too-long";
  if (issue === "unexpected") return "unexpected";
  if (issue !== "missing") return "ok";
  if (field.source !== "candidate-profile") return "required";
  return context.modelOwned.has(field.key) ? "no-evidence" : "type-it";
}

export const FIELD_STATE_TEXT: Record<
  "type-it" | "no-evidence" | "does-not-apply",
  { title: string; body: string }
> = {
  "type-it": {
    title: "Missing: type it",
    body: "Nothing is stored for this. Type it here for this document.",
  },
  "no-evidence": {
    title: "No evidence",
    body: "Left empty: your experience matrix has nothing to support it. Write it yourself or regenerate it.",
  },
  "does-not-apply": {
    title: "Does not apply",
    body: "Parts of the template this document does not use. They are left out of the preview and the export, and there is nothing to fill in.",
  },
};
export const CONTACT_HINT =
  "Type it here for this document, or keep it in your contact details file on this machine so every document is filled in.";

/** Why one claim failed, as a sentence the person can act on. */
export function claimReason(claim: UnsupportedClaim, against: string): string {
  const what = `“${claim.text}”`;
  const whole = against === "your experience matrix";
  if (claim.foundIn) return `${what} is from ${claim.foundIn}, not ${against}.`;
  return whole
    ? `${what} is not in your experience matrix.`
    : `${what} is not in the matrix entry for ${against}.`;
}

export type ExportBlocker = { key: string; label: string; reasons: string[] };

/** The fields that stop an export, each with what was not found in it. */
export function exportBlockers(
  validation: readonly DocumentFieldError[],
  fields: readonly DocumentField[],
): ExportBlocker[] {
  return validation
    .filter((issue) => issue.code === "unsupported")
    .map((issue) => ({
      key: issue.key,
      label:
        fields.find((field) => field.key === issue.key)?.label ?? issue.key,
      reasons: (issue.missing ?? []).map((claim) =>
        claimReason(claim, issue.against ?? "your experience matrix"),
      ),
    }));
}

export type DocumentGroup = {
  id: string;
  title: string;
  mono: string;
  sub: string;
  candidacyId: string | null;
  documents: DocumentListItem[];
};

// One group per application, then General for documents tied to none.
export function groupDocuments(
  documents: readonly DocumentListItem[],
  context: DocumentContext,
): DocumentGroup[] {
  const count = (n: number) => `${n} document${n === 1 ? "" : "s"}`;
  const byCandidacy = context.candidacies.map((candidacy) => {
    const own = documents.filter((item) => item.candidacyId === candidacy.id);
    return {
      id: candidacy.id,
      title: `${candidacy.company_name} · ${candidacy.title}`,
      mono: candidacy.company_name.slice(0, 1).toUpperCase() || "?",
      sub: count(own.length),
      candidacyId: candidacy.id,
      documents: own,
    };
  });
  const general = documents.filter((item) => !item.candidacyId);
  return [
    ...byCandidacy,
    {
      id: "general",
      title: "General",
      mono: "—",
      sub: `Not tied to an application · built from your experience matrix only · ${count(general.length)}`,
      candidacyId: null,
      documents: general,
    },
  ];
}

export function templateUsage(
  documents: readonly DocumentListItem[],
  template: TemplateListItem,
): number {
  return documents.filter((item) => item.templateId === template.template.id)
    .length;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? "yesterday" : `${days} days ago`;
  return new Date(then).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export function documentStatus(item: DocumentListItem): {
  label: string;
  tone: "attention" | "ready";
} {
  return item.status === "invalid"
    ? { label: "Needs attention", tone: "attention" }
    : { label: "Ready to export", tone: "ready" };
}

export type Provenance = {
  kind?: string;
  fieldKeys?: string[];
  restoredFromRevision?: number;
  sourceDigest?: string | null;
  modelOwnedKeys?: string[];
  claimState?: "unverified" | "confirmed";
};

// A revision's one-line story, for the revisions menu.
export function revisionNote(
  provenance: Provenance,
  fields: readonly DocumentField[],
): string {
  if (provenance.restoredFromRevision)
    return `Restored rev ${provenance.restoredFromRevision}`;
  if (provenance.kind === "manual") return "Created manually";
  if (provenance.kind === "edited") return "Edited";
  if (provenance.kind === "recast") return "Swapped a client contract";
  if (provenance.kind === "field-confirmed") {
    const only =
      provenance.fieldKeys?.length === 1 ? provenance.fieldKeys[0] : undefined;
    const label = fields.find((field) => field.key === only)?.label;
    return label ? `Confirmed ${label} by you` : "Confirmed fields by you";
  }
  if (provenance.kind === "candidate-confirmed") return "Candidate confirmed";
  if (provenance.kind === "source-refreshed") return "Source facts refreshed";
  if (provenance.kind === "regenerated") {
    const keys = provenance.fieldKeys ?? [];
    const only = keys.length === 1 ? keys[0] : undefined;
    const label = fields.find((field) => field.key === only)?.label;
    return label ? `Regenerated ${label}` : `Regenerated ${keys.length} fields`;
  }
  return "Generated";
}
