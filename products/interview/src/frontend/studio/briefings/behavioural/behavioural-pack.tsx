import type {
  BriefingArtifact,
  BriefingClient,
  BriefingProfileSummary,
} from "@omnitech/interview-api-client";
import type {
  BriefingDraft,
  CandidateMatrix,
} from "@omnitech/interview-contracts";
import type { HostHooks } from "@omnitech-assistant/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { packAssistant } from "../../../assistant-config";
import { useStudio } from "../../context";
import { Icon } from "../../icon";
import { AnswersTab, type PendingAnswer } from "./answers-tab";
import { PACK_TABS, type PackTab, STAGES, suggestedFor } from "./config";
import { defaultProfile } from "./matrix-picker";
import { QuestionsCard } from "./questions-card";
import { BriefingTab } from "./briefing-tabs";
import {
  contextOf,
  emptySetup,
  type PackSetup,
  SetupCard,
  setupOf,
} from "./setup-card";

// The server refused a write made from an older revision of the pack.
const isRevisionConflict = (failure: unknown) =>
  (failure as { details?: { error?: { code?: unknown } } } | null)?.details
    ?.error?.code === "revision-conflict";
const failureOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

// A behavioural preparation pack: set up the interview, list the questions
// you expect, then review drafted answers and the prepared briefing.
// Without an artifact id it is a new pack, created when answers are drafted.
export function BehaviouralPack({
  client,
  artifactId,
  autoDraft = false,
  savedRevision,
  onCreated,
  onDraftStarted,
  onChanged,
  onDirtyChange,
}: {
  client: BriefingClient;
  artifactId: string | null;
  // Set when the pack was just created: drafting starts on arrival.
  autoDraft?: boolean;
  savedRevision?: number | undefined;
  onCreated(id: string): void;
  onDraftStarted?(): void;
  onChanged(): void;
  onDirtyChange(dirty: boolean): void;
}) {
  const [profiles, setProfiles] = useState<readonly BriefingProfileSummary[]>(
    [],
  );
  const [matrix, setMatrix] = useState<CandidateMatrix | null>(null);
  const [briefing, setBriefing] = useState<BriefingDraft | null>(null);
  const [setup, setSetup] = useState<PackSetup>(() => emptySetup(null));
  const [expected, setExpected] = useState<string[]>(() =>
    suggestedFor("recruiter", ""),
  );
  const [loading, setLoading] = useState(artifactId !== null);
  const [view, setView] = useState<"setup" | "results">("setup");
  const [editingSetup, setEditingSetup] = useState(false);
  const [tab, setTab] = useState<PackTab>("answers");
  const [pending, setPending] = useState<PendingAnswer[]>([]);
  const [redrafting, setRedrafting] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(savedRevision ?? 0);
  const [askNext, setAskNext] = useState("");
  const [focus, setFocus] = useState<string | null>(null);

  // [SAFETY] Every write goes through one queue and starts from the newest
  // revision, so drafting, accepting and setup edits never conflict.
  const revision = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const briefingRef = useRef<BriefingDraft | null>(null);
  const [packRevision, setPackRevision] = useState(0);
  const applied = useCallback((artifact: BriefingArtifact) => {
    revision.current = artifact.origin.artifactRevision;
    briefingRef.current = artifact.value.briefing;
    setBriefing(artifact.value.briefing);
    setPackRevision(artifact.origin.artifactRevision);
    return artifact;
  }, []);
  const write = useCallback(
    <T,>(step: () => Promise<T>): Promise<T> => {
      // [GUARD] Another tab, or an assistant change you applied, moved the
      // pack on: load the newest revision and make the change once more on
      // top of it, instead of failing every write until a reload.
      const attempt = () =>
        step().catch(async (failure: unknown) => {
          if (!isRevisionConflict(failure) || artifactId === null)
            throw failure;
          applied(await client.getArtifact(artifactId));
          return step();
        });
      const next = queue.current.then(attempt, attempt);
      queue.current = next.catch(() => undefined);
      return next;
    },
    [applied, artifactId, client],
  );

  // Load the matrices, then the pack (or the default matrix for a new one).
  useEffect(() => {
    let active = true;
    void client.listProfiles().then(
      ({ profiles: loaded }) => {
        if (!active) return;
        setProfiles(loaded);
        if (artifactId === null)
          setSetup((current) =>
            current.profile
              ? current
              : { ...current, profile: defaultProfile(loaded) },
          );
      },
      () => active && setError("Your experience matrices couldn’t be loaded."),
    );
    if (artifactId !== null)
      client.getArtifact(artifactId).then(
        (artifact) => {
          if (!active) return;
          applied(artifact);
          const loaded = artifact.value.briefing;
          setSetup(setupOf(loaded.context));
          setExpected(
            loaded.expected ?? loaded.questions.map((item) => item.question),
          );
          setView(loaded.questions.length || autoDraft ? "results" : "setup");
          setLoading(false);
        },
        () => {
          if (!active) return;
          setError("This pack couldn’t be loaded.");
          setLoading(false);
        },
      );
    return () => {
      active = false;
    };
  }, [client, artifactId, applied, autoDraft]);

  // The chosen matrix, for role chips and evidence labels.
  const profileKey = setup.profile
    ? `${setup.profile.id}:${setup.profile.revision}`
    : "";
  useEffect(() => {
    if (!setup.profile) return setMatrix(null);
    let active = true;
    client.getProfile(setup.profile.id, setup.profile.revision).then(
      (profile) => active && setMatrix(profile.matrix),
      () => active && setMatrix(null),
    );
    return () => {
      active = false;
    };
  }, [client, profileKey]);

  // [STRATEGY] Setup and question edits on a saved pack are written after a
  // short pause, through the queue, so a reload never loses them.
  const context = contextOf(setup, briefing?.context);
  const persisted =
    briefing &&
    JSON.stringify(briefing.context) === JSON.stringify(context) &&
    JSON.stringify(briefing.expected ?? []) === JSON.stringify(expected);
  const dirty = artifactId !== null && briefing !== null && !persisted;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty || !context || artifactId === null) return;
    const timer = setTimeout(() => {
      void persist(context, expected).catch((failure) =>
        setError(failureOf(failure, "Your changes couldn’t be saved.")),
      );
    }, 800);
    return () => clearTimeout(timer);
  }, [dirty, JSON.stringify(context), JSON.stringify(expected), artifactId]);

  function persist(
    nextContext: NonNullable<typeof context>,
    nextExpected: readonly string[],
    keep?: (question: BriefingDraft["questions"][number]) => boolean,
  ) {
    return write(async () => {
      const current = briefingRef.current!;
      return applied(
        await client.editArtifact(artifactId!, {
          expectedRevision: revision.current,
          briefing: {
            ...current,
            title: `${nextContext.company} · ${nextContext.role}`,
            context: nextContext,
            expected: [...nextExpected],
            questions: keep
              ? current.questions.filter(keep)
              : current.questions,
          },
        }),
      );
    });
  }

  // [STRATEGY] Answers are drafted one question at a time, so each appears
  // as soon as it is ready; a failure is shown on its row and the rest go on.
  async function draftAnswers(questions: readonly string[]) {
    const answered = new Set(
      (briefingRef.current?.questions ?? []).map((item) => item.question),
    );
    const todo = [...new Set(questions)].filter(
      (question) => !answered.has(question),
    );
    const mark = (question: string, patch: Partial<PendingAnswer> | null) =>
      setPending((items) =>
        patch
          ? items.map((item) =>
              item.question === question ? { ...item, ...patch } : item,
            )
          : items.filter((item) => item.question !== question),
      );
    setPending(todo.map((question) => ({ question, state: "queued" })));
    for (const question of todo) {
      mark(question, { state: "drafting" });
      try {
        await write(async () =>
          applied(
            await client.ask(artifactId!, {
              expectedRevision: revision.current,
              question,
            }),
          ),
        );
        mark(question, null);
      } catch (failure) {
        mark(question, {
          state: "failed",
          error: failureOf(failure, "This answer couldn’t be drafted."),
        });
      }
    }
    onChanged();
    if (!briefingRef.current?.prepared) await prepare();
  }

  async function prepare() {
    setPreparing(true);
    setPrepareError("");
    try {
      await write(async () =>
        applied(
          await client.prepare(artifactId!, {
            expectedRevision: revision.current,
          }),
        ),
      );
    } catch (failure) {
      setPrepareError(failureOf(failure, "The briefing couldn’t be prepared."));
    } finally {
      setPreparing(false);
    }
  }

  // A new pack starts drafting as soon as it opens.
  // [DOMAIN] The assistant reads this pack and proposes answer edits to it;
  // it sends from the newest revision once pending writes land, and the pack
  // reloads after an edit is applied or undone.
  const studio = useStudio();
  const assistantHooks = useRef<HostHooks>({});
  assistantHooks.current = {
    prepareSend: async () => {
      await queue.current;
      return {
        workspaceId: "briefings",
        artifactId: artifactId!,
        artifactRevision: revision.current,
      };
    },
    onApplied: async () => {
      applied(await client.getArtifact(artifactId!));
    },
    onReverted: async () => {
      applied(await client.getArtifact(artifactId!));
    },
  };
  const hasPack = briefing !== null;
  useEffect(() => {
    if (!studio || artifactId === null || !hasPack) return;
    return studio.bindView({
      origin: {
        workspaceId: "briefings",
        artifactId,
        artifactRevision: packRevision,
      },
      assistant: packAssistant,
      hooks: assistantHooks,
    });
  }, [studio, artifactId, hasPack, packRevision]);

  const started = useRef(false);
  useEffect(() => {
    if (!autoDraft || !briefing || started.current || artifactId === null)
      return;
    started.current = true;
    onDraftStarted?.();
    void draftAnswers(briefing.expected ?? []);
  }, [autoDraft, briefing, artifactId]);

  async function start() {
    setError("");
    if (!context)
      return setError("Choose a matrix and add the company and role first.");
    if (!expected.some((question) => question.trim()))
      return setError("Add at least one question.");
    const questions = expected
      .map((question) => question.trim())
      .filter(Boolean);
    // [GUARD] A new pack is created only once there is something to draft.
    if (artifactId === null) {
      const id = `prep-${Date.now().toString(36)}`;
      try {
        await client.editArtifact(id, {
          expectedRevision: 0,
          briefing: {
            kind: "non-technical-briefing",
            title: `${context.company} · ${context.role}`,
            context,
            expected: questions,
            questions: [],
          },
        });
        onCreated(id);
      } catch (failure) {
        setError(failureOf(failure, "The pack couldn’t be created."));
      }
      return;
    }
    setView("results");
    setEditingSetup(false);
    setTab("answers");
    try {
      // Answers to questions the person removed go with them.
      await persist(context, questions, (item) =>
        questions.includes(item.question),
      );
      await draftAnswers(questions);
    } catch (failure) {
      setError(failureOf(failure, "Your changes couldn’t be saved."));
    }
  }

  function updateAnswers(
    change: (
      question: BriefingDraft["questions"][number],
    ) => BriefingDraft["questions"][number],
  ) {
    return write(async () => {
      const current = briefingRef.current!;
      return applied(
        await client.editArtifact(artifactId!, {
          expectedRevision: revision.current,
          briefing: { ...current, questions: current.questions.map(change) },
        }),
      );
    }).catch((failure) =>
      setError(failureOf(failure, "That change couldn’t be saved.")),
    );
  }

  function updatePrepared(prepared: NonNullable<BriefingDraft["prepared"]>) {
    return write(async () =>
      applied(
        await client.editArtifact(artifactId!, {
          expectedRevision: revision.current,
          briefing: { ...briefingRef.current!, prepared },
        }),
      ),
    ).catch((failure) =>
      setError(failureOf(failure, "That change couldn’t be saved.")),
    );
  }

  async function redraft(id: string) {
    const answer = briefingRef.current?.questions.find(
      (item) => item.id === id,
    );
    if (!answer) return;
    setRedrafting(id);
    try {
      await write(async () =>
        applied(
          await client.ask(artifactId!, {
            expectedRevision: revision.current,
            question: answer.question,
            category: answer.category,
            replaceId: id,
          }),
        ),
      );
    } catch (failure) {
      setError(failureOf(failure, "A new draft couldn’t be written."));
    } finally {
      setRedrafting(null);
    }
  }

  async function askNow() {
    const question = askNext.trim();
    if (!question || !context) return;
    setAskNext("");
    const next = [...expected, question];
    setExpected(next);
    await persist(context, next);
    await draftAnswers([question]);
    const added = briefingRef.current?.questions.find(
      (item) => item.question === question,
    );
    if (added) setFocus(added.id);
  }

  async function save() {
    try {
      const result = await write(() =>
        client.save(artifactId!, {
          expectedRevision: revision.current,
          requestId: crypto.randomUUID(),
        }),
      );
      setSaved(result.draftRevision);
      onChanged();
    } catch (failure) {
      setError(failureOf(failure, "The pack couldn’t be saved."));
    }
  }

  if (loading)
    return (
      <p className="ws-loading" role="status">
        Loading pack…
      </p>
    );

  const stage = STAGES.find((item) => item.id === setup.stage)!;
  const matrixName =
    profiles.find((profile) => profile.id === setup.profile?.id)?.name ??
    "your matrix";
  const drafting = pending.some((item) => item.state !== "failed");
  const answers = briefing?.questions ?? [];
  const accepted = answers.filter((answer) => answer.accepted).length;
  const isSaved = briefing !== null && saved >= revision.current && !dirty;
  const showSetup = view === "setup" || editingSetup;

  return (
    <div className="bp">
      {artifactId !== null && view === "results" && !editingSetup && (
        <div className="bp-summary">
          <span className="bp-tile small">
            <Icon name="badge" />
          </span>
          <div className="bp-grow">
            <div className="bp-summary-title">
              {setup.company} · {setup.role} · {stage.label}
            </div>
            <div className="bp-meta">
              {matrixName} ·{" "}
              {setup.roleIds.length
                ? `${setup.roleIds.length} role${setup.roleIds.length === 1 ? "" : "s"} emphasised`
                : "every role considered"}
            </div>
          </div>
          <button
            type="button"
            className="studio-button"
            onClick={() => setEditingSetup(true)}
          >
            <Icon name="tune" size={16} />
            Edit setup
          </button>
        </div>
      )}
      {showSetup && (
        <SetupCard
          client={client}
          profiles={profiles}
          matrix={matrix}
          setup={setup}
          onChange={(next) => {
            // A new pack's suggested questions follow its stage and company.
            if (
              artifactId === null &&
              (next.stage !== setup.stage || next.company !== setup.company) &&
              expected.join("\n") ===
                suggestedFor(setup.stage, setup.company).join("\n")
            )
              setExpected(suggestedFor(next.stage, next.company));
            setSetup(next);
          }}
          onImported={() =>
            void client
              .listProfiles()
              .then(({ profiles: loaded }) => setProfiles(loaded))
          }
        />
      )}
      {editingSetup && view === "results" && (
        <button
          type="button"
          className="bp-back"
          onClick={() => setEditingSetup(false)}
        >
          <Icon name="expand_less" size={16} />
          Done
        </button>
      )}
      {view === "setup" && (
        <QuestionsCard
          questions={expected}
          stageLabel={stage.label}
          note={`${expected.length} answer${expected.length === 1 ? "" : "s"} from ${matrixName}, each linked to the roles it uses.`}
          canDraft={Boolean(context) && expected.length > 0 && !drafting}
          onChange={setExpected}
          onReset={() => setExpected(suggestedFor(setup.stage, setup.company))}
          onDraft={() => void start()}
        />
      )}
      {view === "results" && (
        <>
          <div className="bp-tabs">
            <div className="bp-tab-list" role="tablist">
              {PACK_TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  onClick={() => setTab(item.id)}
                >
                  <Icon name={item.icon} size={17} />
                  {item.label}
                  {item.id === "answers" && (
                    <span className="bp-mono">
                      {drafting ? "drafting…" : `${accepted}/${answers.length}`}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="studio-button primary"
              disabled={isSaved || drafting}
              onClick={() => void save()}
            >
              <Icon name={isSaved ? "cloud_done" : "check"} size={16} />
              {isSaved ? "Saved" : "Save pack"}
            </button>
          </div>
          {tab === "answers" ? (
            <>
              <AnswersTab
                answers={answers}
                pending={pending}
                matrix={matrix}
                redrafting={redrafting}
                focus={focus}
                onAccept={(id, value) =>
                  void updateAnswers((item) =>
                    item.id === id ? { ...item, accepted: value } : item,
                  )
                }
                onAcceptAll={() =>
                  void updateAnswers((item) => ({ ...item, accepted: true }))
                }
                onRedraft={(id) => void redraft(id)}
                onEdit={(id, markdown) =>
                  void updateAnswers((item) =>
                    item.id === id
                      ? { ...item, answerMarkdown: markdown, accepted: false }
                      : item,
                  )
                }
                onChangeQuestions={() => setView("setup")}
              />
              <form
                className="bp-card bp-ask"
                onSubmit={(event) => {
                  event.preventDefault();
                  void askNow();
                }}
              >
                <Icon name="forum" />
                <input
                  aria-label="Ask another question"
                  value={askNext}
                  disabled={drafting || answers.length >= 20}
                  placeholder={
                    answers.length >= 20
                      ? "A pack holds 20 answers"
                      : "Asked something else? Type it to get an answer"
                  }
                  onChange={(event) => setAskNext(event.target.value)}
                />
                <button
                  type="submit"
                  className="studio-icon-button"
                  aria-label="Answer it"
                  disabled={!askNext.trim() || drafting}
                >
                  <Icon name="arrow_upward" />
                </button>
              </form>
            </>
          ) : (
            <BriefingTab
              tab={tab}
              prepared={briefing?.prepared}
              context={briefing?.context}
              matrix={matrix}
              preparing={preparing}
              error={prepareError}
              onPrepare={() => void prepare()}
              onChange={(prepared) => void updatePrepared(prepared)}
              onSeeAnswer={(pattern) => {
                const match = answers.find((item) =>
                  pattern.test(item.question),
                );
                setTab("answers");
                if (match) setFocus(match.id);
              }}
            />
          )}
        </>
      )}
      {error && (
        <p className="bp-error" role="alert">
          <Icon name="error" />
          {error}
        </p>
      )}
    </div>
  );
}
