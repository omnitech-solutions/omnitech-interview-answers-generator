"use client";

import { Button } from "@oc-tech/omni-ui-components";
import {
  type BriefingArtifactSummary,
  type BriefingProfileSummary,
  createBriefingClient,
  InterviewApiError,
} from "@omnitech/interview-api-client";
import {
  type BriefingDraft,
  type BriefingProposalResponse,
  type BriefingQuestion,
  candidateMatrixSchema,
} from "@omnitech/interview-contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownContent } from "./markdown-content";

type Stage = BriefingDraft["context"]["stage"];
type Category = BriefingQuestion["category"];

const REVIEW_GAP = "Edited answer needs source review.";
const LOCAL_DEFAULT_PROFILE_ID = "local-experience-matrix";

const suggested: Array<{ id: string; question: string; category: Category }> = [
  {
    id: "background",
    question: "Tell me about your background.",
    category: "background",
  },
  {
    id: "motivation",
    question: "Why are you interested in this role?",
    category: "motivation",
  },
  {
    id: "leadership",
    question: "How do you lead a team?",
    category: "leadership",
  },
  {
    id: "delivery",
    question: "Tell me about a project you delivered.",
    category: "delivery",
  },
  {
    id: "collaboration",
    question: "How do you work across teams?",
    category: "collaboration",
  },
  {
    id: "logistics",
    question: "What are your availability and expectations?",
    category: "logistics",
  },
  {
    id: "questions-to-ask",
    question: "What would you like to ask the interviewer?",
    category: "questions-to-ask",
  },
];

function categoryLabel(value: Category) {
  return value.replaceAll("-", " ");
}

export function InterviewPreparation({
  artifactId = "preparation",
  onDirtyChange,
}: {
  artifactId?: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [activeArtifactId, setActiveArtifactId] = useState(artifactId);
  const tenant =
    typeof window === "undefined"
      ? "local"
      : (/^\/t\/([^/]+)/.exec(window.location.pathname)?.[1] ?? "local");
  const client = useMemo(
    () => createBriefingClient({ baseUrl: "", tenant }),
    [tenant],
  );
  const [profiles, setProfiles] = useState<BriefingProfileSummary[]>([]);
  const [artifacts, setArtifacts] = useState<BriefingArtifactSummary[]>([]);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [rolePointers, setRolePointers] = useState<
    Array<{ pointer: string; label: string }>
  >([]);
  const [selectedStories, setSelectedStories] = useState<string[]>([]);
  const [matrixText, setMatrixText] = useState("");
  const [matrixFileName, setMatrixFileName] = useState("Pasted JSON");
  const [matrixPreview, setMatrixPreview] = useState<
    import("@omnitech/interview-contracts").CandidateMatrix | null
  >(null);
  const [profileName, setProfileName] = useState("");
  const [updateExistingProfile, setUpdateExistingProfile] = useState(false);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [stage, setStage] = useState<Stage>("recruiter");
  const [jobDescription, setJobDescription] = useState("");
  const [employerNotes, setEmployerNotes] = useState("");
  const [candidatePreferences, setCandidatePreferences] = useState("");
  const [questions, setQuestions] = useState(suggested.slice(0, 1));
  const [draft, setDraft] = useState<BriefingDraft | null>(null);
  const [proposal, setProposal] = useState<BriefingProposalResponse | null>(
    null,
  );
  const [proposalStale, setProposalStale] = useState(false);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [needsSave, setNeedsSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState(false);
  const [refinement, setRefinement] = useState<Record<string, string>>({});
  const editSequence = useRef(0);

  useEffect(() => {
    setActiveArtifactId(artifactId);
  }, [artifactId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profileResponse, record, artifactResponse] = await Promise.all([
        client.listProfiles(),
        client.getArtifact(activeArtifactId).catch((error: unknown) => {
          if (error instanceof InterviewApiError && error.status === 404)
            return {
              origin: { artifactRevision: 0 },
              value: { briefing: null },
            };
          throw error;
        }),
        client.listArtifacts(),
      ]);
      setProfiles(profileResponse.profiles);
      setArtifacts(artifactResponse.artifacts);
      setSelectedStories([]);
      setRevision(record.origin.artifactRevision);
      const briefing = record.value.briefing ?? null;
      setDraft(briefing);
      if (briefing) {
        const context = briefing.context;
        setCompany(context.company);
        setRole(context.role);
        setStage(context.stage);
        setJobDescription(context.jobDescription ?? "");
        setEmployerNotes(context.employerNotes ?? "");
        setCandidatePreferences(context.candidatePreferences ?? "");
        setSelectedProfile(`${context.profile.id}:${context.profile.revision}`);
        setQuestions(
          briefing.questions.map(({ id, question, category }) => ({
            id,
            question,
            category,
          })),
        );
      } else {
        setCompany("");
        setRole("");
        setStage("recruiter");
        setJobDescription("");
        setEmployerNotes("");
        setCandidatePreferences("");
        const localDefault = profileResponse.profiles.find(
          (profile) => profile.id === LOCAL_DEFAULT_PROFILE_ID,
        );
        setSelectedProfile(
          localDefault ? `${localDefault.id}:${localDefault.revision}` : "",
        );
        setQuestions(suggested.slice(0, 1));
      }
      setProposal(null);
      setProposalStale(false);
      setDirty(false);
      setNeedsSave(false);
      setConflict(false);
      setStatus(briefing ? "Draft loaded." : "No briefing draft yet.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [activeArtifactId, client]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    onDirtyChange?.(dirty || needsSave || !!proposal);
  }, [dirty, needsSave, proposal, onDirtyChange]);
  useEffect(() => {
    if (!dirty && !needsSave && !proposal) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, needsSave, proposal]);

  useEffect(() => {
    const [id, revisionText] = selectedProfile.split(":");
    if (!id || !revisionText) {
      setRolePointers([]);
      return;
    }
    let current = true;
    void client
      .getProfile(id, Number(revisionText))
      .then((response) => {
        if (!current) return;
        setRolePointers(
          (response.matrix.roles ?? []).map((item, index) => ({
            pointer: `/roles/${index}`,
            label: `${item.title} at ${item.company}`,
          })),
        );
      })
      .catch((error) => {
        if (current)
          setStatus(error instanceof Error ? error.message : String(error));
      });
    return () => {
      current = false;
    };
  }, [selectedProfile, client]);

  function changed() {
    editSequence.current += 1;
    setDirty(true);
    setProposalStale(true);
    setConflict(false);
  }

  async function previewMatrix(text: string) {
    try {
      const parsed = candidateMatrixSchema.parse(JSON.parse(text));
      setMatrixPreview(parsed);
      setStatus("Matrix preview is ready. Confirm to import it.");
    } catch (error) {
      setMatrixPreview(null);
      setStatus(
        error instanceof Error ? error.message : "Invalid matrix JSON.",
      );
    }
  }

  async function importMatrix() {
    if (!matrixPreview || !profileName.trim()) return;
    setBusy(true);
    try {
      const [profileId] = selectedProfile.split(":");
      const latestRevision = profiles.find(
        (item) => item.id === profileId,
      )?.revision;
      const result = await client.importProfile({
        name: profileName.trim(),
        matrix: matrixPreview,
        ...(updateExistingProfile && profileId && latestRevision !== undefined
          ? { profileId, expectedRevision: latestRevision }
          : {}),
      });
      setProfiles((await client.listProfiles()).profiles);
      setSelectedProfile(`${result.id}:${result.revision}`);
      setSelectedStories([]);
      setMatrixPreview(null);
      setStatus(`Imported ${result.name} revision ${result.revision}.`);
      changed();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function context() {
    const [id, revisionText] = selectedProfile.split(":");
    if (!id || !revisionText || !company.trim() || !role.trim()) return null;
    return {
      company: company.trim(),
      role: role.trim(),
      stage,
      jobDescription,
      employerNotes,
      candidatePreferences,
      profile: { id, revision: Number(revisionText) },
    };
  }

  function questionsChanged() {
    if (!draft || !draft.questions.length) return false;
    return (
      JSON.stringify(questions) !==
      JSON.stringify(
        draft.questions.map(({ id, question, category }) => ({
          id,
          question,
          category,
        })),
      )
    );
  }

  function contextChanged() {
    if (!draft?.questions.length) return false;
    const current = context();
    const saved = draft.context;
    return (
      !current ||
      current.company !== saved.company ||
      current.role !== saved.role ||
      current.stage !== saved.stage ||
      current.jobDescription !== (saved.jobDescription ?? "") ||
      current.employerNotes !== (saved.employerNotes ?? "") ||
      current.candidatePreferences !== (saved.candidatePreferences ?? "") ||
      current.profile.id !== saved.profile.id ||
      current.profile.revision !== saved.profile.revision
    );
  }

  async function generate(questionId?: string) {
    const currentContext = context();
    if (
      !currentContext ||
      !questions.length ||
      questions.some((item) => !item.question.trim())
    ) {
      setStatus(
        "Select a profile and complete the company, role, and questions.",
      );
      return;
    }
    if (questionId && (questionsChanged() || contextChanged())) {
      setStatus(
        "Questions or context changed. Generate a complete proposal before refining one card.",
      );
      return;
    }
    const requestSequence = editSequence.current;
    let synced = false;
    setBusy(true);
    try {
      let expectedRevision = revision;
      if (!draft) {
        const initial: BriefingDraft = {
          kind: "non-technical-briefing",
          title: `${currentContext.company} — ${currentContext.role}`,
          context: currentContext,
          questions: [],
        };
        const created = await client.editArtifact(activeArtifactId, {
          expectedRevision: 0,
          briefing: initial,
        });
        expectedRevision = created.origin.artifactRevision;
        setRevision(expectedRevision);
        setDraft(created.value.briefing ?? initial);
        setNeedsSave(true);
        synced = true;
      } else if (dirty) {
        const updated = { ...draft, context: currentContext };
        const flushed = await client.editArtifact(activeArtifactId, {
          expectedRevision,
          briefing: updated,
        });
        expectedRevision = flushed.origin.artifactRevision;
        setRevision(expectedRevision);
        setDraft(flushed.value.briefing ?? updated);
        setDirty(false);
        setNeedsSave(true);
        synced = true;
      }
      const result = await client.propose(activeArtifactId, {
        expectedRevision,
        context: currentContext,
        questions: questionId
          ? questions.filter((question) => question.id === questionId)
          : questions,
        ...(selectedStories.length ? { storyIds: selectedStories } : {}),
        ...(questionId
          ? { questionId, instruction: refinement[questionId] ?? "" }
          : {}),
      });
      setProposal(result);
      setProposalStale(editSequence.current !== requestSequence);
      setStatus("Proposal preview is ready. Review and apply it explicitly.");
    } catch (error) {
      handleError(error);
      if (synced)
        setStatus(
          `Draft changes synced, but proposal failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
      setBusy(false);
    }
  }

  function handleError(error: unknown) {
    setStatus(error instanceof Error ? error.message : String(error));
    if (error instanceof InterviewApiError && error.status === 409)
      setConflict(true);
  }

  async function apply() {
    if (!proposal || proposalStale) return;
    setBusy(true);
    try {
      const result = await client.apply(activeArtifactId, {
        proposalId: proposal.id,
        expectedRevision: proposal.baseRevision,
      });
      setDraft(result.value.briefing ?? proposal.briefing);
      setRevision(result.origin.artifactRevision);
      setQuestions(
        (result.value.briefing ?? proposal.briefing).questions.map(
          ({ id, question, category }) => ({ id, question, category }),
        ),
      );
      setProposal(null);
      setDirty(false);
      setNeedsSave(true);
      setStatus("Draft applied. Save the complete pack when ready.");
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    if (questionsChanged() || contextChanged()) {
      setStatus(
        "Questions or context changed. Generate and apply a new proposal before saving this pack.",
      );
      return;
    }
    setBusy(true);
    try {
      let nextRevision = revision;
      if (dirty) {
        const currentContext = context();
        if (!currentContext)
          throw new Error(
            "Complete the profile, company, and role before saving.",
          );
        const updated = {
          ...draft,
          context: currentContext,
          questions: draft.questions,
        };
        const result = await client.editArtifact(activeArtifactId, {
          expectedRevision: revision,
          briefing: updated,
        });
        nextRevision = result.origin.artifactRevision;
        setDraft(result.value.briefing ?? updated);
        setRevision(nextRevision);
      }
      const saved = await client.save(activeArtifactId, {
        expectedRevision: nextRevision,
        requestId: crypto.randomUUID(),
      });
      setDirty(false);
      setNeedsSave(false);
      setStatus(`Saved revision ${saved.savedRevision}.`);
      setArtifacts((items) => {
        const updated = {
          id: activeArtifactId,
          title: saved.value.briefing?.title ?? draft.title,
          revision: nextRevision,
          savedRevision: saved.savedRevision,
          updatedAt: saved.createdAt,
        };
        return items.some((item) => item.id === activeArtifactId)
          ? items.map((item) => (item.id === activeArtifactId ? updated : item))
          : [...items, updated];
      });
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }

  function editQuestion(id: string, update: Partial<BriefingQuestion>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            questions: current.questions.map((item) =>
              item.id === id
                ? {
                    ...item,
                    ...update,
                    gaps: item.gaps.includes(REVIEW_GAP)
                      ? item.gaps
                      : [...item.gaps, REVIEW_GAP],
                  }
                : item,
            ),
          }
        : current,
    );
    changed();
  }

  if (loading)
    return (
      <section aria-label="Interview preparation">
        <p role="status">Loading briefing…</p>
      </section>
    );

  return (
    <section
      aria-label="Interview preparation"
      className="interview-preparation"
    >
      <header>
        <h1>Interview preparation</h1>
        <p>
          Prepare a spoken, nontechnical briefing from your experience matrix.
          Your configured local matrix is selected automatically. Review each
          proposal before applying it, then save the complete pack.
        </p>
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            if (
              (dirty || needsSave || proposal) &&
              !window.confirm(
                "Discard unsaved changes and start a new interview pack?",
              )
            )
              return;
            setActiveArtifactId(`briefing-${crypto.randomUUID()}`);
          }}
        >
          New pack
        </Button>
      </header>
      <p role="status">{status}</p>
      {conflict && (
        <Button type="button" onClick={() => void load()}>
          Discard local edits and reload server version
        </Button>
      )}
      <section
        aria-label="Candidate profile"
        style={{
          border: "1px solid var(--line)",
          borderRadius: 8,
          padding: 16,
        }}
      >
        <h2>Candidate profile</h2>
        <label>
          Candidate profile{" "}
          <select
            value={selectedProfile}
            onChange={(event) => {
              setSelectedProfile(event.target.value);
              setSelectedStories([]);
              changed();
            }}
          >
            <option value="">No profile selected</option>
            {profiles.flatMap((item) =>
              Array.from({ length: item.revision }, (_, index) => (
                <option
                  key={`${item.id}:${index + 1}`}
                  value={`${item.id}:${index + 1}`}
                >
                  {item.name} · revision {index + 1}
                </option>
              )),
            )}
            {selectedProfile &&
              !profiles.some(
                (item) =>
                  item.id === selectedProfile.split(":")[0] &&
                  item.revision >= Number(selectedProfile.split(":")[1]),
              ) && (
                <option value={selectedProfile}>
                  Selected profile · revision {selectedProfile.split(":")[1]}
                </option>
              )}
          </select>
        </label>
        {!profiles.length && (
          <p>No profile selected. Paste or choose a matrix file to begin.</p>
        )}
        <p>
          Import a matrix JSON file or paste its contents. Preview before
          confirming.
        </p>
        <label>
          Matrix JSON file{" "}
          <input
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file)
                void file.text().then((text) => {
                  setMatrixText(text);
                  setMatrixFileName(file.name);
                  setMatrixPreview(null);
                });
            }}
          />
        </label>
        <label style={{ display: "block" }}>
          Paste matrix JSON{" "}
          <textarea
            value={matrixText}
            onChange={(event) => {
              setMatrixText(event.target.value);
              setMatrixFileName("Pasted JSON");
              setMatrixPreview(null);
            }}
            rows={4}
            style={{ width: "100%" }}
          />
        </label>
        <Button
          type="button"
          onClick={() => void previewMatrix(matrixText)}
          disabled={!matrixText.trim()}
        >
          Preview matrix
        </Button>
        {matrixPreview && (
          <div aria-label="Matrix preview">
            <h3>Matrix preview</h3>
            <p>
              Source: {matrixFileName}. {matrixPreview.roles.length} role
              {matrixPreview.roles.length === 1 ? "" : "s"}. Import will create{" "}
              {updateExistingProfile
                ? "a new version of the selected profile"
                : "a new profile"}
              .
            </p>
            <p>
              {(matrixPreview as { candidate?: { name?: string } }).candidate
                ?.name ?? "Candidate"}
            </p>
            <ul>
              {(
                (
                  matrixPreview as {
                    roles?: Array<{
                      company: string;
                      title: string;
                      proof_points?: string[];
                    }>;
                  }
                ).roles ?? []
              ).map((item, index) => (
                <li key={index}>
                  {item.title} at {item.company}
                  {item.proof_points?.length
                    ? ` · ${item.proof_points.join(", ")}`
                    : " · No proof points supplied"}
                </li>
              ))}
            </ul>
            {!!matrixPreview.story_selector?.length && (
              <>
                <h4>Story choices</h4>
                <ul>
                  {matrixPreview.story_selector.map((item) => (
                    <li key={item.need}>
                      {item.need}: {item.primary_story}
                      {item.backup_story
                        ? ` (backup: ${item.backup_story})`
                        : ""}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <label>
              Profile name{" "}
              <input
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
              />
            </label>
            {selectedProfile &&
              profiles.some(
                (item) => item.id === selectedProfile.split(":")[0],
              ) && (
                <label style={{ display: "block" }}>
                  <input
                    type="checkbox"
                    checked={updateExistingProfile}
                    onChange={(event) =>
                      setUpdateExistingProfile(event.target.checked)
                    }
                  />{" "}
                  Import as a new revision of the selected profile
                </label>
              )}
            <Button
              type="button"
              onClick={() => void importMatrix()}
              disabled={!profileName.trim() || busy}
            >
              Confirm import
            </Button>
          </div>
        )}
      </section>
      <section
        aria-label="Interview context"
        style={{
          border: "1px solid var(--line)",
          borderRadius: 8,
          padding: 16,
        }}
      >
        <h2>Interview context</h2>
        <label>
          Company{" "}
          <input
            value={company}
            onChange={(event) => {
              setCompany(event.target.value);
              changed();
            }}
          />
        </label>
        <label>
          Role{" "}
          <input
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              changed();
            }}
          />
        </label>
        <label>
          Stage{" "}
          <select
            value={stage}
            onChange={(event) => {
              setStage(event.target.value as Stage);
              changed();
            }}
          >
            {["recruiter", "hiring-manager", "leadership", "behavioural"].map(
              (item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ),
            )}
          </select>
        </label>
        <label style={{ display: "block" }}>
          Job description{" "}
          <textarea
            value={jobDescription}
            onChange={(event) => {
              setJobDescription(event.target.value);
              changed();
            }}
            rows={3}
            style={{ width: "100%" }}
          />
        </label>
        <label style={{ display: "block" }}>
          Employer notes{" "}
          <textarea
            value={employerNotes}
            onChange={(event) => {
              setEmployerNotes(event.target.value);
              changed();
            }}
            rows={3}
            style={{ width: "100%" }}
          />
        </label>
        <label style={{ display: "block" }}>
          Candidate preferences{" "}
          <textarea
            value={candidatePreferences}
            onChange={(event) => {
              setCandidatePreferences(event.target.value);
              changed();
            }}
            rows={3}
            style={{ width: "100%" }}
          />
        </label>
        {rolePointers.length > 0 && (
          <fieldset>
            <legend>Candidate stories or roles to emphasize</legend>
            {rolePointers.map((item) => (
              <label key={item.pointer} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={selectedStories.includes(item.pointer)}
                  onChange={(event) => {
                    setSelectedStories((values) =>
                      event.target.checked
                        ? [...values, item.pointer]
                        : values.filter((value) => value !== item.pointer),
                    );
                    changed();
                  }}
                />
                {item.label}
              </label>
            ))}
          </fieldset>
        )}
      </section>
      <section
        aria-label="Interview questions"
        style={{
          border: "1px solid var(--line)",
          borderRadius: 8,
          padding: 16,
        }}
      >
        <h2>Questions</h2>
        <Button
          type="button"
          onClick={() => {
            setQuestions(suggested);
            changed();
          }}
        >
          Use suggested pre-screen list
        </Button>
        {questions.map((item, index) => (
          <div key={item.id} style={{ marginBlock: 8 }}>
            <label>
              Question {index + 1}{" "}
              <input
                value={item.question}
                onChange={(event) => {
                  setQuestions((items) =>
                    items.map((question) =>
                      question.id === item.id
                        ? { ...question, question: event.target.value }
                        : question,
                    ),
                  );
                  changed();
                }}
              />
            </label>
            <label>
              Category{" "}
              <select
                value={item.category}
                onChange={(event) => {
                  setQuestions((items) =>
                    items.map((question) =>
                      question.id === item.id
                        ? {
                            ...question,
                            category: event.target.value as Category,
                          }
                        : question,
                    ),
                  );
                  changed();
                }}
              >
                {suggested.map((option) => (
                  <option key={option.category} value={option.category}>
                    {categoryLabel(option.category)}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              aria-label={`Remove ${item.question}`}
              onClick={() => {
                setQuestions((items) =>
                  items.filter((question) => question.id !== item.id),
                );
                changed();
              }}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          type="button"
          onClick={() => {
            setQuestions((items) => [
              ...items,
              { id: crypto.randomUUID(), question: "", category: "background" },
            ]);
            changed();
          }}
        >
          Add question
        </Button>
        <p>
          <Button
            type="button"
            onClick={() => void generate()}
            disabled={busy || !context() || !questions.length}
          >
            Generate proposal
          </Button>
        </p>
      </section>
      {proposal && (
        <section
          aria-label="Proposal preview"
          style={{
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: 16,
          }}
        >
          <h2>Proposal preview</h2>
          {proposalStale && (
            <p role="alert">
              Context or questions changed. Generate a new proposal before
              applying.
            </p>
          )}
          {proposal.briefing.questions.map((item) => (
            <article key={item.id}>
              <h3>{item.question}</h3>
              <MarkdownContent>{item.answerMarkdown}</MarkdownContent>
              <p>
                30–60 second answer · {item.talkingPoints.length} talking points
              </p>
              <ol>
                {item.talkingPoints.map((point, index) => (
                  <li key={`${item.id}:${index}`}>{point}</li>
                ))}
              </ol>
              <details>
                <summary>Sources and gaps for {item.question}</summary>
                <ul>
                  {item.evidenceRefs.map((ref) => (
                    <li key={`${ref.id}:${ref.pointer}`}>
                      {ref.quote} ({ref.sourceKind} · revision {ref.revision} ·{" "}
                      {ref.pointer})
                    </li>
                  ))}
                </ul>
                <ul>
                  {item.gaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              </details>
            </article>
          ))}
          <Button
            type="button"
            onClick={() => void apply()}
            disabled={busy || proposalStale}
          >
            Apply proposal
          </Button>
        </section>
      )}
      {draft && (
        <section
          aria-label="Briefing draft"
          style={{
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: 16,
          }}
        >
          <h2>Briefing draft</h2>
          {(questionsChanged() || contextChanged()) && (
            <p role="alert">
              Questions or context changed. Generate and apply a complete
              proposal before saving or refining this pack.
            </p>
          )}
          <label>
            Pack title{" "}
            <input
              value={draft.title}
              onChange={(event) => {
                setDraft({ ...draft, title: event.target.value });
                changed();
              }}
            />
          </label>
          {draft.questions.map((item) => (
            <article
              key={item.id}
              style={{
                borderTop: "1px solid var(--line)",
                paddingBlock: 12,
              }}
            >
              <h3>{item.question}</h3>
              <p>30–60 second answer · exactly three talking points</p>
              <MarkdownContent>{item.answerMarkdown}</MarkdownContent>
              <label style={{ display: "block" }}>
                Answer for {item.question}
                <textarea
                  value={item.answerMarkdown}
                  onChange={(event) =>
                    editQuestion(item.id, {
                      answerMarkdown: event.target.value,
                    })
                  }
                  rows={5}
                  style={{ width: "100%" }}
                />
              </label>
              {item.talkingPoints.map((point, index) => (
                <label key={index} style={{ display: "block" }}>
                  Talking point {index + 1} for {item.question}
                  <input
                    value={point}
                    onChange={(event) => {
                      const points = [...item.talkingPoints] as [
                        string,
                        string,
                        string,
                      ];
                      points[index] = event.target.value;
                      editQuestion(item.id, { talkingPoints: points });
                    }}
                  />
                </label>
              ))}
              <details>
                <summary>Sources and gaps</summary>
                <p>
                  Source-linked evidence. Employer context is supplied and
                  unverified.
                </p>
                <ul>
                  {item.evidenceRefs.map((ref) => (
                    <li key={`${ref.id}:${ref.pointer}`}>
                      {ref.quote} ({ref.sourceKind} · revision {ref.revision} ·{" "}
                      {ref.pointer})
                    </li>
                  ))}
                </ul>
                <ul>
                  {item.gaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              </details>
              <label>
                Refinement instruction for {item.question}
                <input
                  value={refinement[item.id] ?? ""}
                  onChange={(event) =>
                    setRefinement((value) => ({
                      ...value,
                      [item.id]: event.target.value,
                    }))
                  }
                />
              </label>
              <Button
                type="button"
                onClick={() => void generate(item.id)}
                disabled={
                  busy || !context() || questionsChanged() || contextChanged()
                }
              >
                Regenerate this card
              </Button>
            </article>
          ))}
          <Button
            type="button"
            onClick={() => void save()}
            disabled={
              busy ||
              questionsChanged() ||
              contextChanged() ||
              !draft.questions.length
            }
          >
            Save complete pack
          </Button>
        </section>
      )}
      {!!artifacts.length && (
        <section aria-label="Available packs">
          <h2>Available packs</h2>
          <ul>
            {artifacts.map((item) => (
              <li key={item.id}>
                {item.title} · draft revision {item.revision}
                {item.savedRevision
                  ? ` · saved revision ${item.savedRevision}`
                  : " · unsaved"}
                {item.id !== activeArtifactId && (
                  <Button
                    type="button"
                    onClick={() => setActiveArtifactId(item.id)}
                    disabled={
                      busy || (!!draft && (dirty || needsSave || !!proposal))
                    }
                  >
                    {dirty && !draft
                      ? "Discard current setup and open"
                      : "Open"}{" "}
                    {item.title}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
