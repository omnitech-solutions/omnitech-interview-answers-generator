// The one session implementation behind every panel (and the same stores the
// card uses): the session store (the server is the authority), the owner's
// capture prefs, and, in the ONE document that owns the microphone and the
// screen, hands-free Auto, dictation and captures. Other panels display that
// owner's state and ask it to act through the panel bus.
//
// [SAFETY] Nothing here hides a window or types into another app. A capture
// goes through the same owner capture route, with the owner's region, as the
// card's; a device-only session never sends one.
import {
  LIVE_OWNER_SKILL_LABELS,
  type LiveOwnerSkill,
  type PresentationHost,
} from "@omnitech/interview-contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nativeCaptureAvailable, onHostHotkey } from "../../host-adapter";
import { isOpenSession } from "../../session-deps";
import { useLiveSession } from "../../use-live-session";
import { loadAutoPreferred, saveAutoPreferred } from "../auto-prefs";
import { loadMask, loadSettings } from "../capture-prefs";
import { FrameError } from "../capture-source";
import { claimCaptureTrigger } from "../capture-trigger";
import { DEVICE_ONLY_ANALYZE } from "../overlay-capture";
import { failureNote } from "../overlay-footer";
import type { ChatEntry } from "../overlay-model";
import { AUTO_CAPTURE_LABEL } from "../overlay-card";
import { phaseLabel } from "./toolbar-config";
import { useAutoMode } from "../use-auto-mode";
import { useCapturePrefs } from "../use-capture-prefs";
import { useCompanionCapture } from "../use-companion-capture";
import { useScreenShare } from "../use-screen-share";
import {
  type Command,
  claimCommand,
  commandOf,
  cycleSkill,
  DEFAULT_SKILL,
  INTENT_TARGET,
  intentOf,
} from "./commands";
import { openPanelBus, type PanelMessage, type PanelState } from "./panel-bus";
import type { PanelKind } from "./panel-kinds";
import type { SystemLine } from "./panel-model";
import { useOwnsSession } from "./panel-owner";
import { useInteractionMode } from "./presentation-host";
import { engineHost, engineLine, useEngine } from "./use-engine";

export const TOAST_MS = 3_000;
export const MAX_LINES = 40;

// The exact toast words (bottom-left, large white text, gone after ~3 s).
export type Toast = { key: number; title: string; detail: string };
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
    title: `Skill changed to - ${LIVE_OWNER_SKILL_LABELS[skill]}`,
    detail: "Look in the small tab above",
  }),
  skillCurrent: (skill: LiveOwnerSkill): Omit<Toast, "key"> => ({
    title: `Current Skill - ${LIVE_OWNER_SKILL_LABELS[skill]}`,
    detail: "Change Skill: Cmd + Arrow Up/Down (Only in interaction mode)",
  }),
};
export const RECORDING_LINE =
  "Recording in Progress. press Alt+R to stop recording.";
export const CLEARED_LINE = "Session memory has been cleared";

const OFF: PanelState = {
  auto: false,
  mic: "off",
  interim: "",
  sharing: false,
  phase: null,
};

// How long the app must stay idle before the transcript says it finished.
const FINISH_AFTER_MS = 1_500;

export function usePanelSession(
  panel: PanelKind,
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
  // System lines of the chat, and the time before which rows were cleared.
  const [system, setSystem] = useState<SystemLine[]>([]);
  const [clearedAt, setClearedAt] = useState(0);
  const toastSeq = useRef(0);
  const toast = useCallback((text: Omit<Toast, "key">) => {
    toastSeq.current += 1;
    const key = toastSeq.current;
    setToasts((now) => [...now.slice(-1), { key, ...text }]);
    setTimeout(
      () => setToasts((now) => now.filter((t) => t.key !== key)),
      TOAST_MS,
    );
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

  async function grabAndAnalyze(label?: string): Promise<boolean> {
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
      // Every capture is a new analysis that replaces the one on show. It is
      // never attached to the previous task: a heard question and a screen of
      // another problem would otherwise be merged into one answer.
      const result = await actions.analyzeCapture({
        image: frame.blob,
        label: label ?? frame.label,
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

  useEffect(() => {}, [owns, open, bus]);
  // Stop what is running now: the server cancels the in-flight work and does not
  // try it again, and the session stays open (the mic keeps listening). The panels
  // stop saying "Analyzing" at once, without waiting for the server.
  const [stopped, setStopped] = useState(false);
  const phaseRef = useRef<"capturing" | "analyzing" | null>(null);
  async function stopAnalysis(): Promise<void> {
    setStopped(true);
    setNote(null);
    const result = await actions.stopWork();
    if (!result.ok) return setNote(failureNote(result.code));
    addSystem("Analysis stopped.");
  }
  const press = useCallback(
    (command: "capture" | "toggle-mic") => {
      if (!owns) {
        bus.post({ type: "command", command });
        return;
      }
      if (command === "toggle-mic") auto.toggleListening();
      // While work is running the capture control is "Stop"; pressed again it
      // captures the screen as a new task.
      else if (phaseRef.current) void stopAnalysis();
      else void grabAndAnalyze();
    },
    // grabAndAnalyze and stopAnalysis read refs; auto.toggleListening is stable.
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
        case "panel.toggle": {
          const shown = presentation.openPanels().includes("analysis");
          const done = await (shown
            ? presentation.close("analysis")
            : presentation.open("analysis"));
          if (!done) setNote("This window can’t show other panels.");
          return;
        }
      }
    },
    [actions, presentation, prefs.setSettings, setAuto, toast],
  );
  const perPanelHost = useRef(false);
  perPanelHost.current = presentation.capabilities.includes("multi-panel");
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
      const intent = intentOf(hotkey);
      if (!intent) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (intent.kind === "skill") {
        // The shell holds no skill: one page writes it, the others follow
        // through storage, and each shows its own toast.
        void claimCommand("skill.next").then((granted) => {
          if (granted)
            prefs.setSettings({ ...settingsRef.current, skill: intent.skill });
        });
        return;
      }
      // Whichever document the shell delivered the key to runs it once (a Web Lock
      // dedupes a key several documents hear); a document that is not the owner
      // hands it to the owner over the panel bus (see `press`). Filtering by
      // "the panel it is for" dropped the key whenever the shell delivered it to a
      // different panel than the page expected.
      runOnce(intent.command);
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      removeHost();
    };
  }, [runOnce, panel, prefs.setSettings]);

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
  useEffect(() => {
    if (recording) addSystem(RECORDING_LINE);
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Typing -----------------------------------------------------------------
  const send = useCallback(
    async (text: string) => {
      setNote(null);
      const origin = sessionNow.current;
      const result = await actions.submitFollowUp(text, latest.current.hints);
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
  // transcript. Choosing only changes what is shown; the other task keeps running
  // unless they stop it. A new task takes over the view.
  const [pinned, setPinned] = useState<string | null>(null);
  const newest = tasks[tasks.length - 1];
  const selected = tasks.find((task) => task.taskId === pinned) ?? newest;
  const taskCount = tasks.length;
  useEffect(() => {
    if (taskCount >= 0) setPinned(null);
  }, [taskCount]);
  selectedRef.current = selected;
  // Capturing or analyzing, whichever document is doing it: shown before the
  // work finishes, from typed state (never from status text).
  // A stop hides the phase until the work has really wound down.
  useEffect(() => {
    if (!localPhase) setStopped(false);
  }, [localPhase]);
  const phase = stopped ? null : (localPhase ?? live.phase);
  phaseRef.current = phase;

  // The transcript keeps a line for each stage the app goes through, and one when
  // it finishes: "Analyzing…", "Solutioning…", "Finished · 42s".
  const loggedPhase = useRef<{ label: string; at: number } | null>(null);
  const stoppedRef = useRef(false);
  stoppedRef.current = stopped;
  const activityKey = model.activity.key;
  useEffect(() => {
    const label = phaseLabel(phase, activityKey);
    const was = loggedPhase.current;
    if (label) {
      if (label !== was?.label) {
        addSystem(`${label}…`);
        loggedPhase.current = { label, at: was?.at ?? Date.now() };
      }
      return;
    }
    if (!was) return;
    // The app can blink idle between stages (capture, then analysis); it has only
    // finished if it stays idle for a moment.
    const done = setTimeout(() => {
      if (!stoppedRef.current)
        addSystem(`Finished · ${Math.round((Date.now() - was.at) / 1000)}s`);
      loggedPhase.current = null;
    }, FINISH_AFTER_MS);
    return () => clearTimeout(done);
  }, [phase, activityKey, addSystem]);

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
    select: setPinned,
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
