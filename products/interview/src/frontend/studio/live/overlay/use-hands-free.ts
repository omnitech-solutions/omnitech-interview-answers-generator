// The hands-free controller: everything the overlay card and the Studio live
// view's hands-free band share, written once. It owns the screen share, the
// owner's capture prefs, hands-free Auto (listening and watching), the capture
// and follow-up actions and the lines they leave. It renders nothing.
//
// [SAFETY] Exactly ONE document owns the microphone, the screen and Auto, across
// the Studio view, the card, the Picture-in-Picture window and the panels: a Web
// Lock (panels/panel-owner.ts) that every one of them asks for. A document that
// does not own mirrors the owner's state over the panel bus and asks it to act
// there; it never listens or watches itself. A document runs ONE controller:
// the Studio shell provides it (hands-free-context.tsx) and the card inside the
// page reuses it.

import { useCallback, useEffect, useRef, useState } from "react";
import { captureRequestSupport } from "../companion-capability";
import { usePresentation } from "../focus-presentation";
import { nativeCaptureAvailable } from "../host-adapter";
import type { SessionErrorCode } from "../session-client";
import { isOpenSession } from "../session-deps";
import { isRunInFlight } from "../session-runs";
import { copyText } from "../shared/copy-text";
import { selectedTask, type TaskTarget, targetOf } from "../shared/task-target";
import { useCompanionCapability } from "../use-companion-capability";
import { useLiveSession } from "../use-live-session";
import { loadAutoPreferred, saveAutoPreferred } from "./auto-prefs";
import { loadMask, loadSettings } from "./capture-prefs";
import { FrameError } from "./capture-source";
import { FULL } from "./mask-geometry";
import {
  type AnalyzeChoice,
  type AnalyzeVia,
  DEVICE_ONLY_ANALYZE,
} from "./overlay-capture";
import { failureNote } from "./overlay-footer";
import { type ChatEntry, captureList } from "./overlay-model";
import {
  openPanelBus,
  type PanelBus,
  type PanelMessage,
  type PanelState,
} from "./panels/panel-bus";
import { type OwnerKind, useOwnsSession } from "./panels/panel-owner";
import { engineHost, useEngine } from "./panels/use-engine";
import { takeAnnouncement } from "./share-handoff";
import { useAutoMode } from "./use-auto-mode";
import { useCapturePrefs } from "./use-capture-prefs";
import { useCompanionCapture } from "./use-companion-capture";
import { useHostHotkeys } from "./use-host-hotkeys";
import { useScreenShare } from "./use-screen-share";

// What an automatic capture is called in the transcript and Activity.
export const AUTO_CAPTURE_LABEL = "Auto-captured · screen changed";
const ANNOUNCE_MS = 8_000;
// How long the "Captured" preview stays.
const FLASH_MS = 2_500;
const CAPABILITY_REFRESH_MS = 10_000;

export type CaptureFlash = {
  url: string | null;
  width: number;
  height: number;
  bytes: number;
};

export type HandsFree = ReturnType<typeof useHandsFree>;

export function useHandsFree(kind: OwnerKind) {
  const { snapshot, actions, model } = useLiveSession();
  const { pinnedTaskId } = usePresentation();
  const tenant = snapshot.tenant;
  const session = snapshot.session;
  const sessionKey = session?.id ?? null;
  const open = isOpenSession(session);
  const paused = session?.status === "paused";
  const deviceOnly = session?.processingPolicy === "device-only";
  const pending = snapshot.pending;
  const owns = useOwnsSession(kind, tenant, undefined, open);
  const prefs = useCapturePrefs(tenant);
  // A share from "Start hands-free" is adopted once a session is open here.
  const share = useScreenShare(open);

  const [captureMenu, setCaptureMenu] = useState(false);
  const [maskOpen, setMaskOpen] = useState(false);
  // The companion's region editor (relative to the main display), and the choice
  // (new task or attach) it will capture for.
  const [displayMask, setDisplayMask] = useState<AnalyzeChoice | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  // The frame that was just taken, shown for a moment so it is clear it worked.
  const [flash, setFlash] = useState<CaptureFlash | null>(null);
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
  const addEntry = useCallback((entryKind: ChatEntry["kind"], text: string) => {
    setEntries((current) =>
      [
        ...current,
        {
          key: `${entryKind}-${Date.now()}-${current.length}`,
          kind: entryKind,
          text,
          at: Date.now(),
        },
      ].slice(-20),
    );
  }, []);
  const companionCapture = useCompanionCapture(
    actions,
    sessionKey,
    snapshot.actions.length,
  );
  const capability = useCompanionCapability(CAPABILITY_REFRESH_MS, open);
  const support = captureRequestSupport(
    capability.status === "ready" ? capability.capability : null,
  );

  // Which task a capture attaches to, and the hints every call carries. An
  // unset hint is sent as "auto": it resets an earlier hint, where omitting it
  // would keep it.
  const tasks = model.tasks;
  const newest = tasks[tasks.length - 1];
  const selected = selectedTask(tasks, pinnedTaskId);
  const hints = {
    skill: prefs.settings.skill ?? ("auto" as const),
    language: prefs.settings.language ?? ("auto" as const),
  };
  const captures = captureList(snapshot.observations, model.serverNowMs);
  const sessionNow = useRef(sessionKey);
  sessionNow.current = sessionKey;

  const fail = useCallback((code: SessionErrorCode) => {
    if (code === "unavailable") setUnavailable(true);
    setNote(failureNote(code));
  }, []);
  const copy = useCallback(async (text: string) => {
    setNote(
      (await copyText(text))
        ? null
        : "Couldn’t copy. Select the text and copy it yourself.",
    );
  }, []);

  // ---- Capturing --------------------------------------------------------------
  const capturing = useRef(false);
  // A fresh frame of the shared source, cropped to the owner's region here, then
  // sent through the capture route. `label` names an automatic capture; true
  // when the frame was sent.
  async function shareCapture(
    attach: TaskTarget | undefined,
    label?: string,
    here: () => boolean = () => true,
  ): Promise<boolean> {
    // One capture at a time: a second press (or Attach) while the first is
    // still being grabbed or sent is the same request, never a second revision.
    if (capturing.current) return false;
    capturing.current = true;
    try {
      return await grabAndSend(attach, label, here);
    } finally {
      capturing.current = false;
    }
  }
  async function grabAndSend(
    attach: TaskTarget | undefined,
    label: string | undefined,
    here: () => boolean,
  ): Promise<boolean> {
    setGrabbing(true);
    try {
      const frame = await share.grab(prefs.mask);
      if (!here()) return false;
      // The frame is taken: from here it is sending, not capturing.
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
  // Capture & analyze: a FRESH frame of the shared source, or the companion's.
  async function analyze(choice: AnalyzeChoice, via: AnalyzeVia) {
    setNote(null);
    // The session this capture was asked for: its outcome is shown only while
    // that is still the one on screen.
    const origin = sessionNow.current;
    const here = () => sessionNow.current === origin;
    const attach =
      choice.kind === "attach" ? (targetOf(selected) ?? undefined) : undefined;
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
      const stored = captures[captures.length - 1] ?? null;
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
  // Auto: the screen changed and settled. The same fresh capture a press takes,
  // as a new task, named in the transcript as automatic.
  async function autoCapture(): Promise<boolean> {
    const origin = sessionNow.current;
    // A native host captures without a gesture: its source starts itself.
    if (share.status !== "sharing" && nativeCaptureAvailable())
      if (!(await share.start())) return false;
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
  // Stop what is running now (session-wide stop-work, ADR-0011): in-flight work
  // is cancelled and not retried, the session stays live, and the next analyze
  // opens a NEW task. Failure is a fixed line, never a silent no-op.
  async function stopAnalysis() {
    setNote(null);
    const origin = sessionNow.current;
    const result = await actions.stopWork();
    if (origin === sessionNow.current && !result.ok) fail(result.code);
    return result;
  }
  async function startSharing() {
    // Straight from the click: the browser needs the user gesture.
    await share.start();
  }
  async function send(text: string) {
    setNote(null);
    const origin = sessionNow.current;
    const result = await actions.submitFollowUp(
      text,
      targetOf(selected),
      hints,
    );
    if (origin !== sessionNow.current) return result;
    if (result.ok) addEntry("Typed", text.trim());
    else fail(result.code);
    return result;
  }

  // ---- Auto -------------------------------------------------------------------
  // With a native engine the shell is the listener (the web view has no speech
  // recogniser and would only raise its own microphone prompt): the browser
  // recogniser stays off unless the engine refused to start.
  const [engineRefused, setEngineRefused] = useState(false);
  const engineListening = engineHost() !== null && !engineRefused;
  const auto = useAutoMode({
    engineListening,
    tenant,
    sessionId: sessionKey,
    // Only the owner listens and watches.
    open: owns && open,
    paused,
    deviceOnly,
    wantsScreen: session?.captureSources.includes("screen") ?? false,
    sharing: share.status === "sharing",
    watchable: share.kind !== "This Mac" && share.kind !== null,
    sample: share.sample,
    mask: prefs.mask,
    busy:
      grabbing ||
      pending.includes("analyze") ||
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
  const engine = useEngine({
    sessionId: sessionKey,
    wanted: owns && open && auto.on,
    paused,
    sources: [
      "microphone",
      ...(!deviceOnly && (session?.captureSources.includes("screen") ?? false)
        ? (["screen"] as const)
        : []),
    ],
  });
  useEffect(() => {
    setEngineRefused(engine.refused !== null);
  }, [engine.refused]);
  // The shell mounts this before any session exists. Setup's "Start hands-free"
  // (or another window) turns the preference on in the meantime, so it is read
  // again when a session opens here.
  useEffect(() => {
    if (!open) return;
    const wanted = loadAutoPreferred(tenant);
    if (auto.on !== wanted) auto.setOn(wanted);
    // Only when a session opens: toggling Auto by hand is not undone.
  }, [open, tenant]);
  // "Hands-free is on." from Start hands-free, shown for a few seconds once the
  // session is open here.
  const [announced, setAnnounced] = useState<string | null>(null);
  useEffect(() => {
    if (open) setAnnounced((now) => now ?? takeAnnouncement());
  }, [open]);
  useEffect(() => {
    if (!announced) return;
    const timer = setTimeout(() => setAnnounced(null), ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [announced]);
  // Text typed or dictated for one session is never sent to another.
  const lastKey = useRef(sessionKey);
  useEffect(() => {
    if (lastKey.current === sessionKey) return;
    lastKey.current = sessionKey;
    setFollowText("");
    setNote(null);
  }, [sessionKey]);

  // ---- One owner, the rest mirror -----------------------------------------------
  // Work is running for the session: the capture control offers Stop instead
  // of Analyze. Taking and sending the frame is shown as "Capturing…" and
  // "Analyzing…" until the server has started the work.
  const working = tasks.some((task) => task.current.runs.some(isRunInFlight));
  const stopping = pending.includes("stop-work");
  const phase: "capturing" | "analyzing" | null = grabbing
    ? "capturing"
    : pending.includes("analyze")
      ? "analyzing"
      : null;
  const [mirror, setMirror] = useState<PanelState>(() => ({
    auto: loadAutoPreferred(tenant),
    mic: "off",
    interim: "",
    sharing: false,
    phase: null,
  }));
  const live: PanelState = owns
    ? {
        auto: auto.on,
        mic: auto.mic,
        interim: auto.dictation.interim,
        sharing: share.status === "sharing",
        phase,
      }
    : mirror;
  const liveRef = useRef(live);
  liveRef.current = live;
  const ownsRef = useRef(owns);
  ownsRef.current = owns;
  const openRef = useRef(open);
  openRef.current = open;
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const captureRef = useRef(captureNow);
  captureRef.current = captureNow;

  // The owner reports its state when it changes and when another document opens.
  useEffect(() => {
    if (owns && open)
      busRef.current?.post({ type: "state", state: liveRef.current });
  }, [owns, open, live.auto, live.mic, live.interim, live.sharing, live.phase]);
  // The channel is opened and closed with the effect (a re-run opens a new one).
  const busRef = useRef<PanelBus | null>(null);
  useEffect(() => {
    const bus = openPanelBus();
    busRef.current = bus;
    bus.post({ type: "hello" });
    const stop = bus.listen((message: PanelMessage) => {
      if (message.type === "state") {
        if (!ownsRef.current) setMirror(message.state);
      } else if (message.type === "hello") {
        if (ownsRef.current && openRef.current)
          bus.post({ type: "state", state: liveRef.current });
      } else if (message.type === "command") {
        if (!ownsRef.current || !openRef.current) return;
        if (message.command === "toggle-mic") autoRef.current.toggleListening();
        else captureRef.current();
      }
    });
    return () => {
      busRef.current = null;
      stop();
    };
  }, []);
  // Settings, the region and the Auto preference changed in another document.
  useEffect(() => {
    const onStorage = () => {
      prefs.setMask(loadMask(tenant));
      prefs.setSettings(loadSettings(tenant));
      const wanted = loadAutoPreferred(tenant);
      if (ownsRef.current) {
        if (autoRef.current.on !== wanted) autoRef.current.setOn(wanted);
      } else setMirror((now) => ({ ...now, auto: wanted }));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [tenant, prefs.setMask, prefs.setSettings]);
  const setAuto = useCallback(
    (on: boolean) => {
      saveAutoPreferred(tenant, on);
      if (ownsRef.current) autoRef.current.setOn(on);
      else setMirror((now) => ({ ...now, auto: on }));
    },
    [tenant],
  );
  // A press in a document that does not own the microphone asks the owner.
  const press = useCallback((command: "capture" | "toggle-mic") => {
    if (!ownsRef.current) busRef.current?.post({ type: "command", command });
    else if (command === "toggle-mic") autoRef.current.toggleListening();
    else captureRef.current();
  }, []);
  // The host's system-wide key: only the owner acts, so one press is one capture.
  useHostHotkeys(() => {
    if (ownsRef.current) captureRef.current();
  });

  // The cards showing this controller: while one is up it hosts the dialogs and
  // the capture menu, so the band does not show a second copy.
  const [cards, setCards] = useState(0);
  const attachCard = useCallback(() => {
    setCards((count) => count + 1);
    return () => setCards((count) => count - 1);
  }, []);

  return {
    snapshot,
    actions,
    model,
    session,
    tenant,
    open,
    paused,
    deviceOnly,
    pending,
    owns,
    prefs,
    share,
    auto,
    live,
    setAuto,
    press,
    // Selection and what a capture needs.
    tasks,
    newest,
    selected,
    captures,
    capability,
    support,
    companionCapture,
    // What the capture strip and the follow-up box show and do.
    phase,
    flash,
    unavailable,
    note,
    setNote,
    fail,
    copy,
    followText,
    setFollowText,
    entries,
    announced,
    captureMenu,
    setCaptureMenu,
    maskOpen,
    setMaskOpen,
    displayMask,
    setDisplayMask,
    settingsOpen,
    setSettingsOpen,
    analyze,
    captureNow,
    working,
    stopping,
    stopAnalysis,
    startSharing,
    send,
    cardAttached: cards > 0,
    attachCard,
    hints,
  };
}
