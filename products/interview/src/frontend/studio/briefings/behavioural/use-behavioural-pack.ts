import {
  type BriefingArtifact,
  type BriefingProfileSummary,
  createBriefingClient,
} from "@omnitech/interview-api-client";
import type {
  BriefingDraft,
  CandidateMatrix,
} from "@omnitech/interview-contracts";
import type { HostHooks } from "@omnitech-assistant/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { packAssistant } from "../../../assistant-config";
import { useStudio } from "../../context";
import { studioFetch, studioFetchUntil } from "../../studio-fetch";
import type { PendingAnswer } from "./answers-tab";
import { type PackTab, STAGES, suggestedFor } from "./config";
import { defaultProfile } from "./matrix-picker";
import { contextOf, emptySetup, type PackSetup, setupOf } from "./setup-card";

// The same JSON whatever order its keys arrive in: the server returns packs
// as Postgres stores them (jsonb reorders object keys), not as they were sent.
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [
              key,
              canonical((value as Record<string, unknown>)[key]),
            ]),
        )
      : value;
const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// The server refused a write made from an older revision of the pack.
const isRevisionConflict = (failure: unknown) =>
  (failure as { details?: { error?: { code?: unknown } } } | null)?.details
    ?.error?.code === "revision-conflict";
const failureOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

// A behavioural preparation pack: set up the interview, list the questions
// you expect, then review drafted answers and the prepared briefing.
// Without an artifact id it is a new pack, created when answers are drafted.
export function useBehaviouralPack({
  artifactId,
  autoDraft = false,
  savedRevision,
  onCreated,
  onDraftStarted,
  onChanged,
  onDirtyChange,
}: {
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
  const client = useMemo(
    () => createBriefingClient({ baseUrl: "", fetch: studioFetch }),
    [],
  );

  // [SAFETY] Every write goes through one queue and starts from the newest
  // revision, so drafting, accepting and setup edits never conflict.
  const activeArtifact = useRef(artifactId);
  activeArtifact.current = artifactId;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const startBusy = useRef(false);
  const saveBusy = useRef(false);
  const revision = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const briefingRef = useRef<BriefingDraft | null>(null);
  const [packRevision, setPackRevision] = useState(0);
  const applied = useCallback((artifact: BriefingArtifact) => {
    if (
      !mounted.current ||
      artifact.origin.artifactId !== activeArtifact.current
    )
      return artifact;
    revision.current = artifact.origin.artifactRevision;
    briefingRef.current = artifact.value.briefing;
    setBriefing(artifact.value.briefing);
    setPackRevision(artifact.origin.artifactRevision);
    return artifact;
  }, []);
  const write = useCallback(
    <T>(step: () => Promise<T>): Promise<T> => {
      // [GUARD] Another tab, or an assistant change you applied, moved the
      // pack on: load the newest revision and make the change once more on
      // top of it, instead of failing every write until a reload.
      const attempt = () => {
        if (!mounted.current || artifactId !== activeArtifact.current)
          return Promise.reject(new Error("This pack is no longer open."));
        return step().catch(async (failure: unknown) => {
          if (!isRevisionConflict(failure) || artifactId === null)
            throw failure;
          applied(await client.getArtifact(artifactId));
          if (!mounted.current || artifactId !== activeArtifact.current)
            throw new Error("This pack is no longer open.");
          return step();
        });
      };
      const next = queue.current.then(attempt, attempt);
      queue.current = next.catch(() => undefined);
      return next;
    },
    [applied, artifactId, client],
  );

  // Load the matrices, then the pack (or the default matrix for a new one).
  // [SAFETY] Both loads end with the view (or a re-run), so no superseded
  // request stays live or applies.
  useEffect(() => {
    setLoading(artifactId !== null);
    setError("");
    setBriefing(null);
    briefingRef.current = null;
    revision.current = 0;
    setPackRevision(0);
    setSetup(emptySetup(null));
    setExpected(suggestedFor("recruiter", ""));
    setPending([]);
    setSaved(savedRevision ?? 0);
    started.current = false;
    const controller = new AbortController();
    const loader = createBriefingClient({
      baseUrl: "",
      fetch: studioFetchUntil(controller.signal),
    });
    const active = () => !controller.signal.aborted;
    void loader.listProfiles().then(
      ({ profiles: loaded }) => {
        if (!active()) return;
        setProfiles(loaded);
        if (artifactId === null)
          setSetup((current) =>
            current.profile
              ? current
              : { ...current, profile: defaultProfile(loaded) },
          );
      },
      () =>
        active() && setError("Your experience matrices couldn’t be loaded."),
    );
    if (artifactId !== null)
      loader.getArtifact(artifactId).then(
        (artifact) => {
          if (!active()) return;
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
          if (!active()) return;
          setError("This pack couldn’t be loaded.");
          setLoading(false);
        },
      );
    return () => controller.abort();
  }, [artifactId, applied, autoDraft]);

  // The chosen matrix, for role chips and evidence labels.
  const profileKey = setup.profile
    ? `${setup.profile.id}:${setup.profile.revision}`
    : "";
  useEffect(() => {
    if (!setup.profile) return setMatrix(null);
    const controller = new AbortController();
    const active = () => !controller.signal.aborted;
    createBriefingClient({
      baseUrl: "",
      fetch: studioFetchUntil(controller.signal),
    })
      .getProfile(setup.profile.id, setup.profile.revision)
      .then(
        (profile) => active() && setMatrix(profile.matrix),
        () => active() && setMatrix(null),
      );
    return () => controller.abort();
  }, [profileKey]);

  // [STRATEGY] Setup and question edits on a saved pack are written after a
  // short pause, through the queue, so a reload never loses them.
  const context = contextOf(setup, briefing?.context);
  const persisted =
    briefing &&
    sameJson(briefing.context, context) &&
    sameJson(briefing.expected ?? [], expected);
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

  // Condense the long setup fields for the assistant. Edits still waiting to
  // be written go first, so the copy is made from what is on screen.
  const [condensing, setCondensing] = useState(false);
  async function condenseSetup() {
    if (artifactId === null || condensing) return;
    setCondensing(true);
    setError("");
    try {
      if (dirty && context) await persist(context, expected);
      await write(async () =>
        applied(
          await client.condense(artifactId, {
            expectedRevision: revision.current,
          }),
        ),
      );
      onChanged();
    } catch (failure) {
      setError(failureOf(failure, "The setup couldn’t be condensed."));
    } finally {
      setCondensing(false);
    }
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
    if (startBusy.current || pending.some((item) => item.state !== "failed"))
      return;
    setError("");
    if (!context)
      return setError("Choose a matrix and add the company and role first.");
    if (!expected.some((question) => question.trim()))
      return setError("Add at least one question.");
    startBusy.current = true;
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
      } finally {
        startBusy.current = false;
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
    } finally {
      startBusy.current = false;
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
    if (
      !question ||
      !context ||
      artifactId === null ||
      pending.some((item) => item.state !== "failed") ||
      (briefingRef.current?.questions.length ?? 0) >= 20
    )
      return;
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
    if (
      artifactId === null ||
      saveBusy.current ||
      pending.some((item) => item.state !== "failed")
    )
      return;
    saveBusy.current = true;
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
    } finally {
      saveBusy.current = false;
    }
  }

  const drafting = pending.some((item) => item.state !== "failed");
  const answers = briefing?.questions ?? [];
  const isSaved = briefing !== null && saved >= revision.current && !dirty;
  return {
    status: loading
      ? ("loading" as const)
      : error
        ? ("error" as const)
        : ("ready" as const),
    error,
    data: {
      profiles,
      matrix,
      briefing,
      pending,
      redrafting,
      preparing,
      prepareError,
      focus,
      packRevision,
    },
    form: {
      setup,
      expected,
      askNext,
      setAskNext,
      setExpected,
      optionSets: {
        stages: STAGES.map((stage) => ({
          value: stage.id,
          label: stage.label,
        })),
        profiles: profiles.map((profile) => ({
          value: profile.id,
          label: profile.name,
        })),
      },
    },
    context: {
      context,
      dirty,
      drafting,
      isSaved,
      condensing,
      artifactId,
      expected,
      askNext,
      answers: answers.length,
      accepted: answers.filter((answer) => answer.accepted).length,
    },
    view: { view, editingSetup, tab },
    actions: {
      start,
      save,
      prepare,
      condenseSetup,
      askNow,
      redraft,
      updatePrepared,
      setTab,
      setView,
      setEditingSetup,
      setFocus,
      changeSetup: (next: PackSetup) => {
        if (
          artifactId === null &&
          (next.stage !== setup.stage || next.company !== setup.company) &&
          expected.join("\n") ===
            suggestedFor(setup.stage, setup.company).join("\n")
        )
          setExpected(suggestedFor(next.stage, next.company));
        setSetup(next);
      },
      resetQuestions: () =>
        setExpected(suggestedFor(setup.stage, setup.company)),
      refreshProfiles: () =>
        client
          .listProfiles()
          .then(({ profiles: loaded }) => setProfiles(loaded)),
      importProfile: client.importProfile,
      accept: (id: string, accepted: boolean) =>
        updateAnswers((item) =>
          item.id === id ? { ...item, accepted } : item,
        ),
      acceptAll: () => updateAnswers((item) => ({ ...item, accepted: true })),
      editAnswer: (id: string, answerMarkdown: string) =>
        updateAnswers((item) =>
          item.id === id ? { ...item, answerMarkdown, accepted: false } : item,
        ),
      retryAnswer: (question: string) => draftAnswers([question]),
    },
  };
}
