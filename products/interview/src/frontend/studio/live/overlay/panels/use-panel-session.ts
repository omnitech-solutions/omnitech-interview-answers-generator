// The one session implementation behind every native window (and the same stores
// the card uses): the session store (the server is the authority), the owner's
// capture prefs, and, in the ONE document that owns the microphone and the
// screen, hands-free Auto, dictation and captures. Other windows display that
// owner's state and ask it to act through the panel bus.
//
// [SAFETY] Nothing here hides a window or types into another app. A capture
// goes through the same owner capture route, with the owner's region, as the
// card's; a device-only session never sends one.
import type {
  LiveOwnerSkill,
  PresentationHost,
} from "@omnitech/interview-contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  presentation as focus,
  usePresentation,
} from "../../focus-presentation";
import { nativeCaptureAvailable, onHostHotkey } from "../../host-adapter";
import { isOpenSession } from "../../session-deps";
import { SKILLS } from "../../shared/skills";
import { taskCardModel } from "../../shared/task-card-model";
import { resolveTarget, targetOf } from "../../shared/task-target";
import { useMissingContext } from "../../shared/use-missing-context";
import { useLiveSession } from "../../use-live-session";
import { loadAutoPreferred, saveAutoPreferred } from "../auto-prefs";
import { loadMask, loadSettings } from "../capture-prefs";
import { FrameError } from "../capture-source";
import { DEVICE_ONLY_ANALYZE } from "../overlay-capture";
import { failureNote } from "../overlay-footer";
import type { ChatEntry } from "../overlay-model";
import { useAutoMode } from "../use-auto-mode";
import { useCapturePrefs } from "../use-capture-prefs";
import { useCompanionCapture } from "../use-companion-capture";
import { AUTO_CAPTURE_LABEL } from "../use-hands-free";
import { useScreenShare } from "../use-screen-share";
import {
  type Command,
  claimCommand,
  commandOf,
  commandOfHotkey,
  cycleSkill,
  DEFAULT_SKILL,
  FOCUS_INPUT_EVENT,
} from "./commands";
import { openPanelBus, type PanelMessage, type PanelState } from "./panel-bus";
import { type SystemLine, taskMarkers } from "./panel-model";
import { type NativeWindowPage, useOwnsSession } from "./panel-owner";
import { useInteractionMode } from "./presentation-host";
import { autoLimits } from "./toolbar-config";
import { engineHost, engineLine, useEngine } from "./use-engine";

export const TOAST_MS = 3_000;
const MAX_LINES = 40;

// The exact toast words (bottom-left, large white text, gone after ~3 s).
export type Toast = { key: number; title: string; detail: string };
const skillLabel = (skill: LiveOwnerSkill): string =>
  SKILLS.find((option) => option.id === skill)?.label ?? skill;
export const TOAST_TEXT = {
  interaction: (on: boolean): Omit<Toast, "key"> => ({
    title: `Interaction Mode: ${on ? "ON" : "OFF"}`,
    detail: on
      ? "Green dot, Interact with window like scroll, copy, move"
      : "Red dot shows interaction mode is off",
  }),
  recording: (): Omit<Toast, "key"> => ({
    title: "Start/Stop Recording",
    detail: "option + R",
  }),
  skillChanged: (skill: LiveOwnerSkill): Omit<Toast, "key"> => ({
    title: `Skill changed to - ${skillLabel(skill)}`,
    detail: "",
  }),
  copied: (what: string): Omit<Toast, "key"> => ({
    title: `Copied ${what}`,
    detail: "",
  }),
  skillCurrent: (skill: LiveOwnerSkill): Omit<Toast, "key"> => ({
    title: `Current Skill - ${skillLabel(skill)}`,
    detail: "Change Skill: Cmd + Arrow Up/Down (Only in interaction mode)",
  }),
};
export const RECORDING_LINE =
  "Recording in Progress. press Alt+R to stop recording.";
const CLEARED_LINE = "Session memory has been cleared";

const OFF: PanelState = {
  auto: false,
  mic: "off",
  interim: "",
  sharing: false,
  phase: null,
};

export function usePanelSession(
  panel: NativeWindowPage,
  presentation: PresentationHost,
  // True while the analysis is on screen: Auto then watches the screen on an
  // interval and analyzes it when it changes. Off, captures wait for the hotkey.
  options: { watchScreen?: boolean } = {},
) {
  const { snapshot, actions, model } = useLiveSession();
  const tenant = snapshot.tenant;
  const session = snapshot.session;
  const sessionId = session?.id ?? null;
  const open = isOpenSession(session);
  const paused = session?.status === "paused";
  const deviceOnly = session?.processingPolicy === "device-only";
  const owns = useOwnsSession(panel, tenant);
  const prefs = useCapturePrefs(tenant);
  const share = useScreenShare();
  const companionCapture = useCompanionCapture(
    actions,
    sessionId,
    snapshot.actions.length,
  );
  const interaction = useInteractionMode(presentation);

  // ---- Lines, toasts, notes -------------------------------------------------
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [note, setNoteState] = useState<string | null>(null);
  const setNote = setNoteState;
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [grabbing, setGrabbing] = useState(false);
  const grabbingRef = useRef(false);
  grabbingRef.current = grabbing;
  // System lines of the chat, and the time before which rows were cleared.
  const [system, setSystem] = useState<SystemLine[]>([]);
  const [clearedAt, setClearedAt] = useState(0);
  const toastSeq = useRef(0);
  // Every toast's timer, so none fires after the window is gone.
  const toastTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);
  const toast = useCallback((text: Omit<Toast, "key">) => {
    toastSeq.current += 1;
    const key = toastSeq.current;
    setToasts((now) => [...now.slice(-1), { key, ...text }]);
    const timer = setTimeout(() => {
      toastTimers.current.delete(timer);
      setToasts((now) => now.filter((t) => t.key !== key));
    }, TOAST_MS);
    toastTimers.current.add(timer);
  }, []);
  const addSystem = useCallback((text: string) => {
    const at = Date.now();
    setSystem((now) =>
      [...now, { key: `sys-${at}-${now.length}`, text, at }].slice(-MAX_LINES),
    );
  }, []);
  const addLine = useCallback(
    (kind: ChatEntry["kind"], text: string, at = Date.now()) =>
      setEntries((now) =>
        [...now, { key: `${kind}-${at}-${now.length}`, kind, text, at }].slice(
          -MAX_LINES,
        ),
      ),
    [],
  );

  // Another session starts with none of this one's lines or draft.
  const lastSession = useRef(sessionId);
  useEffect(() => {
    if (lastSession.current === sessionId) return;
    lastSession.current = sessionId;
    setEntries([]);
    setSystem([]);
    setClearedAt(0);
    setDraft("");
    setNote(null);
  }, [sessionId]);

  // ---- The bus ----------------------------------------------------------------
  const bus = useMemo(() => openPanelBus(), []);
  const [mirror, setMirror] = useState<PanelState>(() => ({
    ...OFF,
    auto: loadAutoPreferred(tenant),
  }));

  // ---- Capturing (owner only) -------------------------------------------------
  // The skill shapes every answer; DSA until the person picks another.
  const skill = prefs.settings.skill ?? DEFAULT_SKILL;
  const hints = {
    skill,
    language: prefs.settings.language ?? ("auto" as const),
  };
  const latest = useRef({ hints, mask: prefs.mask, deviceOnly });
  latest.current = { hints, mask: prefs.mask, deviceOnly };
  const sessionNow = useRef(sessionId);
  sessionNow.current = sessionId;

  const capturing = useRef(false);
  // `attach`: the screen is more of the problem already on show (a second
  // screenshot after scrolling), not a new problem.
  async function grabAndAnalyze(
    label?: string,
    attach = false,
  ): Promise<boolean> {
    // One capture at a time: a second press (or Add screenshot) while the first
    // is still being grabbed or sent is the same request, never a second revision.
    if (capturing.current) return false;
    capturing.current = true;
    try {
      return await captureOnce(label, attach);
    } finally {
      capturing.current = false;
    }
  }
  async function captureOnce(label: string | undefined, attach: boolean) {
    const origin = sessionNow.current;
    const here = () => sessionNow.current === origin;
    // Show a refusal here AND in every other panel (the analysis panel is where
    // the person is looking, but the capture may run in the bar's document).
    const setNote = (text: string | null) => {
      setNoteState(text);
      if (text) bus.post({ type: "note", text });
    };
    setNote(null);
    setStopped(false);
    if (latest.current.deviceOnly) {
      setNote(DEVICE_ONLY_ANALYZE);
      return false;
    }
    // A native host captures without a gesture; a browser needs the person to
    // share a window first (Settings, on the panel that owns capture).
    if (share.status !== "sharing") {
      if (!nativeCaptureAvailable() || !(await share.start())) {
        setNote("Share a window, tab or screen first (Settings).");
        return false;
      }
    }
    setGrabbing(true);
    try {
      const frame = await share.grab(latest.current.mask);
      if (!here()) return false;
      // The frame is taken: from here it is sending (the analyze command is
      // pending), not capturing, and Stop has work to cancel.
      setGrabbing(false);
      // A capture is a new analysis that replaces the one on show, and is never
      // attached to the previous task by accident (a heard question and a screen
      // of another problem would be merged). Attaching is only ever asked for.
      const onShow = attach ? selectedRef.current : undefined;
      const result = await actions.analyzeCapture({
        image: frame.blob,
        label: label ?? (attach ? "Added screen" : frame.label),
        ...(onShow
          ? {
              target: {
                taskId: onShow.taskId,
                revision: onShow.currentRevision,
              },
            }
          : {}),
        ...latest.current.hints,
      });
      if (!result.ok && here()) setNote(failureNote(result.code));
      return result.ok;
    } catch (error) {
      // An automatic capture with no browser in front just waits for one.
      const quiet =
        label !== undefined &&
        error instanceof FrameError &&
        error.code === "no-focused-window";
      if (here() && !quiet)
        setNote(
          error instanceof FrameError && error.code === "display-changed"
            ? "Your display changed, so the capture area was cleared. Choose the area again."
            : error instanceof FrameError && error.code === "no-focused-window"
              ? "Capture only runs while Chrome or Safari is in front. Switch to your browser and press ⌘⇧S."
              : error instanceof FrameError &&
                  error.code === "permission-denied"
                ? "Screen Recording is off for this app. Turn on Interview Studio in System Settings → Privacy & Security → Screen & System Audio Recording, then reopen it."
                : "Couldn’t capture. Check the share and try again.",
        );
      return false;
    } finally {
      setGrabbing(false);
    }
  }
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // With a native engine the shell is the listener: the browser recogniser
  // stays off unless the engine refused to start.
  const [engineRefused, setEngineRefused] = useState(false);
  const engineListening = engineHost() !== null && !engineRefused;
  const auto = useAutoMode({
    engineListening,
    tenant,
    sessionId,
    // Only the owner listens and watches.
    open: owns && open,
    paused,
    deviceOnly,
    // Interval watching only while the analysis is showing and the session may
    // send the screen; otherwise captures happen on the capture hotkey only.
    wantsScreen:
      options.watchScreen === true &&
      (session?.captureSources.includes("screen") ?? false),
    sharing: share.status === "sharing",
    watchable: share.kind !== "This Mac" && share.kind !== null,
    sample: share.sample,
    mask: prefs.mask,
    busy: grabbing || snapshot.pending.includes("analyze"),
    capture: () => grabAndAnalyze(AUTO_CAPTURE_LABEL),
    submitHeard: actions.submitHeard,
    resume: actions.resume,
    onManualFinal: (phrase) => {
      // [SAFETY] With Auto on, heard speech is submitted on its own and the
      // follow-up box stays for typed text only.
      if (loadAutoPreferred(tenant)) return;
      // Dictated words go to the message box, not the log: they are sent (and
      // shown) once, when the person sends them, never twice.
      setDraft((text) =>
        text.trim() === "" ? phrase : `${text.trimEnd()} ${phrase}`,
      );
      bus.post({
        type: "line",
        sessionId: sessionNow.current,
        kind: "Dictated",
        text: phrase,
        at: Date.now(),
      });
    },
  });

  const working = [
    "drafting",
    "reading-coding-task",
    "coding-draft",
    "agent-working",
  ].includes(model.activity.key);
  const localPhase: "capturing" | "analyzing" | null = grabbing
    ? "capturing"
    : snapshot.pending.includes("analyze") ||
        companionCapture.progress?.phase === "asking" ||
        working
      ? "analyzing"
      : null;

  const engine = useEngine({
    sessionId,
    wanted: owns && open && auto.on,
    paused,
    // The shell listens (microphone, and the app's audio when the session has
    // it); the screen is captured on the capture command only.
    sources: [
      "microphone",
      ...(session?.captureSources.includes("application-audio")
        ? (["application-audio"] as const)
        : []),
    ],
  });
  useEffect(() => {
    setEngineRefused(engine.refused !== null);
  }, [engine.refused]);

  // What every panel shows: the owner's real state, or the owner's last report.
  const live: PanelState = owns
    ? {
        auto: auto.on,
        mic:
          engine.state?.sources.microphone === "permission-denied"
            ? ("denied" as const)
            : engine.listening &&
                engine.state?.sources.microphone === "listening"
              ? ("listening" as const)
              : auto.mic,
        interim: engine.state?.speech ?? auto.dictation.interim,
        sharing: share.status === "sharing",
        phase: localPhase,
      }
    : mirror;
  const liveRef = useRef(live);
  liveRef.current = live;

  // The owner reports its state when it changes and when a panel opens.
  const report = useCallback(
    () => owns && bus.post({ type: "state", state: liveRef.current }),
    [owns, bus],
  );
  useEffect(() => {
    report();
  }, [report, live.auto, live.mic, live.interim, live.sharing, live.phase]);

  // Stop what is running now: the server cancels the in-flight work and does not
  // try it again, and the session stays open (the mic keeps listening). The panels
  // stop saying "Analyzing" at once, without waiting for the server.
  const [stopped, setStopped] = useState(false);
  const phaseRef = useRef<"capturing" | "analyzing" | null>(null);
  async function stopAnalysis(): Promise<void> {
    // [GUARD] While the screen is still being taken there is nothing on the
    // server to stop, and hiding the phase would show "idle" for a capture that
    // is about to be sent.
    if (grabbingRef.current) return;
    setStopped(true);
    setNote(null);
    const result = await actions.stopWork();
    if (!result.ok) {
      // The work was not stopped: the panels keep saying what is running.
      setStopped(false);
      setNote(failureNote(result.code));
    }
  }
  const press = useCallback(
    (command: "capture" | "attach" | "toggle-mic") => {
      if (!owns) {
        bus.post({ type: "command", command });
        return;
      }
      if (command === "toggle-mic") auto.toggleListening();
      // Adding a screen to the problem on show never stops the work in flight.
      else if (command === "attach") void grabAndAnalyze(undefined, true);
      // While work is running the capture control is "Stop"; pressed again it
      // captures the screen as a new task.
      else if (phaseRef.current) void stopAnalysis();
      else void grabAndAnalyze();
    },
    // grabAndAnalyze reads share.status from the render that made this callback
    // (benign: share.start() is idempotent) and the rest through refs;
    // stopAnalysis reads refs; auto.toggleListening is stable.
    [owns, bus, auto.toggleListening],
  );
  const pressRef = useRef(press);
  pressRef.current = press;

  useEffect(() => {
    bus.post({ type: "hello" });
    return bus.listen((message: PanelMessage) => {
      if (message.type === "state") {
        if (!ownsRef.current) setMirror(message.state);
      } else if (message.type === "hello") {
        if (ownsRef.current)
          bus.post({ type: "state", state: liveRef.current });
      } else if (message.type === "command") {
        if (ownsRef.current && open_.current) pressRef.current(message.command);
      } else if (message.type === "clear") {
        if (message.sessionId === sessionNow.current) clearMemory(false);
      } else if (message.type === "note") {
        setNote(message.text);
      } else if (message.type === "session") {
        // Handled by the auto-session hook of this document.
      } else if (message.sessionId === sessionNow.current) {
        if (message.kind === "Dictated")
          setDraft((text) =>
            text.trim() === ""
              ? message.text
              : `${text.trimEnd()} ${message.text}`,
          );
        else addLine(message.kind, message.text, message.at);
      }
    });
  }, [bus, addLine]);
  const ownsRef = useRef(owns);
  ownsRef.current = owns;
  const open_ = useRef(open);
  open_.current = open;

  // Settings, the region and the Auto preference changed in another panel.
  const autoRef = useRef(auto);
  autoRef.current = auto;
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

  function clearMemory(announce: boolean) {
    setEntries([]);
    setSystem([]);
    setClearedAt(Date.now());
    setDraft("");
    setNote(null);
    addSystem(CLEARED_LINE);
    if (announce) bus.post({ type: "clear", sessionId: sessionNow.current });
  }

  // ---- Commands -----------------------------------------------------------------
  // Every command, from the in-page keymap or a host hotkey, runs here once.
  const interactionRef = useRef(interaction);
  interactionRef.current = interaction;
  const settingsRef = useRef(prefs.settings);
  settingsRef.current = prefs.settings;
  const selectedRef = useRef<typeof selected>(undefined);
  const run = useCallback(
    async (command: Command) => {
      if (!open_.current) return;
      switch (command) {
        case "auto.toggle":
          setAuto(!liveRef.current.auto);
          return;
        case "capture.analyze":
          pressRef.current("capture");
          return;
        case "transcribe.toggle":
          pressRef.current("toggle-mic");
          return;
        case "solution.generate": {
          const task = selectedRef.current;
          if (!task || task.kind !== "programming-challenge") {
            setNote("There is no coding problem to solve yet.");
            return;
          }
          setNote(null);
          const result = await actions.solveTask(
            { taskId: task.taskId, revision: task.currentRevision },
            latest.current.hints,
          );
          if (!result.ok) setNote(failureNote(result.code));
          return;
        }
        case "skill.next":
        case "skill.prev": {
          // Skills change only in interaction mode; otherwise this says which
          // one is current.
          const current = settingsRef.current.skill ?? DEFAULT_SKILL;
          if (interactionRef.current === false) {
            toast(TOAST_TEXT.skillCurrent(current));
            return;
          }
          prefs.setSettings({
            ...settingsRef.current,
            skill: cycleSkill(current, command === "skill.next" ? 1 : -1),
          });
          return;
        }
        case "session.clear":
          clearMemory(true);
          return;
        case "chat.focus":
          window.dispatchEvent(new Event(FOCUS_INPUT_EVENT));
          return;
      }
    },
    [actions, prefs.setSettings, setAuto, toast],
  );
  const runRef = useRef(run);
  runRef.current = run;
  const runOnce = useCallback((command: Command) => {
    void claimCommand(command).then((granted) => {
      if (granted) void runRef.current(command);
    });
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const command = commandOf(event);
      if (!command) return;
      event.preventDefault();
      runOnce(command);
    };
    window.addEventListener("keydown", onKey);
    const removeHost = onHostHotkey((hotkey) => {
      const command = commandOfHotkey(hotkey);
      if (!command) return;
      if (typeof document !== "undefined" && document.hidden) return;
      // Whichever document the shell delivered the key to runs it once (a Web Lock
      // dedupes a key several documents hear); a document that is not the owner
      // hands it to the owner over the panel bus (see `press`). Filtering by
      // "the panel it is for" dropped the key whenever the shell delivered it to a
      // different panel than the page expected.
      runOnce(command);
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      removeHost();
    };
  }, [runOnce]);

  // ---- Toasts for changes -------------------------------------------------------
  const lastSkill = useRef<LiveOwnerSkill>(skill);
  useEffect(() => {
    if (lastSkill.current === skill) return;
    lastSkill.current = skill;
    toast(TOAST_TEXT.skillChanged(skill));
  }, [skill, toast]);
  const lastMode = useRef(interaction);
  useEffect(() => {
    if (lastMode.current === interaction) return;
    lastMode.current = interaction;
    if (interaction !== null) toast(TOAST_TEXT.interaction(interaction));
  }, [interaction, toast]);
  // Recording starts or stops (here or in the owner's document): the toast and,
  // when it starts, the chat's system line.
  const recording = live.mic === "listening";
  const lastRecording = useRef(recording);
  useEffect(() => {
    if (lastRecording.current === recording) return;
    lastRecording.current = recording;
    toast(TOAST_TEXT.recording());
    if (recording) addSystem(RECORDING_LINE);
  }, [recording, toast, addSystem]);
  // A session that is already recording when this panel opens says so once.
  const recordingOnOpen = useRef(recording);
  useEffect(() => {
    if (recordingOnOpen.current) addSystem(RECORDING_LINE);
  }, [addSystem]);

  // ---- Typing -----------------------------------------------------------------
  const send = useCallback(
    async (text: string) => {
      setNote(null);
      const origin = sessionNow.current;
      const result = await actions.submitFollowUp(
        text,
        targetOf(selectedRef.current),
        latest.current.hints,
      );
      if (origin !== sessionNow.current) return result;
      if (result.ok) {
        const at = Date.now();
        addLine("Typed", text.trim(), at);
        bus.post({
          type: "line",
          sessionId: origin,
          kind: "Typed",
          text: text.trim(),
          at,
        });
      } else setNote(failureNote(result.code));
      return result;
    },
    [actions, addLine, bus],
  );

  const tasks = model.tasks;
  // The task on show: the newest, unless the person chose another from the
  // transcript or the chips. The pin is the shared presentation's (the web page
  // reads the same one): a new task does not move it, and Back to now clears it.
  // Choosing only changes what is shown; the other task keeps running.
  const { pinnedTaskId: pinned } = usePresentation();
  const setPinned = focus.pin;
  const resolved = resolveTarget(tasks, pinned);
  const selected = resolved?.task;
  selectedRef.current = selected;
  // The one description of the task on show, shared with the web page; and the
  // lines between the conversation's own (a task starting, a task stopped).
  const card = useMemo(
    () =>
      taskCardModel({
        tasks,
        actions: snapshot.actions,
        observations: snapshot.observations,
        selectedTaskId: pinned,
        deviceOnly,
      }),
    [tasks, snapshot.actions, snapshot.observations, pinned, deviceOnly],
  );
  const markers = useMemo(
    () =>
      taskMarkers({
        tasks,
        actions: snapshot.actions,
        observations: snapshot.observations,
        deviceOnly,
      }),
    [tasks, snapshot.actions, snapshot.observations, deviceOnly],
  );
  const setSkill = useCallback(
    (next: LiveOwnerSkill) =>
      prefs.setSettings({ ...settingsRef.current, skill: next }),
    [prefs.setSettings],
  );
  // Auto's own numbers, for the strip and the capture menu: the interval in
  // force and the per-session limit, from the one Auto config.
  const autoNow = {
    on: live.auto,
    line: auto.line,
    limits: autoLimits(auto.intervalSec),
    // Auto is only watching the screen while the analysis shows, a screen is
    // wanted and the session may send it.
    watching:
      options.watchScreen === true &&
      live.auto &&
      !deviceOnly &&
      (session?.captureSources.includes("screen") ?? false),
  };

  // What the model says it could not see for the task on show, until the person
  // says the problem looks complete (kept per session, task and revision).
  const { missing, dismiss: dismissMissing } = useMissingContext(
    sessionId,
    card,
  );
  // Capturing or analyzing, whichever document is doing it: shown before the
  // work finishes, from typed state (never from status text).
  // A stop hides the phase until the work has really wound down.
  useEffect(() => {
    if (!localPhase) setStopped(false);
  }, [localPhase]);
  const phase = stopped ? null : (localPhase ?? live.phase);
  phaseRef.current = phase;

  return {
    snapshot,
    actions,
    model,
    session,
    open,
    paused,
    deviceOnly,
    tenant,
    owns,
    prefs,
    share,
    live,
    interaction,
    entries,
    system,
    clearedAt,
    skill,
    draft,
    setDraft,
    note,
    notify: setNote,
    toasts,
    selected,
    card,
    markers,
    // The task a follow-up or an added screen is about, with its label ("T2").
    target: resolved,
    select: setPinned,
    setSkill,
    stop: stopAnalysis,
    auto: autoNow,
    missing,
    dismissMissing,
    phase,
    press,
    setAuto,
    send,
    toast,
    run: runOnce,
    engine,
    engineLine: engineLine(engine),
    dictationError: owns ? auto.dictation.error : null,
    dictationSupported: auto.dictation.supported,
    engineAvailable: engineListening,
  };
}
