import {
  REVEAL_COST,
  type RehearsalReveal,
} from "@omnitech/interview-contracts";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../icon";
import {
  CHECKS,
  CODING_FOLLOW_UPS,
  clock,
  formatById,
  LOCKED_UNTIL_COMPLEXITY,
  phaseAt,
  REVEALS,
} from "./config";
import type {
  RehearsalSettings,
  SessionMaterial,
  SessionState,
} from "./rehearsal-view";
import { Button } from "../../ui";

// A running session: the phase clock, the question, hints and the checklist.
export function LiveSession({
  settings,
  material,
  session,
  onChange,
  onEnd,
}: {
  settings: RehearsalSettings;
  material: SessionMaterial;
  session: SessionState;
  onChange(update: (current: SessionState | null) => SessionState | null): void;
  onEnd(): void;
}) {
  const format = formatById(settings.format);
  const at = phaseAt(format, session.elapsed);
  const update = (patch: Partial<SessionState>) =>
    onChange((current) => current && { ...current, ...patch });

  // [STRATEGY] One tick a second while running; the session ends itself when
  // the clock runs out.
  const ended = useRef(onEnd);
  ended.current = onEnd;
  const running = !session.paused;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () =>
        onChange(
          (current) =>
            current && {
              ...current,
              elapsed: Math.min(at.totalSeconds, current.elapsed + 1),
            },
        ),
      1000,
    );
    return () => clearInterval(timer);
  }, [running, at.totalSeconds, onChange]);
  useEffect(() => {
    if (session.elapsed >= at.totalSeconds) ended.current();
  }, [session.elapsed, at.totalSeconds]);

  const phases = [format.conceptMinutes, format.codingMinutes].filter(
    Boolean,
  ).length;
  const conceptPct = format.conceptMinutes
    ? Math.min(100, (session.elapsed / at.conceptSeconds) * 100)
    : 0;
  const codingPct = format.codingMinutes
    ? Math.max(
        0,
        Math.min(
          100,
          ((session.elapsed - at.conceptSeconds) /
            (format.codingMinutes * 60)) *
            100,
        ),
      )
    : 0;

  return (
    <div className="rehearsal-live">
      <div className="rehearsal-bar">
        <span className={`rehearsal-phase ${at.phase}`}>
          {at.phase === "concept" ? "CONCEPT PHASE" : "CODING PHASE"}
        </span>
        <div className="rehearsal-progress">
          <div className="rehearsal-tracks">
            {format.conceptMinutes > 0 && (
              <div className="track" style={{ flex: format.conceptMinutes }}>
                <div className="concept" style={{ width: `${conceptPct}%` }} />
              </div>
            )}
            {format.codingMinutes > 0 && (
              <div className="track" style={{ flex: format.codingMinutes }}>
                <div className="coding" style={{ width: `${codingPct}%` }} />
              </div>
            )}
          </div>
        </div>
        <span
          className={`rehearsal-clock${at.warning ? ` ${at.warning}` : ""}`}
          aria-label="Phase time left"
        >
          {clock(at.phaseLeft)}
        </span>
        <span className="rehearsal-muted">session {clock(at.sessionLeft)}</span>
        {at.phase === "concept" && format.codingMinutes > 0 && (
          <Button onClick={() => update({ elapsed: at.conceptSeconds })}>
            Start coding
          </Button>
        )}
        {!settings.strict && (
          <Button onClick={() => update({ paused: !session.paused })}>
            <Icon name={session.paused ? "play_arrow" : "pause"} />
            {session.paused ? "Resume" : "Pause"}
          </Button>
        )}
        <Button variant="primary" onClick={onEnd}>
          End session
        </Button>
      </div>
      {at.warning && (
        <div className={`rehearsal-banner ${at.warning}`} role="status">
          <Icon name="timer" />
          {at.warning === "last"
            ? "One minute left in this phase. Start wrapping up."
            : `Five minutes left in the ${at.phase} phase.`}
        </div>
      )}
      {session.paused && (
        <div className="rehearsal-banner" role="status">
          <Icon name="pause_circle" />
          Paused. The clock is stopped.
        </div>
      )}
      <div className="rehearsal-columns">
        <section className="rehearsal-question" aria-label="Question">
          {at.phase === "concept" && material.concept ? (
            <>
              <div className="rehearsal-eyebrow">
                QUESTION 1 OF {phases} · CONCEPT
              </div>
              <h2>{material.concept.choice.title}</h2>
              <p className="rehearsal-muted">
                Answer out loud in 60–90 seconds. Then write down only what you
                missed.
              </p>
              <textarea
                aria-label="Points I missed"
                rows={8}
                placeholder="Points I missed…"
                value={session.notes}
                onChange={(event) => update({ notes: event.target.value })}
              />
              {settings.followUps && (
                <FollowUps
                  key="concept"
                  questions={material.concept.followUps}
                />
              )}
            </>
          ) : material.coding ? (
            <>
              <div className="rehearsal-eyebrow">
                QUESTION {phases} OF {phases} · CODING
              </div>
              <h2>{material.coding.choice.title}</h2>
              <p className="rehearsal-statement">{material.coding.statement}</p>
              {material.coding.example && (
                <div className="rehearsal-example">
                  {material.coding.example}
                </div>
              )}
              <textarea
                aria-label="Your solution"
                className="rehearsal-code"
                rows={12}
                spellCheck={false}
                placeholder="Write your solution…"
                value={session.code}
                onChange={(event) => update({ code: event.target.value })}
              />
              <label className="rehearsal-complexity">
                Complexity
                <input
                  placeholder="e.g. O(n) time, O(1) space"
                  value={session.complexity}
                  onChange={(event) =>
                    update({ complexity: event.target.value })
                  }
                />
              </label>
              {settings.followUps && (
                <FollowUps key="coding" questions={CODING_FOLLOW_UPS} />
              )}
            </>
          ) : null}
        </section>
        <aside className="rehearsal-side">
          {at.phase === "coding" && material.coding && (
            <Hints
              available={material.coding.reveals}
              opened={session.reveals}
              complexityStated={session.complexity.trim() !== ""}
              onOpen={(id) => update({ reveals: [...session.reveals, id] })}
            />
          )}
          <div className="rehearsal-card">
            <div className="rehearsal-card-head">
              <span>Did you…</span>
              <span className="rehearsal-muted">
                {session.checks.length} / {CHECKS.length}
              </span>
            </div>
            {CHECKS.map((label, index) => {
              const on = session.checks.includes(index);
              return (
                <button
                  key={label}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  className={`rehearsal-check${on ? " on" : ""}`}
                  onClick={() =>
                    update({
                      checks: on
                        ? session.checks.filter((item) => item !== index)
                        : [...session.checks, index],
                    })
                  }
                >
                  <span className="box">{on && <Icon name="check" />}</span>
                  {label}
                </button>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}

// [DOMAIN] Each hint costs points once opened; the reference solution and
// tests wait until the complexity has been stated.
function Hints({
  available,
  opened,
  complexityStated,
  onOpen,
}: {
  available: Partial<Record<RehearsalReveal, string>>;
  opened: readonly RehearsalReveal[];
  complexityStated: boolean;
  onOpen(id: RehearsalReveal): void;
}) {
  const offered = REVEALS.filter((reveal) => available[reveal.id]);
  return (
    <div className="rehearsal-card">
      <div className="rehearsal-card-head">
        <span>Hints</span>
        <span className="rehearsal-muted">−{REVEAL_COST} each</span>
      </div>
      {offered.length === 0 && (
        <p className="rehearsal-muted">This question has no hints.</p>
      )}
      {offered.map((reveal) => {
        const open = opened.includes(reveal.id);
        const locked =
          !open &&
          !complexityStated &&
          LOCKED_UNTIL_COMPLEXITY.includes(reveal.id);
        return (
          <div key={reveal.id} className="rehearsal-reveal">
            <button
              type="button"
              aria-expanded={open}
              disabled={locked}
              onClick={() => !open && onOpen(reveal.id)}
            >
              <Icon
                name={open ? "visibility" : locked ? "lock" : "visibility_off"}
              />
              <span>{reveal.label}</span>
              <span className="rehearsal-muted">
                {open ? "opened" : locked ? "state complexity first" : ""}
              </span>
            </button>
            {open && <pre>{available[reveal.id]}</pre>}
          </div>
        );
      })}
    </div>
  );
}

// The interviewer's follow-ups, asked one at a time.
function FollowUps({ questions }: { questions: readonly string[] }) {
  const [asked, setAsked] = useState(0);
  if (questions.length === 0) return null;
  return (
    <div className="rehearsal-followups">
      <div className="rehearsal-card-head">
        <span>
          <Icon name="record_voice_over" /> Interviewer follow-ups
        </span>
        <span className="rehearsal-muted">
          {asked} / {questions.length}
        </span>
      </div>
      {questions.slice(0, asked).map((question) => (
        <p key={question}>“{question}”</p>
      ))}
      {asked < questions.length && (
        <Button onClick={() => setAsked(asked + 1)}>Ask a follow-up</Button>
      )}
    </div>
  );
}
