import { useLiveSession } from "./use-live-session";

export type SessionBarProps = {
  // "bar": the strip above every Studio page while a session is open.
  // "header": the live header inside the Live session view itself.
  variant: "bar" | "header";
  // Return to the Live session view ("Open" in the bar).
  onOpen(): void;
};

// The persistent session control: state, target, elapsed time, activity,
// source chips, locality, Pause/Resume and End. Renders nothing unless a
// session is open (created, active or paused). It reads the store itself.
//
// STUB (plan #3 U3): the session bar unit replaces this body and keeps these
// props, the test id and the `useLiveSession` source.
export function SessionBar({ variant, onOpen }: SessionBarProps) {
  const { model } = useLiveSession();
  if (model.phase !== "open") return null;
  return (
    <div
      className="live-session-bar"
      data-testid="session-bar"
      data-variant={variant}
    >
      <span className="live-dot" aria-hidden="true" />
      <span>{model.barLabel}</span>
      <span>{model.elapsedLabel}</span>
      {variant === "bar" && (
        <button type="button" className="studio-button" onClick={onOpen}>
          Open
        </button>
      )}
    </div>
  );
}
