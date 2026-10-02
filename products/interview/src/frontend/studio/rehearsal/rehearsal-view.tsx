import type {
  RehearsalFormat,
  RehearsalReveal,
} from "@omnitech/interview-contracts";
import { useEffect, useMemo, useState } from "react";
import type { StudioActions } from "../config/commands";
import { useStudio } from "../context";
import { Icon } from "../icon";
import type { StudioLists } from "../use-studio-lists";
import { FORMATS, formatById } from "./config";
import { LiveSession } from "./live-session";
import {
  type CodingMaterial,
  type ConceptMaterial,
  choiceKey,
  codingChoices,
  conceptChoices,
  loadCoding,
  loadConcept,
  type QuestionChoice,
} from "./material";
import { Scorecard } from "./scorecard";

export type RehearsalSettings = {
  format: RehearsalFormat;
  followUps: boolean;
  strict: boolean;
};
// What the person has done so far in a live session.
export type SessionState = {
  startedAt: string;
  elapsed: number;
  paused: boolean;
  checks: readonly number[];
  reveals: readonly RehearsalReveal[];
  notes: string;
  code: string;
  complexity: string;
};
export type SessionMaterial = {
  concept: ConceptMaterial | null;
  coding: CodingMaterial | null;
};

type Stage =
  | { kind: "setup" }
  | { kind: "live" | "score"; material: SessionMaterial };

// Rehearsal: choose a format and questions, run the timed session, then see
// the scorecard. The sidebar steps aside while a session is live.
export function RehearsalView({
  actions,
  lists,
  workspaceId,
}: {
  actions: StudioActions;
  lists: StudioLists;
  workspaceId: string;
}) {
  const studio = useStudio();
  const [settings, setSettings] = useState<RehearsalSettings>({
    format: "full",
    followUps: true,
    strict: false,
  });
  const [stage, setStage] = useState<Stage>({ kind: "setup" });
  const [session, setSession] = useState<SessionState | null>(null);

  // [SAFETY] Focus mode lasts only as long as the live session.
  const setFocus = studio?.setFocus;
  const live = stage.kind === "live";
  useEffect(() => {
    if (!live || !setFocus) return;
    setFocus(settings.strict ? "strict" : "live");
    return () => setFocus(null);
  }, [live, settings.strict, setFocus]);

  if (stage.kind === "setup")
    return (
      <Setup
        settings={settings}
        onSettings={setSettings}
        lists={lists}
        workspaceId={workspaceId}
        onStart={(material) => {
          setSession({
            startedAt: new Date().toISOString(),
            elapsed: 0,
            paused: false,
            checks: [],
            reveals: [],
            notes: "",
            code: "",
            complexity: "",
          });
          setStage({ kind: "live", material });
        }}
      />
    );
  if (stage.kind === "live")
    return (
      <LiveSession
        settings={settings}
        material={stage.material}
        session={session!}
        onChange={setSession}
        onEnd={() => setStage({ kind: "score", material: stage.material })}
      />
    );
  return (
    <Scorecard
      settings={settings}
      material={stage.material}
      session={session!}
      actions={actions}
      onAgain={() => setStage({ kind: "setup" })}
    />
  );
}

function Setup({
  settings,
  onSettings,
  lists,
  workspaceId,
  onStart,
}: {
  settings: RehearsalSettings;
  onSettings(next: RehearsalSettings): void;
  lists: StudioLists;
  workspaceId: string;
  onStart(material: SessionMaterial): void;
}) {
  const format = formatById(settings.format);
  const concepts = useMemo(() => conceptChoices(lists), [lists]);
  const codings = useMemo(() => codingChoices(lists), [lists]);
  const [conceptKey, setConceptKey] = useState("");
  const [codingKey, setCodingKey] = useState("");
  const [changing, setChanging] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  // [GUARD] Each phase asks a question only when the format has that phase;
  // an unknown key falls back to the first choice.
  const concept = format.conceptMinutes
    ? (concepts.find((item) => choiceKey(item) === conceptKey) ?? concepts[0])
    : undefined;
  const coding = format.codingMinutes
    ? (codings.find((item) => choiceKey(item) === codingKey) ?? codings[0])
    : undefined;
  const missingCoding = format.codingMinutes > 0 && !coding;
  const summary = [concept?.title, coding?.title]
    .filter(Boolean)
    .join(", then ");

  async function start() {
    setStarting(true);
    setError("");
    try {
      const [conceptMaterial, codingMaterial] = await Promise.all([
        concept ? loadConcept(concept) : null,
        coding ? loadCoding(coding, workspaceId) : null,
      ]);
      onStart({ concept: conceptMaterial, coding: codingMaterial });
    } catch {
      setError("The questions couldn’t be loaded. Try again.");
      setStarting(false);
    }
  }

  return (
    <div className="rehearsal-setup">
      <div>
        <h1 className="rehearsal-title">Rehearsal</h1>
        <p className="rehearsal-muted">
          A realistic, timed interview. Hints are there if you need them, and
          each one you open costs points on the scorecard.
        </p>
      </div>
      <div className="rehearsal-formats" role="radiogroup" aria-label="Format">
        {FORMATS.map((item) => {
          const on = item.id === settings.format;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`rehearsal-format${on ? " on" : ""}`}
              onClick={() => onSettings({ ...settings, format: item.id })}
            >
              <span className="rehearsal-format-head">
                {item.title}
                {on && <Icon name="check_circle" />}
              </span>
              <span className="rehearsal-split" aria-hidden="true">
                <span
                  className="concept"
                  style={{ flex: item.conceptMinutes }}
                />
                <span className="coding" style={{ flex: item.codingMinutes }} />
              </span>
              <span className="rehearsal-muted">{item.description}</span>
            </button>
          );
        })}
      </div>
      <div className="rehearsal-options">
        <div className="rehearsal-option">
          <div>
            <div className="rehearsal-option-title">Questions</div>
            <div className="rehearsal-muted">
              {missingCoding
                ? "No coding questions yet. Add one in the Workspace first."
                : summary}
            </div>
          </div>
          <button
            type="button"
            className="studio-button"
            aria-expanded={changing}
            onClick={() => setChanging(!changing)}
          >
            {changing ? "Done" : "Change"}
          </button>
        </div>
        {changing && (
          <div className="rehearsal-pickers">
            {concept && (
              <label>
                Concept
                <select
                  value={choiceKey(concept)}
                  onChange={(event) => setConceptKey(event.target.value)}
                >
                  {concepts.map((item) => (
                    <option key={choiceKey(item)} value={choiceKey(item)}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {coding && (
              <label>
                Coding
                <select
                  value={choiceKey(coding)}
                  onChange={(event) => setCodingKey(event.target.value)}
                >
                  {codings.map((item) => (
                    <option key={choiceKey(item)} value={choiceKey(item)}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        <Toggle
          title="Interviewer follow-ups"
          description="Follow-up questions after each phase, the way a real interviewer would ask them"
          on={settings.followUps}
          onChange={(followUps) => onSettings({ ...settings, followUps })}
        />
        <Toggle
          title="Strict mode"
          description="No pausing, no assistant. Like the real thing."
          on={settings.strict}
          onChange={(strict) => onSettings({ ...settings, strict })}
        />
      </div>
      {error && (
        <p role="alert" className="rehearsal-error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="studio-button primary rehearsal-start"
        disabled={starting || missingCoding}
        onClick={() => void start()}
      >
        <Icon name="play_arrow" />
        {starting
          ? "Loading questions…"
          : `Start ${format.title.toLowerCase()}`}
      </button>
    </div>
  );
}

function Toggle({
  title,
  description,
  on,
  onChange,
}: {
  title: string;
  description: string;
  on: boolean;
  onChange(on: boolean): void;
}) {
  return (
    <div className="rehearsal-option">
      <div>
        <div className="rehearsal-option-title">{title}</div>
        <div className="rehearsal-muted">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        className={`rehearsal-switch${on ? " on" : ""}`}
        onClick={() => onChange(!on)}
      >
        <span />
      </button>
    </div>
  );
}
