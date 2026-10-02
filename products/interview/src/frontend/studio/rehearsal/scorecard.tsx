import { createRehearsalClient } from "@omnitech/interview-api-client";
import {
  CHECK_POINTS,
  REVEAL_COST,
  rehearsalScore,
} from "@omnitech/interview-contracts";
import { useEffect, useRef, useState } from "react";
import type { StudioActions } from "../config/commands";
import { Icon, type IconName } from "../icon";
import { CHECKS, clock, scoreHeadline, scoreTone } from "./config";
import type { QuestionChoice } from "./material";
import type {
  RehearsalSettings,
  SessionMaterial,
  SessionState,
} from "./rehearsal-view";
import { studioFetch } from "../studio-fetch";

const toRef = (choice: QuestionChoice | undefined) =>
  choice
    ? { source: choice.source, ref: choice.ref, title: choice.title }
    : null;

// The finished session: its score, what was missed, and where to go next.
// It is saved once, when the scorecard first shows.
export function Scorecard({
  settings,
  material,
  session,
  actions,
  onAgain,
}: {
  settings: RehearsalSettings;
  material: SessionMaterial;
  session: SessionState;
  actions: StudioActions;
  onAgain(): void;
}) {
  // The server scores it the same way; this shows it without waiting.
  const score = rehearsalScore(session.checks.length, session.reveals.length);
  const [saved, setSaved] = useState<"saving" | "saved" | "failed">("saving");
  const saving = useRef(false);
  useEffect(() => {
    if (saving.current) return;
    saving.current = true;
    createRehearsalClient({ baseUrl: "", fetch: studioFetch })
      .save({
        format: settings.format,
        strict: settings.strict,
        followUps: settings.followUps,
        concept: toRef(material.concept?.choice),
        coding: toRef(material.coding?.choice),
        checks: [...session.checks],
        reveals: [...session.reveals],
        activeSeconds: session.elapsed,
        startedAt: session.startedAt,
        endedAt: new Date().toISOString(),
      })
      .then(
        () => setSaved("saved"),
        () => setSaved("failed"),
      );
  }, [settings, material, session]);

  // [DOMAIN] Practise the first two missed habits on the coding question,
  // then the concept answer out loud.
  const missed = CHECKS.filter((_, index) => !session.checks.includes(index));
  const coding = material.coding?.choice;
  const concept = material.concept?.choice;
  const next: { icon: IconName; title: string; detail: string; go(): void }[] =
    [
      ...missed.slice(0, 2).map((title) => ({
        icon: "check_circle" as const,
        title,
        detail: "Missed this time. Practise it in the Workspace",
        go: () =>
          coding ? actions.openArtifact(coding.ref) : actions.go("work"),
      })),
      ...(concept
        ? [
            {
              icon: "lightbulb" as const,
              title: concept.title,
              detail: "Rehearse the concept answer out loud",
              go: () =>
                concept.source === "brief"
                  ? actions.openBrief(concept.ref)
                  : actions.go("briefings"),
            },
          ]
        : []),
    ];
  const hints = session.reveals.length;

  return (
    <div className="rehearsal-score">
      <div className="rehearsal-score-head">
        <div className={`rehearsal-ring ${scoreTone(score)}`}>
          <span className="value">{score}</span>
          <span className="rehearsal-muted">of 100</span>
        </div>
        <div>
          <h1 className="rehearsal-title">{scoreHeadline(score)}</h1>
          <p className="rehearsal-muted">
            {session.checks.length * CHECK_POINTS} from the checklist, −
            {hints * REVEAL_COST} for {hints} hint{hints === 1 ? "" : "s"}.
          </p>
          <p className="rehearsal-muted" role="status">
            {saved === "saving"
              ? "Saving…"
              : saved === "saved"
                ? "Saved to your rehearsal history."
                : "This session couldn’t be saved."}
          </p>
        </div>
      </div>
      <dl className="rehearsal-stats">
        <div>
          <dt>Checklist</dt>
          <dd>
            {session.checks.length} / {CHECKS.length}
          </dd>
        </div>
        <div>
          <dt>Hints opened</dt>
          <dd>{hints}</dd>
        </div>
        <div>
          <dt>Time used</dt>
          <dd>{clock(session.elapsed)}</dd>
        </div>
      </dl>
      {next.length > 0 && (
        <div className="rehearsal-card">
          <div className="rehearsal-card-head">
            <span>Practise next</span>
          </div>
          {next.map((item) => (
            <button
              key={item.title}
              type="button"
              className="rehearsal-next"
              onClick={item.go}
            >
              <Icon name={item.icon} />
              <span>
                <span className="title">{item.title}</span>
                <span className="rehearsal-muted">{item.detail}</span>
              </span>
              <Icon name="chevron_right" />
            </button>
          ))}
        </div>
      )}
      <div className="rehearsal-actions">
        <button
          type="button"
          className="studio-button primary"
          onClick={onAgain}
        >
          Rehearse again
        </button>
        <button
          type="button"
          className="studio-button"
          onClick={() => actions.go("home")}
        >
          Back to prep plan
        </button>
      </div>
    </div>
  );
}
