import {
  createRehearsalClient,
  InterviewApiError,
} from "@omnitech/interview-api-client";
import {
  CHECK_POINTS,
  REVEAL_COST,
  type RehearsalSession,
  rehearsalScore,
} from "@omnitech/interview-contracts";
import { useEffect, useRef, useState } from "react";
import type { StudioActions } from "../config/commands";
import { Icon, type IconName } from "../icon";
import {
  currentRehearsalLink,
  markRehearsalRunSaved,
  type RehearsalRunLink,
} from "../live/rehearsal-run-link";
import { studioFetch } from "../studio-fetch";
import { CHECKS, clock, scoreHeadline, scoreTone } from "./config";
import type { QuestionChoice } from "./material";
import type {
  RehearsalSettings,
  SessionMaterial,
  SessionState,
} from "./rehearsal-view";
import { Button } from "../../ui";

// What to tell the owner about the live session's hints. Only what the server
// confirmed is stated as a count; nothing is claimed before the save returns.
function liveSessionNote(
  link: RehearsalRunLink,
  saved: "saving" | "saved" | "failed",
  sessionHints: number,
  alreadyCounted: boolean,
): string | null {
  if (link.kind === "strictness-mismatch")
    return "Your live session used a different strictness, so this session's hints were NOT applied to the score.";
  if (link.kind !== "linked" || saved !== "saved") return null;
  if (alreadyCounted)
    return "This live session's hints were already counted by an earlier save, so this save adds none.";
  const count =
    sessionHints === 0
      ? "No drafts from your live session were counted as hints."
      : `${sessionHints} hint${sessionHints === 1 ? "" : "s"} from your live session ${sessionHints === 1 ? "is" : "are"} included.`;
  return link.open
    ? `${count} The session is still open: drafts shown after this save are not counted.`
    : count;
}

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
  const [saved, setSaved] = useState<"saving" | "saved" | "failed">("saving");
  // What the server stored: its score includes any live-session hints.
  const [result, setResult] = useState<RehearsalSession | null>(null);
  // The server had already derived this run id's hints: saved without them.
  const [alreadyCounted, setAlreadyCounted] = useState(false);
  const saving = useRef(false);
  // [SAFETY] Chosen once, when the save starts: the session's run id is sent
  // only when its strictness matches this rehearsal's.
  const link = useRef<RehearsalRunLink>({ kind: "none" });
  const score =
    result?.score ??
    rehearsalScore(session.checks.length, session.reveals.length);
  useEffect(() => {
    if (saving.current) return;
    saving.current = true;
    link.current = currentRehearsalLink(settings.strict);
    const linked = link.current;
    const client = createRehearsalClient({ baseUrl: "", fetch: studioFetch });
    const save = (runId: string | null) =>
      client.save({
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
        ...(runId ? { rehearsalRunId: runId } : {}),
      });
    const stored = (result: RehearsalSession) => {
      setResult(result);
      setSaved("saved");
    };
    save(linked.kind === "linked" ? linked.runId : null)
      .then((result) => {
        if (linked.kind === "linked") markRehearsalRunSaved(linked.runId);
        stored(result);
      })
      .catch((error: unknown) => {
        // [SAFETY] A run id derives hints once. If the server already did (a
        // save this page no longer remembers), remember it and save once more
        // without it, rather than leaving the scorecard failed forever.
        if (
          linked.kind === "linked" &&
          error instanceof InterviewApiError &&
          error.status === 409 &&
          error.message === "rehearsal-run-already-saved"
        ) {
          markRehearsalRunSaved(linked.runId);
          setAlreadyCounted(true);
          return save(null).then(stored);
        }
        throw error;
      })
      .catch(() => setSaved("failed"));
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
  const sessionHints = result?.sessionHints ?? 0;
  const linkNote = liveSessionNote(
    link.current,
    saved,
    sessionHints,
    alreadyCounted,
  );

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
            {(hints + sessionHints) * REVEAL_COST} for {hints + sessionHints}{" "}
            hint{hints + sessionHints === 1 ? "" : "s"}.
          </p>
          {linkNote && <p className="rehearsal-muted">{linkNote}</p>}
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
        {sessionHints > 0 && (
          <div>
            <dt>Live session hints</dt>
            <dd>{sessionHints}</dd>
          </div>
        )}
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
        <Button variant="primary" onClick={onAgain}>
          Rehearse again
        </Button>
        <Button onClick={() => actions.go("home")}>Back to prep plan</Button>
      </div>
    </div>
  );
}
