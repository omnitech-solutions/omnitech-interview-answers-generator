import {
  type RehearsalReveal,
  rehearsalScore,
} from "@omnitech/interview-contracts";
import { useEffect, useRef, useState } from "react";
import { CHECKS, formatById, LOCKED_UNTIL_COMPLEXITY, phaseAt } from "./config";
import type {
  RehearsalSettings,
  SessionMaterial,
  SessionState,
} from "./rehearsal-view";

export function initialSession(): SessionState {
  return {
    startedAt: new Date().toISOString(),
    elapsed: 0,
    paused: false,
    checks: [],
    reveals: [],
    notes: "",
    code: "",
    complexity: "",
  };
}
export function useRehearsalRun({
  settings,
  material,
  initial = initialSession,
  onFinish,
  onChange,
}: {
  settings: RehearsalSettings;
  material: SessionMaterial;
  initial?: SessionState | (() => SessionState);
  onFinish(session: SessionState): void;
  onChange?(session: SessionState): void;
}) {
  const [session, setSession] = useState(initial);
  useEffect(() => {
    onChange?.(session);
  }, [session, onChange]);
  const [finished, setFinished] = useState(false);
  const ended = useRef(false);
  const finishCallback = useRef(onFinish);
  finishCallback.current = onFinish;
  const at = phaseAt(formatById(settings.format), session.elapsed);
  useEffect(() => {
    if (finished || session.paused) return;
    const timer = setInterval(
      () =>
        setSession((current) => ({
          ...current,
          elapsed: Math.min(at.totalSeconds, current.elapsed + 1),
        })),
      1000,
    );
    return () => clearInterval(timer);
  }, [finished, session.paused, at.totalSeconds]);
  const finish = () => {
    if (ended.current) return;
    ended.current = true;
    setFinished(true);
    finishCallback.current(session);
  };
  useEffect(() => {
    if (session.elapsed >= at.totalSeconds && !ended.current) finish();
  }, [session.elapsed, at.totalSeconds]);
  const patch = (
    value: Partial<Pick<SessionState, "code" | "notes" | "complexity">>,
  ) => {
    if (!ended.current) setSession((current) => ({ ...current, ...value }));
  };
  const reveal = (id: RehearsalReveal) => {
    if (ended.current || !material.coding?.reveals[id]) return;
    setSession((current) => {
      if (
        current.reveals.includes(id) ||
        (LOCKED_UNTIL_COMPLEXITY.includes(id) && !current.complexity.trim())
      )
        return current;
      return { ...current, reveals: [...current.reveals, id] };
    });
  };
  return {
    status: finished ? ("finished" as const) : ("running" as const),
    session,
    at,
    score: rehearsalScore(session.checks.length, session.reveals.length),
    context: {
      revealed: session.reveals,
      remaining: material.coding?.reveals ?? {},
      complexity: session.complexity,
    },
    actions: {
      patch,
      reveal,
      finish,
      togglePause: () => {
        if (!settings.strict && !ended.current)
          setSession((current) => ({ ...current, paused: !current.paused }));
      },
      startCoding: () => {
        if (
          at.phase === "concept" &&
          formatById(settings.format).codingMinutes &&
          !ended.current
        )
          setSession((current) => ({ ...current, elapsed: at.conceptSeconds }));
      },
      toggleCheck: (index: number) => {
        if (
          !ended.current &&
          Number.isInteger(index) &&
          index >= 0 &&
          index < CHECKS.length
        )
          setSession((current) => ({
            ...current,
            checks: current.checks.includes(index)
              ? current.checks.filter((check) => check !== index)
              : [...current.checks, index],
          }));
      },
    },
  };
}
