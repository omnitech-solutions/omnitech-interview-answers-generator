// The hands-free controls, rendered from the one controller (use-hands-free.ts):
// the command bar, the Auto line, the device-only notice, the capture strip and
// the follow-up box. The overlay card places these pieces in its own layout; the
// Studio live view shows them together as a band at the top of the page
// (HandsFreeBand). Nothing is duplicated: both are views of the same state.
import { useContext, useEffect, useRef, useState } from "react";
import { Icon } from "../../icon";
import { CAPTURE_UPDATE_LINE } from "../companion-capability";
import { usePresentation } from "../focus-presentation";
import { resolveTarget, taskLabel, taskOrdinal } from "../shared/task-target";
import { AutoStatus } from "./auto-status";
import { CommandBar } from "./command-bar";
import { DeviceOnlyCard } from "./device-only-notice";
import { HandsFreeContext } from "./hands-free-context";
import { ListeningHint } from "./listening-hint";
import { MaskEditor } from "./mask-editor";
import { isFull, toDisplayRegion } from "./mask-geometry";
import { CaptureStrip } from "./overlay-capture";
import { FollowUp, failureNote, UNAVAILABLE_NOTE } from "./overlay-footer";
import { sourceAdvice } from "./overlay-model";
import { FOCUS_INPUT_EVENT } from "./panels/commands";
import { CAPTURE_MODES } from "./panels/toolbar-config";
import { SettingsPopover } from "./settings-popover";
import { openStartPage } from "./studio-links";
import { type HandsFree, useHandsFree } from "./use-hands-free";

// The bar, the one line that says what Auto is doing (or that another window
// is doing it), and the device-only notice.
export function HandsFreeBar({
  hf,
  onStartRemote,
  autoControl = true,
}: {
  hf: HandsFree;
  onStartRemote(): void;
  // False where another control (the band's Manual/Auto switch) owns Auto.
  autoControl?: boolean;
}) {
  const { auto, live, owns } = hf;
  const dictation = auto.dictation;
  const listening = owns
    ? dictation.state === "listening"
    : live.mic === "listening";
  return (
    <>
      <CommandBar
        status={
          !hf.open
            ? "ended"
            : listening
              ? "listening"
              : hf.phase !== null
                ? "capturing"
                : hf.paused
                  ? "paused"
                  : "ready"
        }
        dictation={owns ? dictation.state : listening ? "listening" : "idle"}
        skill={hf.prefs.settings.skill}
        sharing={live.sharing}
        onCapture={owns ? hf.captureNow : () => hf.press("capture")}
        onDictate={() => hf.press("toggle-mic")}
        onSettings={() => hf.setSettingsOpen(true)}
        {...(autoControl
          ? {
              auto: {
                on: live.auto,
                mic: live.mic,
                onToggle: () => hf.setAuto(!live.auto),
              },
            }
          : {})}
      />
      {hf.announced && (
        <p className="ov-auto ok" role="status" data-testid="hands-free-on">
          {hf.announced}
        </p>
      )}
      <DeviceOnlyCard
        tenant={hf.tenant}
        input={{
          deviceOnly: hf.deviceOnly,
          autoOn: live.auto,
          engine: false,
          dictationError: dictation.error,
          dictationSupported: dictation.supported,
        }}
        onStartRemote={onStartRemote}
      />
      {owns
        ? auto.line && (
            <AutoStatus line={auto.line} onStop={() => hf.setAuto(false)} />
          )
        : live.auto && (
            <div
              className="ov-auto ok"
              role="status"
              data-testid="auto-mirror"
              data-tone="ok"
            >
              <Icon name="visibility" />
              <span className="ov-auto-text">
                Auto · running in another Studio window
                {live.mic === "listening" ? " · listening" : ""}
                {live.sharing ? " · screen shared" : ""}
              </span>
              <button
                type="button"
                className="ov-link"
                data-testid="auto-stop"
                onClick={() => hf.setAuto(false)}
              >
                Turn off
              </button>
            </div>
          )}
    </>
  );
}

// The capture strip: the share, the region and Capture & analyze. Another
// window owns the screen, so there it is a button that asks that window.
export function HandsFreeCapture({
  hf,
  menuOpen = hf.captureMenu,
}: {
  hf: HandsFree;
  menuOpen?: boolean;
}) {
  const { model, share, selected, captures, tasks, support } = hf;
  if (!hf.owns)
    return (
      <div className="ov-capture" data-testid="ov-capture-mirror">
        <div className="ov-capture-main">
          <div className="ov-capture-text">
            <div className="ov-capture-label" data-testid="share-mirror">
              {hf.live.sharing
                ? "Screen shared in another Studio window"
                : "No source shared in the window that owns hands-free"}
            </div>
          </div>
          {hf.working || hf.live.phase === "analyzing" ? (
            <button
              type="button"
              className="ov-analyze stop"
              data-testid="stop-analysis"
              disabled={hf.stopping}
              onClick={() => void hf.stopAnalysis()}
            >
              <Icon name="stop_circle" />
              {hf.stopping ? "Stopping…" : "Stop analysis"}
            </button>
          ) : (
            <button
              type="button"
              className="ov-analyze"
              disabled={hf.deviceOnly || hf.phase !== null}
              onClick={() => hf.press("capture")}
            >
              <Icon name="center_focus_strong" />
              {hf.live.phase === "capturing"
                ? "Capturing…"
                : hf.live.phase === "analyzing"
                  ? "Analyzing…"
                  : "Capture & analyze"}
            </button>
          )}
        </div>
      </div>
    );
  const capture = captures[captures.length - 1] ?? null;
  const companionScreen = model.sources.find(
    (item) => item.source === "screen",
  );
  const companionReady =
    companionScreen?.selected === true &&
    companionScreen.health === "receiving" &&
    captures.length > 0;
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
  const number = selected ? taskOrdinal(tasks, selected.taskId) : null;
  return (
    <CaptureStrip
      share={{ status: share.status, kind: share.kind, stream: share.stream }}
      masked={!isFull(hf.prefs.mask)}
      last={capture}
      companionReady={companionReady}
      stored={capture}
      companionCanCapture={companionCanCapture}
      companionReason={companionReason}
      progress={hf.companionCapture.progress}
      attachTo={
        selected && number !== null
          ? { label: `${taskLabel(number)} rev ${selected.currentRevision}` }
          : null
      }
      nextTaskLabel={taskLabel(tasks.length + 1)}
      deviceOnly={hf.deviceOnly}
      phase={hf.phase}
      flash={hf.flash}
      unavailable={hf.unavailable}
      stopWork={
        hf.working || hf.phase === "analyzing"
          ? { stopping: hf.stopping, onStop: () => void hf.stopAnalysis() }
          : null
      }
      menuOpen={menuOpen}
      onMenuOpenChange={hf.setCaptureMenu}
      onShare={() => void hf.startSharing()}
      onStop={share.stop}
      onEditMask={() => hf.setMaskOpen(true)}
      onAnalyze={(choice, via) => void hf.analyze(choice, via)}
    />
  );
}

// What went wrong, as one alert line.
export function HandsFreeNote({ hf }: { hf: HandsFree }) {
  const dictation = hf.auto.dictation;
  const text =
    hf.note ??
    hf.share.message ??
    (hf.deviceOnly && hf.live.auto ? null : dictation.error);
  if (!text) return null;
  return (
    <p className="ov-note" role="alert">
      {hf.note === failureNote("unavailable") ? UNAVAILABLE_NOTE : text}
    </p>
  );
}

// The listening hint and the follow-up box.
export function HandsFreeFollowUp({ hf }: { hf: HandsFree }) {
  const dictation = hf.auto.dictation;
  // A follow-up goes to the task on show, at its own current revision, so the
  // label names that one.
  const resolved = resolveTarget(hf.tasks, hf.selected?.taskId);
  const label = resolved
    ? `Add context to ${resolved.targetLabel}, or ask a follow-up`
    : "Type a follow-up";
  return (
    <>
      {hf.owns && dictation.state === "listening" && (
        <ListeningHint
          level={dictation.level}
          heardNothing={dictation.heardNothing}
          heard={dictation.heard}
        />
      )}
      <FollowUp
        label={label}
        value={hf.followText}
        interim={hf.owns ? dictation.interim : hf.live.interim}
        onChange={(text) => {
          // Typing over words that are still settling takes them as typed.
          if (dictation.interim) dictation.clearInterim();
          hf.setFollowText(text);
        }}
        disabled={hf.unavailable}
        onSend={hf.send}
      />
    </>
  );
}

// The region editors and the settings popover. Shown by whichever view is on
// top (the card when there is one, else the band).
export function HandsFreeDialogs({ hf }: { hf: HandsFree }) {
  const { prefs, selected, support } = hf;
  return (
    <>
      {hf.maskOpen && (
        <MaskEditor
          stream={hf.share.stream}
          initial={prefs.mask}
          onSave={(rect) => {
            prefs.setMask(rect);
            hf.setMaskOpen(false);
          }}
          onClose={() => hf.setMaskOpen(false)}
        />
      )}
      {hf.displayMask && (
        <MaskEditor
          variant="display"
          stream={null}
          initial={prefs.displayMask}
          onSave={(rect) => {
            const choice = hf.displayMask;
            prefs.setDisplayMask(rect);
            hf.setDisplayMask(null);
            const attach =
              choice?.kind === "attach" && selected
                ? {
                    taskId: selected.taskId,
                    revision: selected.currentRevision,
                  }
                : undefined;
            if (support.supported === false) {
              hf.setNote(CAPTURE_UPDATE_LINE);
              return;
            }
            if (!support.selection) {
              hf.setNote(
                "The companion hasn’t said which screen it is capturing yet. Check it is running with a screen source selected, then draw the region again.",
              );
              return;
            }
            void hf.companionCapture
              .start({
                mode: "region",
                region: toDisplayRegion(rect),
                selection: support.selection ?? undefined,
                target: attach,
                ...hf.hints,
              })
              .then((sent) => {
                if (!sent.ok) hf.fail(sent.code);
              });
          }}
          onClose={() => hf.setDisplayMask(null)}
        />
      )}
      {hf.settingsOpen && (
        <SettingsPopover
          settings={prefs.settings}
          onChange={prefs.setSettings}
          onClose={() => hf.setSettingsOpen(false)}
        />
      )}
    </>
  );
}

// ---- The Studio live view's band ---------------------------------------------

const lights = (hf: HandsFree) => {
  const mic =
    hf.live.mic === "listening"
      ? "listening"
      : hf.live.mic === "denied"
        ? "not allowed"
        : "off";
  const screen = hf.deviceOnly
    ? "not sent (device-only)"
    : hf.live.sharing
      ? (hf.share.kind ?? "shared")
      : "not shared";
  return { mic, screen };
};

// The hands-free controls at the top of the live session view: the same bar,
// Auto line, capture strip and follow-up box the card has, in one collapsible
// band. In the Studio shell it reuses the page's one controller; rendered
// alone (a test, a host without the shell) it makes its own.
export function HandsFreeBand() {
  const shared = useContext(HandsFreeContext);
  return shared ? <BandView hf={shared} /> : <OwnedBand />;
}

function OwnedBand() {
  return <BandView hf={useHandsFree("studio")} />;
}

// Where the controls are while the band hands them over: the floating window
// when a float is open, the card otherwise.
const HAND_OFF_TEXT = {
  floating: "Controls are in the floating window. Close it to use them here.",
  card: "The controls are in the card. Close it to use them here.",
} as const;

// Manual: capture only when Analyze is pressed. Auto: hands-free listening and
// capture when the shared screen changes. One choice, the one Auto preference
// the native toolbar menu, the strip and the Auto hotkey share (the table is in
// toolbar-config.ts).
function CaptureMode({ hf }: { hf: HandsFree }) {
  return (
    <div className="ov-segmented" role="group" aria-label="Capture mode">
      {CAPTURE_MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          className="ov-segment"
          aria-pressed={hf.live.auto === mode.on}
          title={mode.title}
          data-testid={mode.on ? "auto-toggle" : "manual-toggle"}
          onClick={() => hf.setAuto(mode.on)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}

function BandView({ hf }: { hf: HandsFree }) {
  const [collapsed, setCollapsed] = useState(false);
  const { float } = usePresentation();
  // While a card shows the same controller, it has the controls and dialogs.
  const dialogs = !hf.cardAttached;
  // The follow-up box and the capture notes are in the band's body: "Add
  // context" and "Add another screenshot" open it first when it is collapsed,
  // and the focus is asked for once the box is on screen.
  const focusWhenShown = useRef(false);
  const problem = hf.note ?? hf.share.message;
  useEffect(() => {
    if (problem) setCollapsed(false);
  }, [problem]);
  useEffect(() => {
    if (!collapsed) {
      if (!focusWhenShown.current) return;
      focusWhenShown.current = false;
      window.dispatchEvent(new Event(FOCUS_INPUT_EVENT));
      return;
    }
    const open = () => {
      focusWhenShown.current = true;
      setCollapsed(false);
    };
    window.addEventListener(FOCUS_INPUT_EVENT, open);
    return () => window.removeEventListener(FOCUS_INPUT_EVENT, open);
  }, [collapsed]);
  if (!hf.open) return null;
  const light = lights(hf);
  return (
    <section
      className="ov-card ov-band"
      data-p="glass"
      data-testid="hands-free-band"
      data-variant="band"
      data-collapsed={collapsed || undefined}
      data-owner={hf.owns ? "this-window" : "other-window"}
      aria-label="Hands-free controls"
    >
      <header className="ov-head ov-band-head">
        <Icon name="visibility" />
        <span className="ov-title">Hands-free</span>
        <span className="ov-band-lights" data-testid="hands-free-lights">
          <span data-testid="light-mic" data-state={hf.live.mic}>
            <Icon name="mic" />
            Mic {light.mic}
          </span>
          <span
            data-testid="light-screen"
            data-state={hf.live.sharing ? "on" : "off"}
          >
            <Icon name="screen_share" />
            Screen {light.screen}
          </span>
        </span>
        {!hf.cardAttached && <CaptureMode hf={hf} />}
        <button
          type="button"
          className="ov-icon-button"
          aria-label={collapsed ? "Expand hands-free" : "Collapse hands-free"}
          aria-expanded={!collapsed}
          title={
            collapsed
              ? "Show the capture controls"
              : "Hide the capture controls"
          }
          onClick={() => setCollapsed(!collapsed)}
        >
          <Icon name={collapsed ? "expand_more" : "expand_less"} />
        </button>
      </header>
      {hf.cardAttached ? (
        // One set of controls: while the card is open it has them.
        <p className="ov-muted ov-band-note" data-testid="band-in-card">
          {float === "pip" ? HAND_OFF_TEXT.floating : HAND_OFF_TEXT.card}
        </p>
      ) : (
        <>
          <HandsFreeBar
            hf={hf}
            autoControl={false}
            onStartRemote={() => openStartPage("tab")}
          />
          {!collapsed && (
            <>
              <HandsFreeCapture hf={hf} />
              <HandsFreeNote hf={hf} />
              <HandsFreeFollowUp hf={hf} />
            </>
          )}
        </>
      )}
      {dialogs && <HandsFreeDialogs hf={hf} />}
    </section>
  );
}
