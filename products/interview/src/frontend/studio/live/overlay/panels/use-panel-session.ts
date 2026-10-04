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
import { latestTarget } from "../../session-owner-input";
import { useLiveSession } from "../../use-live-session";
import { loadAutoPreferred, saveAutoPreferred } from "../auto-prefs";
import { loadMask, loadSettings } from "../capture-prefs";
import { FrameError } from "../capture-source";
import { claimCaptureTrigger } from "../capture-trigger";
import { DEVICE_ONLY_ANALYZE } from "../overlay-capture";
import { failureNote } from "../overlay-footer";
import type { ChatEntry } from "../overlay-model";
import { useAutoMode } from "../use-auto-mode";
import { useCapturePrefs } from "../use-capture-prefs";
import { useCompanionCapture } from "../use-companion-capture";
import { useScreenShare } from "../use-screen-share";
import {
  type Command,
  claimCommand,
  commandOf,
  cycleSkill,
  INTENT_TARGET,
  intentOf,
} from "./commands";
import { openPanelBus, type PanelMessage, type PanelState } from "./panel-bus";
import type { PanelKind } from "./panel-kinds";
import { useOwnsSession } from "./panel-owner";
import { useInteractionMode } from "./presentation-host";
import { engineHost, engineLine, useEngine } from "./use-engine";

export const AUTO_CAPTURE_LABEL = "Auto-captured · screen changed";
export const TOAST_MS = 3_000;
export const MAX_LINES = 40;

export type Toast = { key: number; text: string };

const OFF: PanelState = {
  auto: false,
  mic: "off",
  interim: "",
  sharing: false,
  phase: null,
};

export function usePanelSession(
  panel: PanelKind,
  presentation: PresentationHost,
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
  const [note, setNote] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [grabbing, setGrabbing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const toastSeq = useRef(0);
  const toast = useCallback((text: string) => {
    toastSeq.current += 1;
    const key = toastSeq.current;
    setToasts((now) => [...now.slice(-2), { key, text }]);
    setTimeout(
      () => setToasts((now) => now.filter((t) => t.key !== key)),
      TOAST_MS,
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
    const had = lastSession.current !== null;
    lastSession.current = sessionId;
    setEntries([]);
    setDraft("");
    setNote(null);
    setCleared(had);
  }, [sessionId]);

  // ---- The bus ----------------------------------------------------------------
  const bus = useMemo(() => openPanelBus(), []);
  const [mirror, setMirror] = useState<PanelState>(() => ({
    ...OFF,
    auto: loadAutoPreferred(tenant),
  }));

  // ---- Capturing (owner only) -------------------------------------------------
  const hints = {
    skill: prefs.settings.skill ?? ("auto" as const),
    language: prefs.settings.language ?? ("auto" as const),
  };
  const latest = useRef({ hints, mask: prefs.mask, deviceOnly });
  latest.current = { hints, mask: prefs.mask, deviceOnly };
  const sessionNow = useRef(sessionId);
  sessionNow.current = sessionId;

  async function grabAndAnalyze(label?: string): Promise<boolean> {
    const origin = sessionNow.current;
    const here = () => sessionNow.current === origin;
    setNote(null);
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
      const target = latestTarget(snapshotRef.current);
      const result = await actions.analyzeCapture({
        image: frame.blob,
        label: label ?? frame.label,
        ...(target
          ? { target: { taskId: target.taskId, revision: target.revision } }
          : {}),
        ...latest.current.hints,
      });
      if (!result.ok && here()) setNote(failureNote(result.code));
      return result.ok;
    } catch (error) {
      if (here())
        setNote(
          error instanceof FrameError && error.code === "display-changed"
            ? "Your display changed, so the capture area was cleared. Choose the area again."
            : "Couldn’t capture. Check the share and try again.",
        );
      return false;
    } finally {
      setGrabbing(false);
    }
  }
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  async function autoCapture(): Promise<boolean> {
    const sent = await grabAndAnalyze(AUTO_CAPTURE_LABEL);
    if (sent) {
      addLine("Auto", AUTO_CAPTURE_LABEL);
      bus.post({
        type: "line",
        sessionId: sessionNow.current,
        kind: "Auto",
        text: AUTO_CAPTURE_LABEL,
        at: Date.now(),
      });
    }
    return sent;
  }

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
    wantsScreen: session?.captureSources.includes("screen") ?? false,
    sharing: share.status === "sharing",
    watchable: share.kind !== "This Mac" && share.kind !== null,
    sample: share.sample,
    mask: prefs.mask,
    busy: grabbing || snapshot.pending.includes("analyze"),
    capture: autoCapture,
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

  const press = useCallback(
    (command: "capture" | "toggle-mic") => {
      if (!owns) {
        bus.post({ type: "command", command });
        return;
      }
      if (command === "toggle-mic") auto.toggleListening();
      else void grabAndAnalyze();
    },
    // grabAndAnalyze reads refs; auto.toggleListening is stable.
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
    setDraft("");
    setNote(null);
    setCleared(true);
    if (announce) {
      toast("Session memory cleared");
      bus.post({ type: "clear", sessionId: sessionNow.current });
    }
  }

  // ---- Commands -----------------------------------------------------------------
  // Every command, from the in-page keymap or a host hotkey, runs here once.
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
          if (result.ok) toast("Generating the solution…");
          else setNote(failureNote(result.code));
          return;
        }
        case "skill.next":
        case "skill.prev":
          prefs.setSettings({
            ...settingsRef.current,
            skill: cycleSkill(
              settingsRef.current.skill,
              command === "skill.next" ? 1 : -1,
            ),
          });
          return;
        case "session.clear":
          clearMemory(true);
          return;
        case "panel.toggle": {
          const shown = presentation.openPanels().includes("analysis");
          const done = await (shown
            ? presentation.close("analysis")
            : presentation.open("analysis"));
          if (!done) toast("This window can’t show other panels.");
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
      // With one document per panel the intent goes to the panel it is for.
      const target = INTENT_TARGET[intent.command];
      if (target && perPanelHost.current && target !== panel) return;
      runOnce(intent.command);
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      removeHost();
    };
  }, [runOnce, panel, prefs.setSettings]);

  // ---- Toasts for changes -------------------------------------------------------
  const skill = prefs.settings.skill;
  const lastSkill = useRef<LiveOwnerSkill | undefined>(skill);
  useEffect(() => {
    if (lastSkill.current === skill) return;
    lastSkill.current = skill;
    toast(
      `Skill changed to ${skill ? LIVE_OWNER_SKILL_LABELS[skill] : "Auto-detect"}`,
    );
  }, [skill, toast]);
  const lastMode = useRef(interaction);
  useEffect(() => {
    if (lastMode.current === interaction) return;
    lastMode.current = interaction;
    if (interaction !== null)
      toast(`Interaction mode: ${interaction ? "ON" : "OFF"}`);
  }, [interaction, toast]);

  // ---- Typing -----------------------------------------------------------------
  const send = useCallback(
    async (text: string) => {
      setNote(null);
      const origin = sessionNow.current;
      const result = await actions.submitFollowUp(text, latest.current.hints);
      if (origin !== sessionNow.current) return result;
      if (result.ok) {
        setCleared(false);
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
  const selected = tasks[tasks.length - 1];
  selectedRef.current = selected;
  // Capturing or analyzing, whichever document is doing it: shown before the
  // work finishes, from typed state (never from status text).
  const phase = localPhase ?? live.phase;

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
    cleared,
    draft,
    setDraft,
    note,
    toasts,
    selected,
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
    autoLine: owns ? auto.line : null,
  };
}
