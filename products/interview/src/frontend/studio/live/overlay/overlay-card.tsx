// The overlay card: the Active Session as a compact card, composed from the one
// session store (useLiveSession), the one hands-free controller
// (use-hands-free.ts) and the pure overlay model. It fetches, converses and
// edits nothing of its own. Three hosts show this same component: the Studio
// page (a draggable card floating over it), the Document Picture-in-Picture
// window (the card fills it) and the chromeless overlay route (the card fills
// the viewport). Inside the Studio page the card reuses the page's controller,
// so the page and the card never run two microphones. Nothing here moves
// keyboard focus when a result arrives.
//
// [SAFETY] The footer says plainly that this is a normal window that shows in
// screen shares. Nothing here types into another app or hides the card.
import type { LiveCaptureSource } from "@omnitech/interview-contracts";
import { Fragment, useContext, useEffect, useRef, useState } from "react";
import { Icon } from "../../icon";
import { cardSize, presentation, usePresentation } from "../focus-presentation";
import type { ActivityKey } from "../session-banners";
import { idleCopy } from "../task-panels";
import { useSessionDraftLink } from "../workspace-handoff";
import { claimCaptureTrigger } from "./capture-trigger";
import { useCardDrag } from "./card-position";
import { ChatLog } from "./chat-log";
import { CompanionSetup } from "./companion-setup";
import { HandsFreeContext } from "./hands-free-context";
import {
  HandsFreeBar,
  HandsFreeCapture,
  HandsFreeDialogs,
  HandsFreeFollowUp,
  HandsFreeNote,
} from "./hands-free-controls";
import { Footer } from "./overlay-footer";
import {
  activityRows,
  answerSummary,
  approach,
  chatRows,
  localityChips,
  provenance,
  SOURCE_ICON,
  sessionTitle,
  slotView,
  solution,
  sourceAdvice,
  statusChip,
} from "./overlay-model";
import { shortcutOf } from "./overlay-shortcuts";
import {
  ApproachBlock,
  Disclosure,
  Slots,
  SolutionBlock,
  TaskHead,
} from "./overlay-task";
import { SessionSwitcher } from "./session-switcher";
import { SourcePopover } from "./source-popover";
import {
  type CardVariant,
  openDraft,
  openStartPage,
  openSummary,
} from "./studio-links";
import { type HandsFree, useHandsFree } from "./use-hands-free";

type CardProps = {
  variant?: CardVariant;
  // Given when another window embeds the card (the PiP): "Back to Studio".
  onLeave?: () => void;
};

export function OverlayCard(props: CardProps) {
  const shared = useContext(HandsFreeContext);
  return shared ? (
    <CardView {...props} hf={shared} />
  ) : (
    <OwnedCard {...props} />
  );
}

// A document without the Studio shell's controller makes its own.
function OwnedCard(props: CardProps) {
  return <CardView {...props} hf={useHandsFree("card")} />;
}

function CardView({
  variant = "tab",
  onLeave,
  hf,
}: CardProps & { hf: HandsFree }) {
  const { snapshot, actions, model, selected, tasks, newest } = hf;
  const presented = usePresentation();
  // One component, two sizes: the same instance stays mounted when the size
  // changes, so typed text and open menus survive. Only the tab card resizes;
  // the overlay page's window is its own size.
  const maximized = variant === "tab" && cardSize(presented) === "maximized";
  const card = useRef<HTMLElement>(null);
  const drag = useCardDrag(card, snapshot.session !== null);
  const session = snapshot.session;
  const deviceOnly = hf.deviceOnly;
  const [sourceOpen, setSourceOpen] = useState<LiveCaptureSource | null>(null);
  // While this card is up it hosts the dialogs and the capture menu.
  const { attachCard } = hf;
  useEffect(() => attachCard(), [attachCard]);
  const viewingEarlier = selected !== undefined && selected !== newest;
  const workspace = useSessionDraftLink(session, selected?.taskId);
  const { copy } = hf;
  if (!session) return null;
  const open = hf.open;
  const captures = hf.captures;
  const capture = captures[captures.length - 1] ?? null;
  const number = selected ? tasks.indexOf(selected) + 1 : 0;
  const chips = localityChips(session, snapshot.actions);
  const status = statusChip(model);
  const paused = hf.paused;
  const pending = hf.pending;
  const phase = hf.phase;
  const working = [
    "drafting",
    "reading-coding-task",
    "coding-draft",
    "agent-working",
  ].includes(model.activity.key);
  const connected = model.companion.status === "online";
  const coding = selected?.kind === "programming-challenge";
  const answer = selected ? approach(selected) : null;
  const code = selected ? solution(selected) : null;

  function onShortcut(event: React.KeyboardEvent) {
    const shortcut = shortcutOf(event);
    if (!shortcut) return;
    event.preventDefault();
    if (shortcut === "analyze")
      void claimCaptureTrigger().then((granted) => {
        if (granted) hf.press("capture");
      });
    else if (shortcut === "dictate") hf.press("toggle-mic");
    else if (shortcut === "mask") hf.setMaskOpen(true);
    else hf.setSettingsOpen(true);
  }
  function newSession() {
    // A finished session is dismissed so the start page can show.
    if (!open) actions.dismissFinished();
    presentation.setMode("full");
    openStartPage(variant);
  }

  const placement =
    variant === "tab" && !maximized && drag.position
      ? {
          left: drag.position.x,
          top: drag.position.y,
          right: "auto",
          bottom: "auto",
          maxHeight: `calc(100vh - ${drag.position.y + 12}px)`,
        }
      : undefined;

  return (
    <section
      ref={card}
      className="ov-card"
      data-p="glass"
      data-testid="overlay-card"
      data-variant={variant}
      data-size={maximized ? "maximized" : "compact"}
      aria-label="Live session overlay"
      style={placement}
      onKeyDown={(event) => {
        onShortcut(event);
        // Escape restores the maximized card (menus handle their own Escape).
        if (
          maximized &&
          !event.defaultPrevented &&
          event.key === "Escape" &&
          !event.nativeEvent.isComposing
        )
          presentation.setMode("card");
      }}
    >
      <header
        className="ov-head"
        data-draggable={variant === "tab" || undefined}
        {...(variant === "tab" ? drag.header : {})}
      >
        {variant === "tab" && (
          <button
            type="button"
            className="ov-icon-button ov-handle"
            aria-label="Move card. Use the arrow keys; Home resets."
            title="Drag the header, or focus this and use the arrow keys"
            onKeyDown={drag.onHandleKeyDown}
          >
            <Icon name="drag_indicator" />
          </button>
        )}
        <span className={`ov-status ${status.tone}`} data-testid="ov-status">
          <span className="ov-dot" aria-hidden="true" />
          {status.text}
        </span>
        <span
          className="ov-title"
          data-testid="ov-title"
          title={sessionTitle(session)}
        >
          {sessionTitle(session)}
        </span>
        {variant === "tab" && (
          <>
            <button
              type="button"
              className="ov-icon-button"
              aria-label="Close overlay"
              title="Close this card and return to the previous view"
              onClick={() => presentation.closeFloat()}
            >
              <Icon name="close" />
            </button>
          </>
        )}
        {variant === "overlay" && onLeave && (
          <button
            type="button"
            className="ov-icon-button"
            aria-label="Back to Studio"
            title="Close this window and return to Studio"
            onClick={onLeave}
          >
            <Icon name="close_fullscreen" />
          </button>
        )}
      </header>
      {open && <HandsFreeBar hf={hf} onStartRemote={newSession} />}
      <div className="ov-chips">
        <span className="ov-chip" data-testid="ov-locality">
          <Icon name={chips.locality.icon} />
          {chips.locality.text}
        </span>
        {chips.pinned && (
          <span className="ov-chip" title={chips.pinned.title}>
            <Icon name="lock" />
            {chips.pinned.text}
          </span>
        )}
        {connected && (
          <span className="ov-sources ov-sources-end" data-testid="ov-sources">
            {session.captureSources.map((source) => {
              const health = model.sources.find((s) => s.source === source);
              return (
                <span key={source} className="ov-source-wrap">
                  <button
                    type="button"
                    className="ov-source"
                    data-health={health?.health}
                    data-source={source}
                    aria-label={`${health?.label ?? source}: ${health?.health ?? "unknown"}. Show details`}
                    aria-expanded={sourceOpen === source}
                    title={`${health?.label ?? source}${health?.selected ? `: ${health.health}` : ""}`}
                    onClick={() =>
                      setSourceOpen(sourceOpen === source ? null : source)
                    }
                  >
                    <Icon name={SOURCE_ICON[source] ?? "sensors"} />
                  </button>
                  {sourceOpen === source && health && (
                    <SourcePopover
                      advice={sourceAdvice(health, model.companion)}
                      action={
                        source === "screen" && !deviceOnly
                          ? {
                              label: "Choose what to capture…",
                              run: () => hf.setCaptureMenu(true),
                            }
                          : source === "microphone"
                            ? {
                                label: "Dictate in this browser",
                                run: () => hf.press("toggle-mic"),
                              }
                            : undefined
                      }
                      onClose={() => setSourceOpen(null)}
                    />
                  )}
                </span>
              );
            })}
          </span>
        )}
        {variant === "tab" && (
          <>
            <button
              type="button"
              className="ov-icon-button"
              aria-label="Details"
              title="Open the full dashboard: sources, credentials, retention"
              onClick={() => presentation.setMode("full")}
            >
              <Icon name="grid_view" />
            </button>
            <button
              type="button"
              className="ov-icon-button"
              aria-label={maximized ? "Restore" : "Maximize"}
              aria-pressed={maximized}
              title={
                maximized
                  ? "Restore the compact card (Escape)"
                  : "Fill the page with this card"
              }
              onClick={() =>
                presentation.setMode(maximized ? "card" : "maximized")
              }
            >
              <Icon name={maximized ? "close_fullscreen" : "open_in_full"} />
            </button>
            <button
              type="button"
              className="ov-icon-button"
              aria-label="Float"
              title="Pop out into a floating window"
              onClick={() => presentation.setMode("floating")}
            >
              <Icon name="open_in_new" />
            </button>
          </>
        )}
      </div>
      {open && !connected && (
        <CompanionSetup credential={snapshot.pairing?.value ?? null} />
      )}
      <SessionSwitcher
        actions={actions}
        currentId={session.id}
        serverNowMs={model.serverNowMs}
        hasOpenSession={open}
        switching={pending.includes("switch")}
        onNewSession={newSession}
      />
      {!open ? (
        <div className="ov-ended" data-testid="ov-ended" key={session.id}>
          <Icon name="stop_circle" />
          <div className="ov-ended-title">Session ended</div>
          <div className="ov-muted">
            Capture stopped and running work was cancelled. This window kept no
            copy of the session.
          </div>
          <button
            type="button"
            className="ov-link"
            onClick={() => openSummary(session.id, variant)}
          >
            Open summary in Studio
          </button>
        </div>
      ) : (
        <Fragment key={session.id}>
          {paused && (
            <div className="ov-paused" role="status">
              <Icon name="pause_circle" />
              Paused. Nothing is captured and no new work starts.
            </div>
          )}
          <HandsFreeCapture hf={hf} />
          <div className="ov-body">
            {viewingEarlier && (
              <div className="ov-earlier" role="status">
                <Icon name="history" />
                <span>Viewing an earlier task.</span>
                <button
                  type="button"
                  className="ov-link"
                  onClick={() => presentation.pin(null)}
                >
                  Back to now
                </button>
              </div>
            )}
            {tasks.length > 1 && (
              <div
                className="ov-tasks"
                role="group"
                aria-label="Detected tasks"
              >
                {tasks.map((task, index) => (
                  <button
                    key={task.taskId}
                    type="button"
                    className="ov-task-button"
                    aria-pressed={task.taskId === selected?.taskId}
                    aria-label={`Task ${index + 1}`}
                    onClick={() =>
                      presentation.pin(
                        task.taskId === newest?.taskId ? null : task.taskId,
                      )
                    }
                  >
                    T{index + 1}
                  </button>
                ))}
              </div>
            )}
            {selected ? (
              <div className="ov-columns">
                <div className="ov-col ov-col-main">
                  <TaskHead
                    task={selected}
                    number={number}
                    chips={provenance(
                      selected,
                      snapshot.observations,
                      captures,
                    )}
                  />
                  <Slots
                    slots={[
                      slotView("ANSWER SLOT", selected.current.answerRun, true),
                      slotView("CODE SLOT", selected.current.codeRun, coding),
                    ]}
                  />
                  {answer && (
                    <ApproachBlock
                      title={coding ? "APPROACH" : "ANSWER"}
                      approach={answer}
                      numbered={coding}
                    />
                  )}
                  {!coding && selected.answer && (
                    <div className="ov-solution-actions">
                      {answerSummary(selected.answer) !== "" && (
                        <span
                          className="ov-muted"
                          data-testid="ov-verification"
                        >
                          {answerSummary(selected.answer)}
                        </span>
                      )}
                      <button
                        type="button"
                        className="ov-button"
                        onClick={() =>
                          selected.answer && copy(selected.answer.draft)
                        }
                      >
                        <Icon name="content_copy" />
                        Copy answer
                      </button>
                    </div>
                  )}
                </div>
                <div className="ov-col ov-col-side">
                  {code && (
                    <SolutionBlock
                      defaultOpen={maximized}
                      solution={code}
                      onCopy={(text) => void copy(text)}
                      workspace={workspace}
                      onOpenWorkspace={(link) =>
                        openDraft(link.target, variant)
                      }
                    />
                  )}
                  <div className="ov-disclosures">
                    <Disclosure
                      defaultOpen={maximized}
                      label="Activity"
                      {...activityRows(model)}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <>
                <IdleBlock activity={model.activity.key} />
                <div className="ov-disclosures">
                  <Disclosure
                    defaultOpen={maximized}
                    label="Activity"
                    {...activityRows(model)}
                  />
                </div>
              </>
            )}
          </div>
          <HandsFreeNote hf={hf} />
          <ChatLog
            rows={chatRows(model, hf.entries)}
            activity={
              phase === "capturing"
                ? "Capturing…"
                : phase === "analyzing" || working
                  ? "Analyzing…"
                  : null
            }
          />
          <HandsFreeFollowUp hf={hf} />
          <Footer
            variant={{ kind: "live", paused }}
            pending={pending}
            actions={actions}
            onFailure={hf.fail}
          />
        </Fragment>
      )}
      <HandsFreeDialogs hf={hf} />
    </section>
  );
}

function IdleBlock({ activity }: { activity: ActivityKey }) {
  const idle = idleCopy(activity);
  if (!idle) return null;
  return (
    <div className="ov-idle" data-testid="live-idle" data-activity={activity}>
      <Icon name={idle.icon} />
      <div className="ov-idle-title">{idle.title}</div>
      <div className="ov-muted">{idle.detail}</div>
    </div>
  );
}
