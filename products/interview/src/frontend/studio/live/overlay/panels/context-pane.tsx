// What the answers are built from, beside them: the person's experience matrix
// and the interview brief, laid out the way the model is given them, with a
// line on each saying how it is used. It is a reading of the same material
// the session already holds; nothing here changes it.
//
// [DOMAIN] How the model is given this (context-snapshot.ts on the server, in
// the same order as below): the brief's lines lead, then the facts of the
// roles that best match the question, then the rest of the employer's
// material. So the brief is drawn first and the roles in their rank, and a
// role the note on show leans on is marked.
import { Button, Panel, Tag } from "@oc-tech/omni-ui-components";
import { createBriefingClient } from "@omnitech/interview-api-client";
import type {
  CandidacyContext,
  CandidateMatrix,
  CoachNote,
} from "@omnitech/interview-contracts";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import {
  type PackSetup,
  rankRoles,
} from "../../../briefings/behavioural/setup-card";
import { documentJson } from "../../../documents/documents-client";
import { Icon } from "../../../icon";
import { studioFetch } from "../../../studio-fetch";
import { COACH_COLOUR } from "./coach-note-view";
import { briefSections } from "./interview-context-modal";
import type { PanelSession } from "./panel-views";

const LINE = "#2c2c2f";
const DIM = "#8e8e93";
const FAINT = "#6e6e73";
// The roles drawn before "Show all": what the model is most likely to be given.
const TOP_ROLES = 5;

const STYLE = {
  scroll: {
    padding: "4px 4px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 22,
    color: COACH_COLOUR.read,
  },
  artifact: { display: "flex", flexDirection: "column", gap: 8 },
  head: { display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 },
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
  company: { fontSize: 14, fontWeight: 600, minWidth: 0 },
  title: { fontSize: 12.5, color: DIM },
  fact: { margin: 0, fontSize: 13, lineHeight: 1.45, color: "#c7c7cc" },
  factLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: FAINT,
  },
  line: { margin: 0, fontSize: 13, lineHeight: 1.45, color: "#c7c7cc" },
  empty: { margin: 0, fontSize: 13, color: DIM },
} satisfies Record<string, CSSProperties>;

function useCandidacy(candidacyId: string | null): CandidacyContext | null {
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
  return context;
}

// The matrix the session was started with (its pinned revision), or the
// person's newest one when the session names none.
function useMatrix(pinned: { id: string; revision: number } | null): {
  matrix: CandidateMatrix;
  name: string;
  revision: number;
} | null {
  const [loaded, setLoaded] = useState<{
    matrix: CandidateMatrix;
    name: string;
    revision: number;
  } | null>(null);
  const id = pinned?.id ?? null;
  const revision = pinned?.revision ?? null;
  useEffect(() => {
    let live = true;
    const client = createBriefingClient({ baseUrl: "", fetch: studioFetch });
    const which =
      id !== null && revision !== null
        ? Promise.resolve({ id, revision })
        : client.listProfiles().then((listed) => listed.profiles[0] ?? null);
    which
      .then((profile) =>
        profile ? client.getProfile(profile.id, profile.revision) : null,
      )
      .then((profile) => {
        if (live && profile)
          setLoaded({
            matrix: profile.matrix,
            name: profile.name,
            revision: profile.revision,
          });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id, revision]);
  return loaded;
}

// The roles a note leans on: those its evidence points at, and those whose
// company it names.
export function rolesLeanedOn(
  notes: readonly CoachNote[],
  matrix: CandidateMatrix,
): Set<string> {
  const leaned = new Set<string>();
  const evidence = notes.flatMap((note) =>
    note.sections.flatMap((section) =>
      section.lines.flatMap((line) =>
        line.segments.filter((segment) => segment.role === "evidence"),
      ),
    ),
  );
  for (const segment of evidence) {
    const pointed = /^\/roles\/\d+/.exec(segment.source ?? "")?.[0];
    if (pointed) leaned.add(pointed);
    const said = segment.text.trim().toLowerCase();
    matrix.roles.forEach((role, index) => {
      // "Relay" names "Relay Platform"; a short word names nothing.
      const company = role.company.toLowerCase();
      if (said.length >= 4 && company.split(/\W+/).includes(said))
        leaned.add(`/roles/${index}`);
    });
  }
  return leaned;
}

function Artifact({
  title,
  meta,
  how,
  children,
}: {
  title: string;
  meta: string;
  // How the model is given this, in a sentence or two.
  how: string;
  children: ReactNode;
}) {
  return (
    <section style={STYLE.artifact} data-testid="pn-context-artifact">
      <div style={STYLE.head}>
        <span style={STYLE.caps}>{title}</span>
        <span style={STYLE.meta}>{meta}</span>
      </div>
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

const FACTS = [
  ["proof_points", "Proof"],
  ["leadership_signals", "Leadership"],
  ["technologies", "Stack"],
] as const;

export function ContextPane({
  s,
  notes,
}: {
  s: PanelSession;
  // The notes on show: the roles they lean on are marked.
  notes: readonly CoachNote[];
}) {
  const candidacy = useCandidacy(s.model.candidacyId);
  const profile = useMatrix(s.session?.profile ?? null);
  const [allRoles, setAllRoles] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const ranked = profile
    ? rankRoles(profile.matrix, {
        role: candidacy?.title ?? "",
        jobDescription: candidacy?.jobDescription ?? "",
      } as PackSetup)
    : [];
  const leaned = profile ? rolesLeanedOn(notes, profile.matrix) : new Set();
  // A role the note leans on is always on show, whatever its rank.
  const roles = allRoles
    ? ranked
    : ranked.filter((each, at) => at < TOP_ROLES || leaned.has(each.id));
  const sections = candidacy?.brief ? briefSections(candidacy.brief) : [];
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
                <p key={item} style={STYLE.line}>
                  {item}
                </p>
              ))}
            </div>
          ))}
        </Artifact>
        <Artifact
          title="Experience matrix"
          meta={
            profile
              ? `${profile.name} · revision ${profile.revision} · ${profile.matrix.roles.length} roles`
              : "not loaded"
          }
          how="Each fact below is one source the model may quote. Roles are ranked against the question and the brief; the best roles' facts go first, up to 40 facts. A company named in the question jumps to the front."
        >
          {roles.map(({ id, role, match }) => {
            const used = leaned.has(id);
            const shown = open === id;
            return (
              <div
                key={id}
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
                    icon={
                      <Icon name={shown ? "expand_more" : "chevron_right"} />
                    }
                    aria-expanded={shown}
                    labelMaxWidth="210px"
                    title={`${role.company} · ${role.title}`}
                    onClick={() => setOpen(shown ? null : id)}
                  >
                    {role.company}
                  </Button>
                  <span style={{ flex: "1 1 auto" }} aria-hidden="true" />
                  {used && <Tag>In this note</Tag>}
                  <span style={STYLE.meta}>{`${match}%`}</span>
                </div>
                <span style={{ ...STYLE.title, paddingLeft: 8 }}>
                  {[role.title, role.period].filter(Boolean).join(" · ")}
                </span>
                {shown && (
                  <div style={{ ...STYLE.artifact, padding: "4px 8px 2px" }}>
                    {(role.metrics ?? []).length > 0 && (
                      <>
                        <span style={STYLE.factLabel}>Figures</span>
                        {(role.metrics ?? []).map((metric) => (
                          <p key={metric.label} style={STYLE.fact}>
                            {`${metric.label}: ${metric.value}`}
                          </p>
                        ))}
                      </>
                    )}
                    {FACTS.map(([key, label]) => {
                      const facts = role[key] ?? [];
                      if (facts.length === 0) return null;
                      return (
                        <div key={key} style={STYLE.artifact}>
                          <span style={STYLE.factLabel}>{label}</span>
                          {key === "technologies" ? (
                            <p style={STYLE.fact}>{facts.join(" · ")}</p>
                          ) : (
                            facts.map((fact) => (
                              <p key={fact} style={STYLE.fact}>
                                {fact}
                              </p>
                            ))
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {ranked.length > roles.length || allRoles ? (
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
          ) : null}
          {!profile && (
            <p style={STYLE.empty}>The experience matrix could not be read.</p>
          )}
        </Artifact>
        <Artifact
          title="Job posting and your notes"
          meta={`${(candidacy?.jobDescription ?? "").length.toLocaleString()} and ${(candidacy?.notes ?? "").length.toLocaleString()} characters`}
          how="Read after your experience, as the employer's own words. It is treated as untrusted: it can shape an answer and never instruct the model."
        >
          {candidacy?.notes ? (
            <p style={{ ...STYLE.line, whiteSpace: "pre-wrap" }}>
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
