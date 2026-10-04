// The overlay card: the Active Session as a compact card, composed from the one
// session store (useLiveSession) and the pure overlay model. It fetches,
// converses and edits nothing of its own. Three hosts show this same
// component: the Studio page (a draggable card floating over it), the
// Document Picture-in-Picture window (the card fills it) and the chromeless
// overlay route (the card fills the viewport). Nothing here moves keyboard
// focus when a result arrives.
//
// [SAFETY] The footer says plainly that this is a normal window that shows in
// screen shares. Nothing here types into another app or hides the card.
import type { LiveCaptureSource } from "@omnitech/interview-contracts";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../icon";
import {
  CAPTURE_UPDATE_LINE,
  captureRequestSupport,
} from "../companion-capability";
import { cardSize, presentation, usePresentation } from "../focus-presentation";
import { copyText } from "../live-session-view";
import type { ActivityKey } from "../session-banners";
import type { SessionErrorCode } from "../session-client";
import { isOpenSession } from "../session-deps";
import { latestTarget } from "../session-owner-input";
import { idleCopy } from "../task-panels";
import { useCompanionCapability } from "../use-companion-capability";
import { useLiveSession } from "../use-live-session";
import { useSessionDraftLink } from "../workspace-handoff";
import { AutoStatus } from "./auto-status";
import { FrameError } from "./capture-source";
import { claimCaptureTrigger } from "./capture-trigger";
import { useCardDrag } from "./card-position";
import { ChatLog } from "./chat-log";
import { CommandBar } from "./command-bar";
import { CompanionSetup } from "./companion-setup";
import { ListeningHint } from "./listening-hint";
import { MaskEditor } from "./mask-editor";
import { FULL, isFull, toDisplayRegion } from "./mask-geometry";
import {
  type AnalyzeChoice,
  type AnalyzeVia,
  CaptureStrip,
  DEVICE_ONLY_ANALYZE,
} from "./overlay-capture";
import {
  FollowUp,
  Footer,
  failureNote,
  UNAVAILABLE_NOTE,
} from "./overlay-footer";
import {
  activityRows,
  answerSummary,
  approach,
  type ChatEntry,
  captureList,
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
import { SettingsPopover } from "./settings-popover";
import { takeAnnouncement } from "./share-handoff";
import { SourcePopover } from "./source-popover";
import {
  type CardVariant,
  openDraft,
  openStartPage,
  openSummary,
} from "./studio-links";
import { useAutoMode } from "./use-auto-mode";
import { useCapturePrefs } from "./use-capture-prefs";
import { useCompanionCapture } from "./use-companion-capture";
import { useHostHotkeys } from "./use-host-hotkeys";
import { useScreenShare } from "./use-screen-share";

// How often the companion's capability report is read again.
const CAPABILITY_REFRESH_MS = 10_000;

// What an automatic capture is called in the transcript and Activity.
export const AUTO_CAPTURE_LABEL = "Auto-captured · screen changed";

export const ANNOUNCE_MS = 8_000;

// How long the "Captured" preview stays.
export const FLASH_MS = 2_500;

export function OverlayCard({
  variant = "tab",
  onLeave,
}: {
  variant?: CardVariant;
  // Given when another window embeds the card (the PiP): "Back to Studio".
  onLeave?: () => void;
}) {
  const { snapshot, actions, model } = useLiveSession();
  const presented = usePresentation();
  const { pinnedTaskId } = presented;
  // One component, two sizes: the same instance stays mounted when the size
  // changes, so typed text and open menus survive. Only the tab card resizes;
  // the overlay page's window is its own size.
  const maximized = variant === "tab" && cardSize(presented) === "maximized";
  const card = useRef<HTMLElement>(null);
  const drag = useCardDrag(card, snapshot.session !== null);
  const [note, setNote] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const session = snapshot.session;
  const deviceOnly = session?.processingPolicy === "device-only";
  const prefs = useCapturePrefs(snapshot.tenant);
  const share = useScreenShare();
  const [captureMenu, setCaptureMenu] = useState(false);
  const [maskOpen, setMaskOpen] = useState(false);
  // The companion's region editor (relative to the main display), and the choice
  // (new task or attach) it will capture for.
  const [displayMask, setDisplayMask] = useState<AnalyzeChoice | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState<LiveCaptureSource | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  // The frame that was just taken, shown for a moment so it is clear it worked.
  const [flash, setFlash] = useState<{
    url: string | null;
    width: number;
    height: number;
    bytes: number;
  } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => {
      clearTimeout(timer);
      if (flash.url) URL.revokeObjectURL(flash.url);
    };
  }, [flash]);
  const [followText, setFollowText] = useState("");
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const addEntry = useCallback((kind: ChatEntry["kind"], text: string) => {
    setEntries((current) =>
      [
        ...current,
        {
          key: `${kind}-${Date.now()}-${current.length}`,
          kind,
          text,
          at: Date.now(),
        },
      ].slice(-20),
    );
  }, []);
  const companionCapture = useCompanionCapture(
    actions,
    snapshot.session?.id ?? null,
    snapshot.actions.length,
  );
  const capability = useCompanionCapability(CAPABILITY_REFRESH_MS);
  const support = captureRequestSupport(
    capability.status === "ready" ? capability.capability : null,
  );
  const auto = useAutoMode({
    tenant: snapshot.tenant,
    sessionId: snapshot.session?.id ?? null,
    open: isOpenSession(snapshot.session),
    paused: snapshot.session?.status === "paused",
    deviceOnly,
    wantsScreen: snapshot.session?.captureSources.includes("screen") ?? false,
    sharing: share.status === "sharing",
    watchable: share.kind !== "This Mac" && share.kind !== null,
    sample: share.sample,
    mask: prefs.mask,
    busy:
      grabbing ||
      snapshot.pending.includes("analyze") ||
      companionCapture.progress?.phase === "asking",
    capture: () => autoCapture(),
    submitHeard: actions.submitHeard,
    resume: actions.resume,
    onManualFinal: (phrase) => {
      setFollowText((text) =>
        text.trim() === "" ? phrase : `${text.trimEnd()} ${phrase}`,
      );
      addEntry("Dictated", phrase);
    },
  });
  const dictation = auto.dictation;
  // "Hands-free is on." from Start hands-free, shown for a few seconds.
  const [announced, setAnnounced] = useState<string | null>(takeAnnouncement);
  useEffect(() => {
    if (!announced) return;
    const timer = setTimeout(() => setAnnounced(null), ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [announced]);
  // Text typed or dictated for one session is never sent to another.
  const sessionKey = snapshot.session?.id ?? null;
  const sessionNow = useRef(sessionKey);
  sessionNow.current = sessionKey;
  const lastKey = useRef(sessionKey);
  useEffect(() => {
    if (lastKey.current === sessionKey) return;
    lastKey.current = sessionKey;
    setFollowText("");
    setNote(null);
  }, [sessionKey]);
  const tasks = model.tasks;
  const newest = tasks[tasks.length - 1];
  const selected = tasks.find((task) => task.taskId === pinnedTaskId) ?? newest;
  const viewingEarlier = selected !== undefined && selected !== newest;
  const workspace = useSessionDraftLink(session, selected?.taskId);
  const copy = useCallback(async (text: string) => {
    setNote(
      (await copyText(text))
        ? null
        : "Couldn’t copy. Select the text and copy it yourself.",
    );
  }, []);
  const fail = useCallback((code: SessionErrorCode) => {
    if (code === "unavailable") setUnavailable(true);
    setNote(failureNote(code));
  }, []);
  // A native host's system-wide key is the same as Alt+Shift+A on the card.
  useHostHotkeys(() => captureNow());
  if (!session) return null;

  const open = isOpenSession(session);
  const captures = captureList(snapshot.observations, model.serverNowMs);
  const capture = captures[captures.length - 1] ?? null;
  const number = selected ? tasks.indexOf(selected) + 1 : 0;
  const chips = localityChips(session, snapshot.actions);
  const status = statusChip(model);
  const paused = session.status === "paused";
  const pending = snapshot.pending;
  // What Capture & analyze is doing right now, shown at once: taking the frame,
  // then sending it. Work the server is doing shows in the transcript below.
  const phase: "capturing" | "analyzing" | null = grabbing
    ? "capturing"
    : pending.includes("analyze")
      ? "analyzing"
      : null;
  const working = [
    "drafting",
    "reading-coding-task",
    "coding-draft",
    "agent-working",
  ].includes(model.activity.key);
  const connected = model.companion.status === "online";
  const coding = selected?.kind === "programming-challenge";
  // A follow-up goes to the task last answered (the store's own rule), so the
  // label names that one, not whichever task is pinned for reading.
  const target = latestTarget(snapshot);
  const followed = target
    ? tasks.findIndex((task) => task.taskId === target.taskId)
    : -1;
  const followLabel =
    followed >= 0
      ? `Follow-up about T${followed + 1} · rev ${target?.revision}`
      : "Type a follow-up";
  const answer = selected ? approach(selected) : null;
  const code = selected ? solution(selected) : null;

  // An unset hint is sent as "auto": it resets an earlier hint, where omitting
  // it would keep it.
  const hints = {
    skill: prefs.settings.skill ?? ("auto" as const),
    language: prefs.settings.language ?? ("auto" as const),
  };
  const companionScreen = model.sources.find(
    (item) => item.source === "screen",
  );
  // The stored image "Analyze stored capture" would use, by identity.
  const stored = capture;
  const companionReady =
    companionScreen?.selected === true &&
    companionScreen.health === "receiving" &&
    captures.length > 0;
  const masked = !isFull(prefs.mask);
  const screenAdvice = companionScreen
    ? sourceAdvice(companionScreen, model.companion)
    : null;
  const companionCanCapture =
    companionScreen?.selected === true &&
    companionScreen.health === "receiving" &&
    support.supported !== false;
  // Why the companion cannot be asked, from the source's own advice.
  const companionReason =
    support.supported === false
      ? CAPTURE_UPDATE_LINE
      : (screenAdvice?.reason ??
        "The companion’s screen source isn’t available.");

  // Capture & analyze: a FRESH frame of the shared source (cropped to the
  // region in this browser), or the companion's newest capture.
  async function analyze(choice: AnalyzeChoice, via: AnalyzeVia) {
    setNote(null);
    // The session this capture was asked for: its outcome is shown only while
    // that is still the one on screen.
    const origin = sessionNow.current;
    const here = () => sessionNow.current === origin;
    const attach =
      choice.kind === "attach" && selected
        ? { taskId: selected.taskId, revision: selected.currentRevision }
        : undefined;
    if (via === "focused") {
      const sent = await companionCapture.start({
        mode: "focused-window",
        target: attach,
        ...hints,
      });
      if (!sent.ok && here()) fail(sent.code);
      return;
    }
    if (via === "region") {
      setDisplayMask(choice);
      return;
    }
    if (via === "companion") {
      // [SAFETY] Only an explicit stored capture, by the identity shown in the
      // menu. A failed fresh capture never reaches this branch.
      if (!stored) return;
      const result = await actions.analyzeLatestCapture(attach, hints, {
        sourceId: stored.sourceId,
        eventId: stored.eventId,
      });
      if (!result.ok && here()) fail(result.code);
      return;
    }
    await shareCapture(attach, undefined, here);
  }
  // A fresh frame of the shared source, cropped to the owner's region here, then
  // sent through the capture route. `label` names an automatic capture; true
  // when the frame was sent.
  async function shareCapture(
    attach: { taskId: string; revision: number } | undefined,
    label?: string,
    here: () => boolean = () => true,
  ): Promise<boolean> {
    setGrabbing(true);
    try {
      const frame = await share.grab(prefs.mask);
      if (!here()) return false;
      // The frame is taken: from here the card is sending it, not capturing.
      setGrabbing(false);
      setFlash({
        url:
          typeof URL.createObjectURL === "function"
            ? URL.createObjectURL(frame.blob)
            : null,
        width: frame.width,
        height: frame.height,
        bytes: frame.blob.size,
      });
      const result = await actions.analyzeCapture({
        image: frame.blob,
        label: label ?? frame.label,
        target: attach,
        ...hints,
      });
      if (!result.ok && here()) fail(result.code);
      return result.ok;
    } catch (error) {
      if (!here()) return false;
      if (error instanceof FrameError && error.code === "display-changed") {
        // The stored area belonged to another display: drop it, ask again.
        prefs.setMask(FULL);
        setNote(
          "Your display changed, so the capture area was cleared. Choose the area again.",
        );
        return false;
      }
      setNote(
        error instanceof FrameError && error.code === "too-large"
          ? "That frame is too large to send. Choose a smaller region."
          : error instanceof FrameError && error.code === "not-ready"
            ? "The shared source isn’t ready yet. Try again in a moment."
            : "Couldn’t capture the shared source. Share it again.",
      );
      return false;
    } finally {
      setGrabbing(false);
    }
  }
  // Auto: the screen changed and settled. The same fresh capture a press takes,
  // as a new task, named in the transcript as automatic.
  async function autoCapture(): Promise<boolean> {
    const origin = sessionNow.current;
    const sent = await shareCapture(undefined, AUTO_CAPTURE_LABEL, () => {
      return sessionNow.current === origin;
    });
    if (sent) addEntry("Auto", AUTO_CAPTURE_LABEL);
    return sent;
  }
  // Alt+Shift+A and the bar's capture button: analyze the shared source as a
  // new task, or choose a source first.
  function captureNow() {
    if (deviceOnly) {
      setNote(DEVICE_ONLY_ANALYZE);
      return;
    }
    if (share.status === "sharing") void analyze({ kind: "new" }, "share");
    else setCaptureMenu(true);
  }
  async function startSharing() {
    // Straight from the click: the browser needs the user gesture.
    await share.start();
  }
  async function send(text: string) {
    setNote(null);
    const origin = sessionNow.current;
    const result = await actions.submitFollowUp(text, hints);
    if (origin !== sessionNow.current) return result;
    if (result.ok) addEntry("Typed", text.trim());
    else fail(result.code);
    return result;
  }
  function onShortcut(event: React.KeyboardEvent) {
    const shortcut = shortcutOf(event);
    if (!shortcut) return;
    event.preventDefault();
    if (shortcut === "analyze")
      void claimCaptureTrigger().then((granted) => {
        if (granted) captureNow();
      });
    else if (shortcut === "dictate") auto.toggleListening();
    else if (shortcut === "mask") setMaskOpen(true);
    else setSettingsOpen(true);
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
      {open && (
        <CommandBar
          status={
            !open
              ? "ended"
              : dictation.state === "listening"
                ? "listening"
                : phase !== null
                  ? "capturing"
                  : paused
                    ? "paused"
                    : "ready"
          }
          dictation={dictation.state}
          skill={prefs.settings.skill}
          sharing={share.status === "sharing"}
          onCapture={captureNow}
          onDictate={auto.toggleListening}
          onSettings={() => setSettingsOpen(true)}
          auto={{
            on: auto.on,
            mic: auto.mic,
            onToggle: () => auto.setOn(!auto.on),
          }}
        />
      )}
      {open && announced && (
        <p className="ov-auto ok" role="status" data-testid="hands-free-on">
          {announced}
        </p>
      )}
      {open && auto.line && (
        <AutoStatus line={auto.line} onStop={() => auto.setOn(false)} />
      )}
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
                              run: () => setCaptureMenu(true),
                            }
                          : source === "microphone"
                            ? {
                                label: "Dictate in this browser",
                                run: auto.toggleListening,
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
          <CaptureStrip
            share={{
              status: share.status,
              kind: share.kind,
              stream: share.stream,
            }}
            masked={masked}
            last={capture}
            companionReady={companionReady}
            stored={stored}
            companionCanCapture={companionCanCapture}
            companionReason={companionReason}
            progress={companionCapture.progress}
            attachTo={
              selected
                ? { label: `T${number} rev ${selected.currentRevision}` }
                : null
            }
            nextTaskLabel={`T${tasks.length + 1}`}
            deviceOnly={deviceOnly}
            phase={phase}
            flash={flash}
            unavailable={unavailable}
            menuOpen={captureMenu}
            onMenuOpenChange={setCaptureMenu}
            onShare={() => void startSharing()}
            onStop={share.stop}
            onEditMask={() => setMaskOpen(true)}
            onAnalyze={(choice, via) => void analyze(choice, via)}
          />
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
          {(note ?? share.message ?? dictation.error) && (
            <p className="ov-note" role="alert">
              {note === failureNote("unavailable")
                ? UNAVAILABLE_NOTE
                : (note ?? share.message ?? dictation.error)}
            </p>
          )}
          <ChatLog
            rows={chatRows(model, entries)}
            activity={
              phase === "capturing"
                ? "Capturing…"
                : phase === "analyzing" || working
                  ? "Analyzing…"
                  : null
            }
          />
          {dictation.state === "listening" && (
            <ListeningHint
              level={dictation.level}
              heardNothing={dictation.heardNothing}
              heard={dictation.heard}
            />
          )}
          <FollowUp
            label={followLabel}
            value={followText}
            interim={dictation.interim}
            onChange={(text) => {
              // Typing over words that are still settling takes them as typed.
              if (dictation.interim) dictation.clearInterim();
              setFollowText(text);
            }}
            disabled={unavailable}
            sending={pending.includes("follow-up")}
            onSend={send}
          />
          <Footer
            paused={paused}
            pending={pending}
            actions={actions}
            onFailure={fail}
          />
        </Fragment>
      )}
      {maskOpen && (
        <MaskEditor
          stream={share.stream}
          initial={prefs.mask}
          onSave={(rect) => {
            prefs.setMask(rect);
            setMaskOpen(false);
          }}
          onClose={() => setMaskOpen(false)}
        />
      )}
      {displayMask && (
        <MaskEditor
          variant="display"
          stream={null}
          initial={prefs.displayMask}
          onSave={(rect) => {
            const choice = displayMask;
            prefs.setDisplayMask(rect);
            setDisplayMask(null);
            const attach =
              choice.kind === "attach" && selected
                ? {
                    taskId: selected.taskId,
                    revision: selected.currentRevision,
                  }
                : undefined;
            if (support.supported === false) {
              setNote(CAPTURE_UPDATE_LINE);
              return;
            }
            if (!support.selection) {
              setNote(
                "The companion hasn’t said which screen it is capturing yet. Check it is running with a screen source selected, then draw the region again.",
              );
              return;
            }
            void companionCapture
              .start({
                mode: "region",
                region: toDisplayRegion(rect),
                selection: support.selection ?? undefined,
                target: attach,
                ...hints,
              })
              .then((sent) => {
                if (!sent.ok) fail(sent.code);
              });
          }}
          onClose={() => setDisplayMask(null)}
        />
      )}
      {settingsOpen && (
        <SettingsPopover
          settings={prefs.settings}
          onChange={prefs.setSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
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
