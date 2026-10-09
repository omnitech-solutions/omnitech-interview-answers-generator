// The footer: the library's session bar with the session clock, Pause or
// Resume, and End (with its confirmation). Each calls a store action.

import {
  Button,
  Popconfirm,
  SessionBar,
  StatusClock,
  type StatusClockBuildTag,
} from "@oc-tech/omni-ui-components";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Icon } from "../../icon";
import type { SessionErrorCode } from "../session-client";
import type { CommandResult, SessionActions } from "../session-snapshot";
import { BUILD } from "./build-id";
import type { HeardLine } from "./panels/panel-model";
import { PAUSED_NOTICE } from "./panels/strip-model";
import { footerButtons } from "./panels/toolbar-config";
import { RecordTranscriptButton } from "./record-transcript";

const UNAVAILABLE_NOTE =
  "Not available yet: this Studio server can’t take owner input.";

// What each fixed refusal reason from the server means, in plain words.
const REFUSAL_REASONS: Record<string, string> = {
  fields: "the request had a missing or unexpected field",
  body: "the upload could not be read as a form",
  no_image: "no image came with the request",
  image_empty: "the image was empty",
  image_too_large: "the image was over the 2 MB limit",
  image_type: "the image was not a JPEG, PNG or WebP",
  image_unreadable: "the image header could not be read",
  image_dimensions: "the image dimensions were out of range",
  target: "the task to attach it to was not valid",
};

// `reason` is the refused request's own (CommandResult.reason), never a global.
export const failureNote = (
  code: SessionErrorCode,
  reason?: string | null,
): string =>
  code === "unavailable"
    ? UNAVAILABLE_NOTE
    : code === "invalid_input"
      ? `The server refused that capture (invalid_input${
          reason ? `: ${REFUSAL_REASONS[reason] ?? reason}` : ""
        }). The session is unchanged; the next capture tries again.`
      : code === "status_refused"
        ? "The session is not taking captures now (status_refused). Resume it or start a new one."
        : `That didn’t work (${code}). The session is unchanged.`;

// What the footer is for. A live session shows its running time (amber while
// paused) with Pause or Resume and End; a finished session offers a new one (and
// its summary page) instead; with no session yet there are no session buttons.
export type FooterVariant =
  | {
      kind: "live";
      paused: boolean;
      // The formatted session time; without it only the buttons show.
      clock?: { label: string } | null;
      // What was heard, newest first (the age of the latest shows beside the
      // clock), and the microphone's level now (0-100) for the sound wave.
      heard?: readonly HeardLine[];
      micLevel?: number | null;
      // The session, for its Record transcript control. Absent: no control.
      sessionId?: string | null;
    }
  | {
      kind: "ended";
      starting: boolean;
      onStart(): void;
      onOpenSummary?(): void;
    }
  // No session yet (signed out, or signed in and not started): the same bar with
  // no session buttons, and who is signed in at its right end.
  | { kind: "idle"; status: ReactNode };

const COPIED_SHOWN_MS = 1500;

// The development build tag: `<short sha> · <branch>`, the full commit as its
// tooltip, choosing it copies the commit. Null in a packaged build.
function useBuildTag(): StatusClockBuildTag | null {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (BUILD.packaged) return null;
  return {
    sha: BUILD.id,
    ...(BUILD.branch ? { branch: BUILD.branch } : {}),
    title: BUILD.sha,
    copied,
    onCopy: () => {
      void navigator.clipboard?.writeText(BUILD.sha)?.catch(() => undefined);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_SHOWN_MS);
    },
  };
}

// A filled red disc: the recording mark before the session time.
function RecordIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6" fill="currentColor" />
    </svg>
  );
}

// The session clock: the record mark and the formatted time, amber with the
// paused wording while paused (nothing else about the bar changes with state).
export function SessionClock({
  elapsed,
  paused,
}: {
  elapsed: string;
  paused: boolean;
}) {
  return (
    <StatusClock
      state={paused ? "paused" : "live"}
      elapsed={elapsed}
      label={`Session time ${elapsed}${paused ? ", paused" : ""}`}
      icon={<RecordIcon />}
      pausedIcon={<Icon name="pause_circle" filled />}
      pausedLabel={PAUSED_NOTICE.label}
      {...(paused ? { title: PAUSED_NOTICE.sub } : {})}
    />
  );
}

export function Footer({
  variant,
  // The one-window view spells out what each button acts on: "End session".
  wording = "short",
  pending,
  actions,
  onFailure,
  context,
}: {
  variant: FooterVariant;
  wording?: "short" | "session";
  // What the session is for (the interview's context chip), shown for the
  // whole session, before the build tag.
  context?: ReactNode;
  pending: readonly string[];
  actions: SessionActions;
  onFailure(code: SessionErrorCode): void;
}) {
  const buildTag = useBuildTag();
  const run = async (work: Promise<CommandResult>) => {
    const result = await work;
    if (!result.ok) onFailure(result.code);
    return result.ok;
  };
  const busy = pending.includes("pause") || pending.includes("resume");
  if (variant.kind === "idle")
    return (
      <SessionBar
        label="Session footer"
        actions={
          <>
            {buildTag && (
              <Button
                variant="ghost"
                buttonSize="sm"
                title={buildTag.title}
                aria-label={`Copy build ${buildTag.title ?? buildTag.sha}`}
                onClick={buildTag.onCopy}
              >
                {buildTag.copied
                  ? "Copied"
                  : `${buildTag.sha}${buildTag.branch ? ` · ${buildTag.branch}` : ""}`}
              </Button>
            )}
            <span data-testid="ov-status" className="ov-status">
              {variant.status}
            </span>
          </>
        }
      />
    );
  if (variant.kind === "ended") {
    const ended = footerButtons(
      {
        kind: "ended",
        starting: variant.starting,
        canSummary: variant.onOpenSummary !== undefined,
      },
      wording,
    );
    const summary = ended.find((button) => button.id === "summary");
    const start = ended.find((button) => button.id === "start");
    return (
      <SessionBar
        label="Session footer"
        actions={
          <>
            {summary && (
              <Button
                variant="outline"
                tone="neutral"
                soft
                buttonSize="control"
                icon={<Icon name="open_in_new" />}
                onClick={variant.onOpenSummary}
              >
                {summary.label}
              </Button>
            )}
            <Button
              tone="success"
              buttonSize="control"
              fillIcon
              icon={<Icon name="play_circle" filled />}
              disabled={variant.starting}
              onClick={variant.onStart}
            >
              {start?.label}
            </Button>
          </>
        }
      />
    );
  }
  // What each live button says; which one shows is the bar's status.
  const [pause, end] = footerButtons(
    { kind: "live", paused: false, busy },
    wording,
  );
  const [resume] = footerButtons({ kind: "live", paused: true, busy }, wording);
  const clock = variant.clock;
  const paused = variant.paused;
  return (
    <SessionBar
      label="Session footer"
      status={paused ? "paused" : "live"}
      leading={
        <>
          {clock && <SessionClock elapsed={clock.label} paused={paused} />}
          <MicLine
            heard={variant.heard ?? []}
            paused={paused}
            level={variant.micLevel ?? null}
          />
        </>
      }
      // The library's own buttons, composed here so the build tag can sit
      // just before them (owner's rule).
      actions={
        <>
          {context}
          {buildTag && <BuildTagChip tag={buildTag} />}
          {variant.sessionId && (
            <RecordTranscriptButton
              sessionId={variant.sessionId}
              disabled={paused}
            />
          )}
          {paused ? (
            <Button
              buttonSize="control"
              tone="success"
              fillIcon
              icon={<Icon name="play_arrow" filled />}
              disabled={busy}
              onClick={() => void run(actions.resume())}
              data-slot="session-resume"
            >
              {resume?.label}
            </Button>
          ) : (
            <Button
              buttonSize="control"
              variant="outline"
              tone="neutral"
              soft
              fillIcon
              icon={<Icon name="pause" filled />}
              disabled={busy}
              onClick={() => void run(actions.pause())}
              data-slot="session-pause"
            >
              {pause?.label}
            </Button>
          )}
          <Popconfirm
            title="End this session?"
            description="Capture stops and running work is cancelled."
            confirmText="End now"
            cancelText="Keep going"
            onConfirm={() => void run(actions.end())}
          >
            <Button
              buttonSize="control"
              variant="outline"
              tone="danger"
              soft
              disabled={pending.includes("end")}
              data-slot="session-end"
            >
              {end?.label}
            </Button>
          </Popconfirm>
        </>
      }
    />
  );
}

// The build tag at the far right of the footer (development builds only).
function BuildTagChip({
  tag,
}: {
  tag: ReturnType<typeof useBuildTag> & object;
}) {
  return (
    <Button
      variant="ghost"
      buttonSize="sm"
      className="pn-build-tag"
      title={tag.title}
      aria-label={tag.copied ? "Copied" : `Copy build ${tag.title ?? tag.sha}`}
      onClick={tag.onCopy}
      data-testid="pn-build-tag"
    >
      {tag.copied ? "Copied" : tag.sha}
      {tag.branch && !tag.copied ? ` · ${tag.branch}` : ""}
    </Button>
  );
}

// What the microphone is doing, beside the clock: a sound wave while it hears
// something (level from the shell), the age of the last words otherwise. The
// Transcript & chat panel is the one record of what was heard.
function MicLine({
  heard,
  paused,
  level,
}: {
  heard: readonly HeardLine[];
  paused: boolean;
  level: number | null;
}) {
  const latest = heard[0] ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const age = latest ? Math.max(0, Math.round((now - latest.at) / 1000)) : null;
  const text = paused
    ? "Paused"
    : latest
      ? `Listening · heard ${age}s ago`
      : "Listening · nothing heard yet";
  const bars = [0.35, 0.7, 1, 0.6, 0.4];
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the label names this part for assistive technology; the role it would need changes the accessibility tree, so it waits for an accessibility pass
    <span
      className="pn-mic-line"
      data-testid="pn-mic-line"
      data-level={level ?? 0}
      aria-label={text}
    >
      <span className="pn-mic-wave" aria-hidden="true">
        {bars.map((weight, index) => (
          <i
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed bars
            key={index}
            style={{
              height: `${Math.max(2, Math.round(((level ?? 0) / 100) * 14 * weight) + 2)}px`,
            }}
          />
        ))}
      </span>
      <span className="pn-mic-line-text">{text}</span>
    </span>
  );
}
