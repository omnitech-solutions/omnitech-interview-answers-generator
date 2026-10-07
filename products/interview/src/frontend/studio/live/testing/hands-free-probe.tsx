// A bare view of the hands-free controller (overlay/use-hands-free.ts) for
// tests: the state it exposes as text and data attributes, and one button per
// action. It draws nothing the product shows; the controller's behaviour is
// what is under test.
import { useHandsFree } from "../overlay/use-hands-free";

export function HandsFreeProbe() {
  const hf = useHandsFree("studio");
  const progress = hf.companionCapture.progress;
  return (
    <div
      data-testid="hf-probe"
      data-owner={hf.owns ? "this-window" : "other-window"}
      data-live-auto={String(hf.live.auto)}
      data-live-mic={hf.live.mic}
      data-live-sharing={String(hf.live.sharing)}
      data-live-native={String(hf.live.native === true)}
      data-working={String(hf.working)}
      data-phase={hf.phase ?? ""}
      data-share-kind={hf.share.kind ?? ""}
    >
      {hf.announced && <p data-testid="hands-free-on">{hf.announced}</p>}
      {hf.noQuestionLine && (
        <p data-testid="no-question">{hf.noQuestionLine}</p>
      )}
      <button
        type="button"
        data-testid="toggle-mic"
        onClick={() => hf.press("toggle-mic")}
      >
        Dictate
      </button>
      <button
        type="button"
        data-testid="stop-analysis"
        onClick={() => void hf.stopAnalysis()}
      >
        Stop analysis
      </button>
      <button
        type="button"
        data-testid="auto-toggle"
        aria-pressed={hf.live.auto}
        onClick={() => hf.setAuto(true)}
      >
        Auto
      </button>
      {hf.auto.line && (
        <div data-testid="auto-status" data-tone={hf.auto.line.tone}>
          {hf.auto.line.text}
          <button
            type="button"
            data-testid="auto-stop"
            onClick={() => hf.setAuto(false)}
          >
            Turn off
          </button>
        </div>
      )}
      <button type="button" data-testid="share-start" onClick={hf.startSharing}>
        Share
      </button>
      <button
        type="button"
        data-testid="capture-now"
        disabled={hf.phase !== null || progress?.phase === "asking"}
        onClick={() => hf.captureNow()}
      >
        Capture and analyze
      </button>
      <button
        type="button"
        data-testid="analyze-new-share"
        onClick={() => void hf.analyze({ kind: "new" }, "share")}
      >
        New from share
      </button>
      <button
        type="button"
        data-testid="analyze-attach-share"
        onClick={() => void hf.analyze({ kind: "attach" }, "share")}
      >
        Attach from share
      </button>
      <button
        type="button"
        data-testid="analyze-stored"
        disabled={hf.captures.length === 0}
        onClick={() => void hf.analyze({ kind: "new" }, "companion")}
      >
        Stored capture
      </button>
      <button
        type="button"
        data-testid="analyze-focused-new"
        onClick={() => void hf.analyze({ kind: "new" }, "focused")}
      >
        Focused window
      </button>
      <button
        type="button"
        data-testid="analyze-focused-attach"
        onClick={() => void hf.analyze({ kind: "attach" }, "focused")}
      >
        Attach focused window
      </button>
      {progress && (
        <p
          data-testid="capture-progress"
          data-phase={progress.phase}
          data-reason={
            "reason" in progress ? (progress.reason ?? "") : undefined
          }
        />
      )}
      {(hf.note ?? hf.captureProblem) && (
        <p role="alert">{hf.note ?? hf.captureProblem?.toString()}</p>
      )}
      <input
        aria-label="Follow-up"
        value={hf.followText}
        onChange={(event) => hf.setFollowText(event.target.value)}
      />
      <button
        type="button"
        data-testid="send"
        onClick={() => void hf.send(hf.followText)}
      >
        Send
      </button>
      <ul data-testid="chat-log">
        {hf.entries.map((entry) => (
          <li key={entry.key}>{entry.text}</li>
        ))}
      </ul>
    </div>
  );
}
