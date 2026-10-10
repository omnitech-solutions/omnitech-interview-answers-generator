import {
  createRehearsalClient,
  type RehearsalClient,
} from "@omnitech/interview-api-client";
import type {
  RehearsalSession,
  RehearsalSessionInput,
} from "@omnitech/interview-contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "../context";
import {
  currentRehearsalLink,
  markRehearsalRunSaved,
  type RehearsalRunLink,
} from "../live/rehearsal-run-link";
import type { RehearsalCommand } from "../playground-control";
import { studioFetch } from "../studio-fetch";
import type { StudioLists } from "../use-studio-lists";
import { formatById } from "./config";
import {
  choiceKey,
  codingChoices,
  conceptChoices,
  loadCoding,
  loadConcept,
} from "./material";
import type { SessionMaterial, SessionState } from "./rehearsal-view";
import {
  type RehearsalSetup,
  rehearsalOptionSets,
  rehearsalSetupForm,
} from "./setup-config";
import { initialSession } from "./use-rehearsal-run";

const handledCommands = new Set<string>();
export function useRehearsal({
  lists,
  workspaceId,
  command = null,
  client: supplied,
}: {
  lists: StudioLists;
  workspaceId: string;
  command?: RehearsalCommand | null;
  client?: RehearsalClient;
}) {
  const studio = useStudio();
  const client = useMemo(
    () =>
      supplied ?? createRehearsalClient({ baseUrl: "", fetch: studioFetch }),
    [supplied],
  );
  const [setup, setSetup] = useState<RehearsalSetup>(
    rehearsalSetupForm.defaults,
  );
  const [stage, setStage] = useState<"setup" | "live" | "score">("setup");
  const [material, setMaterial] = useState<SessionMaterial>({
    concept: null,
    coding: null,
  });
  const [session, setSession] = useState<SessionState | null>(null);
  const [history, setHistory] = useState<RehearsalSession[]>([]);
  const [runLink, setRunLink] = useState<RehearsalRunLink>({ kind: "none" });
  const [saved, setSaved] = useState<RehearsalSession | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [startRequest, setStartRequest] = useState<string | null>(null);
  const generation = useRef(0);
  const startBusy = useRef(false);
  const saveBusy = useRef(false);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const records = await client.list();
      if (mounted.current) setHistory(records);
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "History couldn’t be loaded.",
        );
    }
  }, [client]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [refresh]);
  const format = formatById(setup.format);
  const concepts = conceptChoices(lists);
  const codings = codingChoices(lists);
  const concept = format.conceptMinutes
    ? (concepts.find((choice) => choiceKey(choice) === setup.conceptKey) ??
      concepts[0])
    : undefined;
  const coding = format.codingMinutes
    ? (codings.find((choice) => choiceKey(choice) === setup.codingKey) ??
      codings[0])
    : undefined;
  const missingCoding = format.codingMinutes > 0 && !coding;
  async function start() {
    if (startBusy.current || missingCoding || lists.status !== "ready") return;
    const request = ++generation.current;
    startBusy.current = true;
    setStarting(true);
    setError("");
    try {
      const [conceptMaterial, codingMaterial] = await Promise.all([
        concept ? loadConcept(concept) : null,
        coding ? loadCoding(coding, workspaceId) : null,
      ]);
      if (!mounted.current || generation.current !== request) return;
      setMaterial({ concept: conceptMaterial, coding: codingMaterial });
      setSession(initialSession());
      setSaved(null);
      setStage("live");
      setStartRequest(null);
    } catch {
      if (mounted.current && generation.current === request)
        setError("The questions couldn’t be loaded. Try again.");
    } finally {
      if (generation.current === request) {
        startBusy.current = false;
        if (mounted.current) setStarting(false);
      }
    }
  }
  function reset() {
    generation.current++;
    startBusy.current = false;
    setStarting(false);
    setStartRequest(null);
    setStage("setup");
    setSession(null);
    setSaved(null);
    setError("");
    setRunLink({ kind: "none" });
  }
  useEffect(() => {
    if (!command || handledCommands.has(command.id)) return;
    handledCommands.add(command.id);
    if (command.action === "start") {
      reset();
      setSetup((current) => ({ ...current, strict: command.strict }));
      setStartRequest(command.id);
    } else if (command.action === "end") {
      generation.current++;
      startBusy.current = false;
      setStarting(false);
      setStartRequest(null);
      setStage((current) => (current === "live" ? "score" : current));
    } else reset();
  }, [command]);
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (
      !startRequest ||
      startedFor.current === startRequest ||
      lists.status !== "ready" ||
      missingCoding
    )
      return;
    startedFor.current = startRequest;
    void start();
  });
  const setFocus = studio?.setFocus;
  useEffect(() => {
    if (stage !== "live" || !setFocus) return;
    setFocus(setup.strict ? "strict" : "live");
    return () => setFocus(null);
  }, [stage, setup.strict, setFocus]);
  async function saveScorecard(finished = session) {
    if (!finished || saveBusy.current || saved) return;
    saveBusy.current = true;
    setSaving(true);
    setError("");
    const request = generation.current;
    const linked = currentRehearsalLink(setup.strict);
    setRunLink(linked);
    const input: RehearsalSessionInput = {
      format: setup.format,
      strict: setup.strict,
      followUps: setup.followUps,
      concept: material.concept?.choice ?? null,
      coding: material.coding?.choice ?? null,
      checks: [...finished.checks],
      reveals: [...finished.reveals],
      activeSeconds: finished.elapsed,
      startedAt: finished.startedAt,
      endedAt: new Date().toISOString(),
      ...(linked.kind === "linked" ? { rehearsalRunId: linked.runId } : {}),
    };
    try {
      const record = await client.save(input);
      if (linked.kind === "linked") markRehearsalRunSaved(linked.runId);
      if (mounted.current && request === generation.current) {
        setSaved(record);
        setHistory((current) => [
          record,
          ...current.filter((item) => item.id !== record.id),
        ]);
      }
    } catch (failure) {
      if (mounted.current && request === generation.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "This session couldn’t be saved.",
        );
    } finally {
      saveBusy.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  useEffect(() => {
    if (stage === "score" && session && !saved) void saveScorecard();
  }, [stage, session, saved]);
  return {
    status: starting
      ? ("loading" as const)
      : error
        ? ("error" as const)
        : ("ready" as const),
    error,
    stage,
    data: { material, session, history, saved, runLink },
    form: {
      values: setup,
      setValues: setSetup,
      optionSets: rehearsalOptionSets(lists),
    },
    context: {
      missingCoding,
      starting,
      saving,
      ready: lists.status === "ready",
    },
    actions: {
      start,
      reset,
      refresh,
      saveScorecard,
      updateSession: setSession,
      finish: (finished: SessionState) => {
        setSession(finished);
        setStage("score");
      },
      openScorecard: (record: RehearsalSession) => {
        reset();
        setSetup({
          ...rehearsalSetupForm.defaults,
          format: record.format,
          strict: record.strict,
          followUps: record.followUps,
        });
        setSession({
          ...initialSession(),
          startedAt: record.startedAt,
          elapsed: record.activeSeconds,
          checks: record.checks,
          reveals: record.reveals,
        });
        setMaterial({
          concept: record.concept
            ? { choice: record.concept, followUps: [] }
            : null,
          coding: record.coding
            ? {
                choice: record.coding,
                statement: "",
                example: null,
                reveals: {},
              }
            : null,
        });
        setSaved(record);
        setStage("score");
      },
    },
  };
}
