import { useEffect, useState } from "react";
import { Icon } from "./icon";

// Say it out loud against the clock.
export function PracticeTimer({ seconds }: { seconds: number }) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () => setElapsed((current) => Math.min(seconds, current + 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [running, seconds]);
  useEffect(() => {
    if (elapsed >= seconds) setRunning(false);
  }, [elapsed, seconds]);
  const left = seconds - elapsed;
  const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <div className="ws-practice">
      <button
        type="button"
        className={`ws-practice-button${running ? " running" : ""}`}
        aria-label={running ? "Pause practice" : "Practise it out loud"}
        onClick={() => {
          if (!running && elapsed >= seconds) setElapsed(0);
          setRunning(!running);
        }}
      >
        <Icon name={running ? "pause" : "mic"} filled />
      </button>
      <div className="ws-grow">
        <div>
          {running
            ? "Practising — say it out loud"
            : elapsed >= seconds
              ? "Time — how did it go?"
              : "Practise it out loud"}
        </div>
        <div className="ws-meter">
          <div style={{ width: `${(elapsed / seconds) * 100}%` }} />
        </div>
      </div>
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the label names this part for assistive technology; the role it would need changes the accessibility tree, so it waits for an accessibility pass */}
      <span className="ws-big-mono" aria-label="Time left">
        {time}
      </span>
    </div>
  );
}
