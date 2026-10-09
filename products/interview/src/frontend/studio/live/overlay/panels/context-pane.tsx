// What the answers are built from, beside them: the person's experience matrix
// and the interview brief, laid out the way the model is given them, with a
// line on each saying how it is used. The matrix can be read in each of the
// ways it is consumed (matrix-projections.ts) and edited where it stands:
// every save is a new revision, and any earlier one can be read or restored.
//
// [DOMAIN] How the model is given this (context-snapshot.ts on the server, in
// the same order as below): the brief's lines lead, then the facts of the
// roles that best match the question, then the rest of the employer's
// material.
import {
  ActionMenu,
  Button,
  Panel,
  Tag,
  Textarea,
} from "@oc-tech/omni-ui-components";
import { createBriefingClient } from "@omnitech/interview-api-client";
import {
  type CandidacyContext,
  type CandidateMatrix,
  type CoachNote,
  type ContextView,
  contextViewResponseSchema,
} from "@omnitech/interview-contracts";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type PackSetup,
  rankRoles,
} from "../../../briefings/behavioural/setup-card";
import { documentJson } from "../../../documents/documents-client";
import { Icon } from "../../../icon";
import { studioFetch } from "../../../studio-fetch";
import { tenantFromLocation } from "../../session-registry";
import { COACH_COLOUR } from "./coach-note-view";
import { briefSections } from "./interview-context-modal";
import {
  draftOf,
  EDITABLE_FIELDS,
  factField,
  PROJECTIONS,
  type ProjectionId,
  type RoleDraft,
  roleFacts,
  rolesLeanedOn,
  withRoleDraft,
} from "./matrix-projections";
import type { PanelSession } from "./panel-views";

const LINE = "#2c2c2f";
const DIM = "#8e8e93";
const FAINT = "#6e6e73";
// The roles drawn before "Show all": what the model is most likely to be given.
const TOP_ROLES = 5;
// The revisions offered in the menu, newest first.
const REVISIONS_LISTED = 20;

const STYLE = {
  scroll: {
    padding: "4px 4px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 22,
    color: COACH_COLOUR.read,
  },
  artifact: { display: "flex", flexDirection: "column", gap: 8 },
  head: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  caps: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.09em",
    textTransform: "uppercase",
    color: DIM,
  },
  meta: { fontSize: 12, color: FAINT },
  how: {
    margin: 0,
    padding: "7px 10px",
    borderRadius: 8,
    background: "#151517",
    border: `1px solid ${LINE}`,
    fontSize: 12.5,
    lineHeight: 1.45,
    color: DIM,
  },
  role: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "8px 10px",
    borderRadius: 9,
    border: `1px solid ${LINE}`,
  },
  roleHead: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  title: { fontSize: 12.5, color: DIM, paddingLeft: 8 },
  fact: { margin: 0, fontSize: 13, lineHeight: 1.45, color: "#c7c7cc" },
  factLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: FAINT,
  },
  pointer: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 10.5,
    color: FAINT,
  },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 },
  empty: { margin: 0, fontSize: 13, color: DIM },
  note: { margin: 0, fontSize: 12, lineHeight: 1.45, color: DIM },
} satisfies Record<string, CSSProperties>;

// ---- Loading ------------------------------------------------------------------

function useCandidacy(candidacyId: string | null) {
  const [context, setContext] = useState<CandidacyContext | null>(null);
  useEffect(() => {
    setContext(null);
    if (!candidacyId) return;
    let live = true;
    documentJson<CandidacyContext>(
      `/candidacies/${encodeURIComponent(candidacyId)}/context`,
    )
      .then((loaded) => {
        if (live) setContext(loaded);
      })
      // The pane says there is no brief; the session is not affected.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [candidacyId]);
  return { context, setContext };
}

type Loaded = { matrix: CandidateMatrix; name: string; revision: number };

// [DOMAIN] The matrix has revisions: every save is a new one and none is ever
// changed. A session answers from the revision it was started with (`pinned`);
// the pane opens on the newest, and any revision can be read.
function useMatrix(pinned: { id: string; revision: number } | null) {
  const client = useMemo(
    () => createBriefingClient({ baseUrl: "", fetch: studioFetch }),
    [],
  );
  const [profile, setProfile] = useState<{
    id: string;
    name: string;
    latest: number;
  } | null>(null);
  // The revision on show; null follows the newest.
  const [viewing, setViewing] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const pinnedId = pinned?.id ?? null;
  useEffect(() => {
    let live = true;
    client
      .listProfiles()
      .then((listed) => {
        const found =
          listed.profiles.find((each) => each.id === pinnedId) ??
          listed.profiles[0];
        if (live && found)
          setProfile({
            id: found.id,
            name: found.name,
            latest: found.revision,
          });
      })
      .catch(() => setFailure("The experience matrix could not be read."));
    return () => {
      live = false;
    };
  }, [client, pinnedId]);
  const id = profile?.id ?? null;
  const revision = viewing ?? profile?.latest ?? null;
  useEffect(() => {
    if (id === null || revision === null) return;
    let live = true;
    client
      .getProfile(id, revision)
      .then((found) => {
        if (live)
          setLoaded({
            matrix: found.matrix,
            name: found.name,
            revision: found.revision,
          });
      })
      .catch(() => setFailure("That revision could not be read."));
    return () => {
      live = false;
    };
  }, [client, id, revision]);
  // Saves the matrix as the next revision. The server refuses it when the
  // newest revision is no longer the one this was edited from.
  const save = useCallback(
    async (matrix: CandidateMatrix): Promise<boolean> => {
      if (!profile) return false;
      try {
        const saved = await client.importProfile({
          name: profile.name,
          matrix,
          profileId: profile.id,
          expectedRevision: profile.latest,
        });
        setFailure(null);
        setProfile({ ...profile, latest: saved.revision });
        setViewing(null);
        return true;
      } catch {
        setFailure(
          "Not saved: the matrix changed elsewhere, or the change is not valid. Reload and try again.",
        );
        return false;
      }
    },
    [client, profile],
  );
  return { profile, loaded, viewing: revision, setViewing, save, failure };
}

// ---- Pieces -------------------------------------------------------------------

function Artifact({
  title,
  meta,
  how,
  actions,
  children,
}: {
  title: string;
  meta: string;
  // How the model is given this, in a sentence or two.
  how: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={STYLE.artifact} data-testid="pn-context-artifact">
      <div style={STYLE.head}>
        <span style={STYLE.caps}>{title}</span>
        <span style={{ flex: "1 1 auto" }} aria-hidden="true" />
        {actions}
      </div>
      <span style={STYLE.meta}>{meta}</span>
      <p style={STYLE.how}>
        <span style={{ ...STYLE.factLabel, marginRight: 6 }}>
          How the AI uses it
        </span>
        {how}
      </p>
      {children}
    </section>
  );
}

type Ranked = ReturnType<typeof rankRoles>[number];

function RoleCard({
  ranked,
  used,
  editable,
  projection,
  onSave,
}: {
  ranked: Ranked;
  // The note on show leans on this role.
  used: boolean;
  // Only the newest revision is edited; an older one is read.
  editable: boolean;
  projection: "ranked" | "facts";
  onSave(draft: RoleDraft): Promise<boolean>;
}) {
  const { id, role, match } = ranked;
  const index = Number(id.split("/")[2]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RoleDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const facts = roleFacts(role, index);
  return (
    <div
      style={{
        ...STYLE.role,
        ...(used
          ? {
              borderColor: COACH_COLOUR.evidence,
              background: "rgba(124, 180, 255, 0.07)",
            }
          : {}),
      }}
      data-role-id={id}
      data-used={used ? "" : undefined}
      data-testid="pn-context-role"
    >
      <div style={STYLE.roleHead}>
        <Button
          buttonSize="sm"
          variant="ghost"
          icon={<Icon name={open ? "expand_more" : "chevron_right"} />}
          aria-expanded={open}
          labelMaxWidth="200px"
          title={`${role.company} · ${role.title}`}
          onClick={() => setOpen(!open)}
        >
          {role.company}
        </Button>
        <span style={{ flex: "1 1 auto" }} aria-hidden="true" />
        {used && <Tag>In this note</Tag>}
        <span style={STYLE.meta}>
          {projection === "facts" ? `${facts.length} facts` : `${match}%`}
        </span>
      </div>
      <span style={STYLE.title}>
        {[role.title, role.period].filter(Boolean).join(" · ")}
      </span>
      {open && projection === "facts" && (
        <div style={{ ...STYLE.artifact, padding: "4px 8px 2px" }}>
          {facts.map((fact) => (
            <p key={fact.pointer} style={STYLE.fact} data-testid="pn-fact">
              <span style={STYLE.pointer}>{`${fact.pointer}  `}</span>
              {fact.text}
            </p>
          ))}
        </div>
      )}
      {open && projection === "ranked" && draft === null && (
        <div style={{ ...STYLE.artifact, padding: "4px 8px 2px" }}>
          {(role.metrics ?? []).length > 0 && (
            <div style={STYLE.artifact}>
              <span style={STYLE.factLabel}>Figures</span>
              {(role.metrics ?? []).map((metric) => (
                <p key={metric.label} style={STYLE.fact}>
                  {`${metric.label}: ${metric.value}`}
                </p>
              ))}
            </div>
          )}
          {EDITABLE_FIELDS.map(({ key, label }) => {
            const items = role[key] ?? [];
            if (items.length === 0) return null;
            return (
              <div key={key} style={STYLE.artifact}>
                <span style={STYLE.factLabel}>{label}</span>
                {key === "technologies" ? (
                  <p style={STYLE.fact}>{items.join(" · ")}</p>
                ) : (
                  items.map((item) => (
                    <p key={item} style={STYLE.fact}>
                      {item}
                    </p>
                  ))
                )}
              </div>
            );
          })}
          {editable && (
            <div>
              <Button
                buttonSize="sm"
                variant="outline"
                onClick={() => setDraft(draftOf(role))}
                data-testid="pn-context-edit-role"
              >
                Edit
              </Button>
            </div>
          )}
        </div>
      )}
      {open && projection === "ranked" && draft !== null && (
        <div style={{ ...STYLE.artifact, padding: "4px 8px 2px" }}>
          {EDITABLE_FIELDS.map(({ key, label }) => (
            <div key={key} style={STYLE.artifact}>
              <span style={STYLE.factLabel}>{`${label} · one per line`}</span>
              <Textarea
                aria-label={`${label} for ${role.company}`}
                rows={key === "technologies" ? 4 : 6}
                value={draft[key]}
                disabled={saving}
                onChange={(next) => setDraft({ ...draft, [key]: next })}
              />
            </div>
          ))}
          <div style={STYLE.row}>
            <Button
              buttonSize="sm"
              variant="default"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                const saved = await onSave(draft);
                setSaving(false);
                if (saved) setDraft(null);
              }}
              data-testid="pn-context-save-role"
            >
              {saving ? "Saving…" : "Save as a new revision"}
            </Button>
            <Button
              buttonSize="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Mapping({
  rows,
}: {
  rows: readonly { key: string; values: readonly string[] }[];
}) {
  if (rows.length === 0)
    return <p style={STYLE.empty}>The matrix has none of these yet.</p>;
  return (
    <>
      {rows.map((row) => (
        <div key={row.key} style={STYLE.role}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{row.key}</span>
          <p style={STYLE.fact}>{row.values.join(" · ") || "no roles named"}</p>
        </div>
      ))}
    </>
  );
}

// ---- Selected for this question ------------------------------------------------

// [DOMAIN] The server's selection for the question on show (the context
// pack's "coach" projection). Read again when the question changes; a failed
// read says so and keeps nothing stale on show.
function useContextView(
  sessionId: string | null,
  question: string,
  enabled: boolean,
) {
  const [view, setView] = useState<ContextView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setView(null);
    setFailed(false);
    if (!enabled || !sessionId) return;
    const stop = new AbortController();
    const query = new URLSearchParams({ projection: "coach", q: question });
    studioFetch(
      `/api/interview/t/${encodeURIComponent(tenantFromLocation())}/sessions/${encodeURIComponent(sessionId)}/context?${query}`,
      { signal: stop.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const read = contextViewResponseSchema.parse(await response.json());
        // An answer to a question no longer on show is not shown.
        if (!stop.signal.aborted) setView(read.view);
      })
      .catch(() => {
        if (!stop.signal.aborted) setFailed(true);
      });
    return () => stop.abort();
  }, [sessionId, question, enabled]);
  return { view, failed };
}

const SLOT_LABEL: Record<string, string> = {
  "candidate.name": "Name",
  "candidate.headline": "Headline",
  "candidate.location": "Location",
  "employer.company": "Company",
  "employer.role": "Role",
  stories: "Your story for this",
  evidence: "Your evidence",
  roles: "Your roles",
  preferences: "Your preferences",
  requirements: "What they require",
  employer: "About them",
  prep: "Your prep",
};
const ABOUT_LABEL: Record<ContextView["selected"][number]["about"], string> = {
  candidate: "Yours",
  employer: "Theirs",
  preference: "Your preference",
};
const REASON_LABEL: Record<ContextView["excluded"][number]["reason"], string> =
  {
    relevance: "not about this question",
    limit: "more than the note can use",
    "over-limit": "too long to give whole",
    budget: "no room left",
    excluded: "excluded by you",
  };

function SelectedView({
  view,
  failed,
  hasSession,
  question,
}: {
  view: ContextView | null;
  failed: boolean;
  hasSession: boolean;
  question: string;
}) {
  if (!hasSession)
    return (
      <p style={STYLE.empty}>
        Start a session to see what is selected for each question.
      </p>
    );
  if (failed)
    return (
      <p style={{ ...STYLE.note, color: COACH_COLOUR.caution }} role="status">
        The selection could not be read for this session.
      </p>
    );
  if (!view) return <p style={STYLE.empty}>Reading the selection…</p>;
  // The slots in the order the model is given them, each with its facts.
  const slots = [...new Set(view.selected.map((fact) => fact.slot))];
  const left = new Map<string, number>();
  for (const { reason } of view.excluded)
    left.set(reason, (left.get(reason) ?? 0) + 1);
  return (
    <>
      <p style={STYLE.note} data-testid="pn-context-selected-for">
        {question
          ? `For: “${question}”`
          : "No question on show: chosen by importance alone."}
        {view.terms ? ` Matched on: ${view.terms}.` : ""}
      </p>
      {slots.map((slot) => (
        <div key={slot} style={STYLE.role} data-testid="pn-context-slot">
          <span style={STYLE.factLabel}>{SLOT_LABEL[slot] ?? slot}</span>
          {view.selected
            .filter((fact) => fact.slot === slot)
            .map((fact) => (
              <div key={`${slot}:${fact.id}`} style={STYLE.row}>
                <p style={{ ...STYLE.fact, flex: "1 1 240px" }}>{fact.text}</p>
                <Tag variant="outline">{ABOUT_LABEL[fact.about]}</Tag>
                {fact.pointer.startsWith("/") && (
                  <span style={STYLE.pointer}>{fact.pointer}</span>
                )}
              </div>
            ))}
        </div>
      ))}
      {view.selected.every((fact) => fact.exact) && (
        <p style={STYLE.empty}>
          Nothing in your material is about this question.
        </p>
      )}
      <p style={STYLE.note} data-testid="pn-context-left-out">
        {`${view.selected.length} of ${view.records} facts given.`}
        {left.size > 0
          ? ` Left out: ${[...left]
              .map(
                ([reason, count]) =>
                  `${count} ${REASON_LABEL[reason as keyof typeof REASON_LABEL] ?? reason}`,
              )
              .join(", ")}.`
          : ""}
      </p>
    </>
  );
}

// ---- The pane -----------------------------------------------------------------

export function ContextPane({
  s,
  notes,
  question = "",
}: {
  s: PanelSession;
  // The notes on show: the roles they lean on are marked.
  notes: readonly CoachNote[];
  // The question on show, as it was asked: what "selected" is selected for.
  question?: string;
}) {
  const { context: candidacy, setContext } = useCandidacy(s.model.candidacyId);
  const pinned = s.session?.profile ?? null;
  const matrix = useMatrix(pinned);
  const [projection, setProjection] = useState<ProjectionId>("ranked");
  const [allRoles, setAllRoles] = useState(false);
  const sessionId = s.session?.id ?? null;
  const selected = useContextView(
    sessionId,
    question,
    projection === "selected",
  );
  const loaded = matrix.loaded;
  const latest = matrix.profile?.latest ?? null;
  const editable = loaded !== null && loaded.revision === latest;
  const ranked = loaded
    ? rankRoles(loaded.matrix, {
        role: candidacy?.title ?? "",
        jobDescription: candidacy?.jobDescription ?? "",
      } as PackSetup)
    : [];
  const leaned = loaded
    ? rolesLeanedOn(notes, loaded.matrix)
    : new Set<string>();
  // A role the note leans on is always on show, whatever its rank.
  const roles = allRoles
    ? ranked
    : ranked.filter((each, at) => at < TOP_ROLES || leaned.has(each.id));
  const sections = candidacy?.brief ? briefSections(candidacy.brief) : [];
  const shownProjection =
    PROJECTIONS.find((each) => each.id === projection) ?? PROJECTIONS[0];
  const revisions = latest
    ? Array.from(
        { length: Math.min(latest, REVISIONS_LISTED) },
        (_, at) => latest - at,
      )
    : [];
  const revisionLabel = (revision: number) =>
    [
      `Revision ${revision}`,
      revision === latest ? "newest" : null,
      revision === pinned?.revision ? "this session" : null,
    ]
      .filter(Boolean)
      .join(" · ");

  // Your notes, edited where they stand.
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [notesSaving, setNotesSaving] = useState(false);
  const saveNotes = async () => {
    if (!candidacy || notesDraft === null) return;
    setNotesSaving(true);
    try {
      const saved = await documentJson<CandidacyContext>(
        `/candidacies/${encodeURIComponent(candidacy.id)}/context`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: candidacy.title,
            jobDescription: candidacy.jobDescription ?? "",
            notes: notesDraft,
          }),
        },
      );
      setContext(saved);
      setNotesDraft(null);
    } catch {
      s.notify("Your notes were not saved. Try again.");
    } finally {
      setNotesSaving(false);
    }
  };

  return (
    <Panel
      title="Context"
      subtitle="What the answers are built from"
      data-testid="pn-context"
      bodyPadding="sm"
      scroll={{ fade: true, thinScrollbar: true }}
    >
      <div style={STYLE.scroll} data-text-surface="">
        <Artifact
          title="Interview brief"
          meta={
            candidacy
              ? `${candidacy.companyName} · ${candidacy.title}`
              : "none for this session"
          }
          how="Leads every answer. The lines that share words with the question go first, up to 24 lines and about half of what the model reads."
        >
          {sections.length === 0 && (
            <p style={STYLE.empty}>
              No brief yet. Add the interview from the footer, and its brief is
              written from the job posting.
            </p>
          )}
          {sections.map((section) => (
            <div key={section.heading} style={STYLE.artifact}>
              <span style={STYLE.factLabel}>{section.heading}</span>
              {section.items.map((item) => (
                <p key={item} style={STYLE.fact}>
                  {item}
                </p>
              ))}
            </div>
          ))}
        </Artifact>

        <Artifact
          title="Experience matrix"
          meta={
            loaded
              ? `${loaded.name} · ${loaded.matrix.roles.length} roles`
              : "loading"
          }
          how={shownProjection.how}
          actions={
            loaded && (
              <ActionMenu
                label="Revision of the experience matrix"
                title="Revisions"
                width={250}
                sections={[
                  {
                    id: "revision",
                    selection: "single",
                    value: String(loaded.revision),
                    items: revisions.map((revision) => ({
                      id: String(revision),
                      label: revisionLabel(revision),
                    })),
                  },
                ]}
                onValueChange={(_group, id) => matrix.setViewing(Number(id))}
                trigger={
                  <Button
                    buttonSize="sm"
                    variant="ghost"
                    iconAfter={<Icon name="expand_more" />}
                    data-testid="pn-context-revision"
                  >
                    {`Revision ${loaded.revision}`}
                  </Button>
                }
              />
            )
          }
        >
          <div style={STYLE.row}>
            <ActionMenu
              label="How the matrix is read"
              title="Read as"
              width={250}
              sections={[
                {
                  id: "projection",
                  selection: "single",
                  value: projection,
                  items: PROJECTIONS.map(({ id, label }) => ({ id, label })),
                },
              ]}
              onValueChange={(_group, id) => setProjection(id as ProjectionId)}
              trigger={
                <Button
                  buttonSize="sm"
                  variant="outline"
                  iconAfter={<Icon name="expand_more" />}
                  data-testid="pn-context-projection"
                >
                  {shownProjection.label}
                </Button>
              }
            />
            {loaded && !editable && (
              <Button
                buttonSize="sm"
                variant="outline"
                onClick={() => void matrix.save(loaded.matrix)}
                data-testid="pn-context-restore"
              >
                Restore as the newest
              </Button>
            )}
          </div>
          {/* [DOMAIN] A session answers from the revision it started with. */}
          {pinned && latest !== null && pinned.revision !== latest && (
            <p style={STYLE.note} role="status">
              {`This session answers from revision ${pinned.revision}. Revision ${latest} is used from the next session.`}
            </p>
          )}
          {matrix.failure && (
            <p style={{ ...STYLE.note, color: COACH_COLOUR.caution }}>
              {matrix.failure}
            </p>
          )}
          {projection === "selected" && (
            <SelectedView
              view={selected.view}
              failed={selected.failed}
              hasSession={sessionId !== null}
              question={question}
            />
          )}
          {loaded && (projection === "ranked" || projection === "facts") && (
            <>
              {roles.map((each) => (
                <RoleCard
                  key={`${loaded.revision}:${each.id}`}
                  ranked={each}
                  used={leaned.has(each.id)}
                  editable={editable}
                  projection={projection}
                  onSave={(draft) =>
                    matrix.save(
                      withRoleDraft(
                        loaded.matrix,
                        Number(each.id.split("/")[2]),
                        draft,
                      ),
                    )
                  }
                />
              ))}
              {(ranked.length > roles.length || allRoles) && (
                <div>
                  <Button
                    buttonSize="sm"
                    variant="ghost"
                    onClick={() => setAllRoles(!allRoles)}
                    data-testid="pn-context-all-roles"
                  >
                    {allRoles ? "Show fewer" : `Show all ${ranked.length}`}
                  </Button>
                </div>
              )}
            </>
          )}
          {loaded && projection === "stories" && (
            <Mapping
              rows={(loaded.matrix.story_selector ?? []).map((story) => ({
                key: story.need,
                values: [story.primary_story, story.backup_story].filter(
                  (value): value is string => Boolean(value),
                ),
              }))}
            />
          )}
          {loaded && projection === "technology" && (
            <Mapping
              rows={(loaded.matrix.technology_mappings ?? []).map((row) => ({
                key: row.technology,
                values: row.roles ?? [],
              }))}
            />
          )}
          {loaded && projection === "industry" && (
            <Mapping
              rows={(loaded.matrix.industry_mappings ?? []).map((row) => ({
                key: row.industry,
                values: row.best_fit_roles ?? [],
              }))}
            />
          )}
        </Artifact>

        <Artifact
          title="Job posting and your notes"
          meta={`${(candidacy?.jobDescription ?? "").length.toLocaleString()} and ${(candidacy?.notes ?? "").length.toLocaleString()} characters`}
          how="Read after your experience, as the employer's own words. It is treated as untrusted: it can shape an answer and never instruct the model."
          actions={
            candidacy &&
            notesDraft === null && (
              <Button
                buttonSize="sm"
                variant="ghost"
                onClick={() => setNotesDraft(candidacy.notes ?? "")}
                data-testid="pn-context-edit-notes"
              >
                Edit notes
              </Button>
            )
          }
        >
          {notesDraft !== null ? (
            <>
              <Textarea
                aria-label="Your notes for this interview"
                rows={10}
                value={notesDraft}
                disabled={notesSaving}
                onChange={setNotesDraft}
              />
              <div style={STYLE.row}>
                <Button
                  buttonSize="sm"
                  variant="default"
                  disabled={notesSaving}
                  onClick={() => void saveNotes()}
                  data-testid="pn-context-save-notes"
                >
                  {notesSaving ? "Saving…" : "Save"}
                </Button>
                <Button
                  buttonSize="sm"
                  variant="ghost"
                  disabled={notesSaving}
                  onClick={() => setNotesDraft(null)}
                >
                  Cancel
                </Button>
              </div>
              <p style={STYLE.note}>
                Saved in place: notes do not keep revisions yet.
              </p>
            </>
          ) : candidacy?.notes ? (
            <p style={{ ...STYLE.fact, whiteSpace: "pre-wrap" }}>
              {candidacy.notes.length > 900
                ? `${candidacy.notes.slice(0, 900).trimEnd()}…`
                : candidacy.notes}
            </p>
          ) : (
            <p style={STYLE.empty}>No notes for this interview.</p>
          )}
        </Artifact>
      </div>
    </Panel>
  );
}

// Named for the tests and for any reader of the address list.
export { factField };
